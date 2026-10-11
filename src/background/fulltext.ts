/**
 * 長いポストの全文の取得 (v24)。CLAUDE.md の「守ること」の例外: 保存した時点で、たたまれたポストのページを裏のタブで開いて読む。
 *
 * 動かすのは「ポストのページを、裏のタブ (active: false) で開いて読んで閉じる」ことだけ。
 * タイムラインの「さらに表示」は押さない。いま見ているタブは移動も操作もしない。自動のスクロールもしない。
 *  - 既定は 4〜8 秒・1 タブ。「標準」は 2〜5 秒・1〜3 タブ。各ワーカーは自分のタブを閉じてから次まで間隔をあける
 *  - 全ワーカーでタブを開く間隔は 1 秒以上 (最初の起動もずらす)。1 件の待ちは 15 秒まで
 *  - 自動取り込みの実行中は動かさない (終わるまで待つ)
 *  - X が制限や警告 (selectors の xError) を出したら全タブを閉じて止める。連続 3 件の失敗は全タブで合算し、成功で 0 に戻す。上限・止める条件は変えない。止めた理由は、設定の画面に出す
 *  - 同じポストの再試行は 1 時間に 1 回まで (自動のとき。設定の「いま取得する」は、ユーザーが押したので間隔を無視する)。飛ばした分は done に数えず skipped に数える
 * キューはメモリだけ (service worker が止まれば消える)。続きは、保存してある truncated のポストから作り直せる (設定の「いま取得する」)。
 * tabs の権限は使わない (chrome.tabs.create / remove / sendMessage は、権限なしで使える)。
 */
import type { Bookmark } from '../shared/models';
import type { Segment } from '../shared/segments';
import {
  fullTextPlan, getCollectRun, getFullTextTab, getFullTextTries, getFullTextRun, getSettings, recordFullTextTry, saveFullTextRun, setFullTextTab,
  type FullTextKind, type FullTextRun, type FullTextStop, type FullTextPlan,
} from '../shared/settings';
import { listAllTruncated, refreshFullText } from '../shared/storage';

export const GAP_MIN_MS = 4000;
export const GAP_MAX_MS = 8000;
export const TAB_TIMEOUT_MS = 15000;
export const POLL_MS = 1000;
export const MAX_FAILURES = 3;
export const RETRY_MS = 60 * 60 * 1000;
export const AUTO_CAP = 30;
export const MANUAL_CAP = 50;

export interface FullTextItem {
  accountId: string;
  tweetId: string;
}
export type AskResult = { ok: true; text: string; segments?: Segment[]; translated?: true } | { ok: false; reason: 'wait' | 'limit' };

export interface FullTextDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  openTab(url: string): Promise<number>;
  closeTab(id: number): Promise<void>;
  /** 開いたタブの content script に、全文を読ませる。まだ受け取れない (読み込み中) ときは例外 */
  ask(tabId: number, tweetId: string): Promise<AskResult>;
  enabled(): Promise<boolean>;
  plan(): Promise<FullTextPlan>;
  collectActive(): Promise<boolean>;
  lookup(item: FullTextItem): Promise<Bookmark | undefined>;
  refresh(item: FullTextItem, full: { text: string; segments?: Segment[]; translated?: true }): Promise<boolean>;
  tries(): Promise<Record<string, number>>;
  recordTry(key: string, now: number): Promise<void>;
  saveRun(r: FullTextRun): Promise<void>;
  setTab(id: number, present?: boolean): Promise<void>;
}

export function defaultDeps(): FullTextDeps {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: () => Math.random(),
    openTab: async (url) => {
      const tab = await chrome.tabs.create({ url, active: false }); // 前面に出さない
      if (tab.id === undefined) throw new Error('no tab id');
      return tab.id;
    },
    closeTab: async (id) => void (await chrome.tabs.remove(id).catch(() => {})),
    ask: async (tabId, tweetId) => (await chrome.tabs.sendMessage(tabId, { type: 'readFullText', tweetId })) as AskResult,
    enabled: async () => (await getSettings()).fullText,
    plan: async () => fullTextPlan(await getSettings()),
    collectActive: async () => {
      const s = (await getCollectRun())?.status;
      return s === 'running' || s === 'countdown';
    },
    lookup: async (it) => (await listAllTruncated()).find((b) => b.accountId === it.accountId && b.tweetId === it.tweetId),
    refresh: (it, full) => refreshFullText(it.accountId, it.tweetId, full),
    tries: () => getFullTextTries(),
    recordTry: (key, now) => recordFullTextTry(key, now, RETRY_MS),
    saveRun: (r) => saveFullTextRun(r),
    setTab: (id, present) => setFullTextTab(id, present),
  };
}

const keyOf = (it: FullTextItem) => `${it.accountId}:${it.tweetId}`;

export class FullTextQueue {
  private pending: FullTextItem[] = [];
  // 実行中の項目も含め、その取得の間は重複して取り出さない。
  private known = new Set<string>();
  private looping = false;
  private aborted = false;
  private userStopped = false;
  private finishing = false;
  private manual = new Set<string>();
  private run: FullTextRun = { running: false, kind: 'save', total: 0, done: 0, failed: 0, skipped: 0, updatedAt: 0 };
  private failures = 0;
  private finished: Promise<void> = Promise.resolve();
  private publications: Promise<void> = Promise.resolve();
  private opening: Promise<unknown> = Promise.resolve();
  private lastOpen = -Infinity;
  private tabs = new Set<number>();
  private closing = new Map<number, Promise<void>>();
  private cancelled: Promise<void> = Promise.resolve();
  private cancel = () => {};

  constructor(private d: FullTextDeps = defaultDeps()) {}
  get state(): FullTextRun { return { ...this.run }; }
  get busy(): boolean { return this.looping; }

  private publish(patch: Partial<FullTextRun> = {}): Promise<void> {
    // 状態の更新は await より前に行う。保存も同じ順番にし、古い進捗が後から上書きしない。
    this.run = { ...this.run, ...patch, updatedAt: this.d.now() };
    const snapshot = { ...this.run };
    this.publications = this.publications.then(() => this.d.saveRun(snapshot)).catch(() => {});
    return this.publications;
  }

  async enqueue(items: FullTextItem[], kind: FullTextKind): Promise<void> {
    if (items.length === 0 || !(await this.d.enabled())) return;
    while (this.userStopped || this.finishing || (this.looping && this.aborted)) await this.finished.catch(() => {});
    if (kind === 'manual') for (const it of items) this.manual.add(keyOf(it));
    const fresh = items.filter(it => {
      const key = keyOf(it);
      if (this.known.has(key)) return false;
      this.known.add(key);
      return true;
    });
    if (fresh.length === 0) return this.finished;
    this.pending.push(...fresh);
    if (!this.looping) {
      this.looping = true;
      this.aborted = false;
      this.failures = 0;
      this.lastOpen = -Infinity;
      this.cancelled = new Promise(r => { this.cancel = r; });
      const published = this.publish({ running: true, kind, total: fresh.length, done: 0, failed: 0, skipped: 0, stopReason: undefined });
      // stop() が初期設定の読み込み中でも、この実行の終了を待てるよう先に登録する。
      this.finished = this.loop(published);
    } else await this.publish({ total: this.run.total + fresh.length });
    return this.finished;
  }

  async stop(reason: FullTextStop = 'user'): Promise<void> {
    if (this.looping) {
      this.userStopped = true;
      await this.stopWith(reason);
      await this.finished.catch(() => {});
    } else await this.publish({ running: false, stopReason: reason });
  }

  private async wait(ms: number): Promise<void> {
    if (ms > 0 && !this.aborted) await Promise.race([this.d.sleep(ms), this.cancelled]);
  }
  private async waitForCollect(): Promise<void> {
    for (let n = 0; n < 360 && !this.aborted && await this.d.collectActive(); n++) await this.wait(5000);
  }

  private async loop(published: Promise<void>): Promise<void> {
    try {
      const plan = await this.d.plan(); // enqueue で開始した取得ごとに 1 回。途中の設定変更は次回用。
      await published;
      await Promise.all(Array.from({ length: plan.tabs }, () => this.worker(plan)));
    } finally {
      this.finishing = true;
      await this.closeAll();
      this.manual.clear();
      this.known.clear();
      this.pending = [];
      await this.publish({ running: false });
      this.looping = false;
      this.userStopped = false;
      this.finishing = false;
    }
  }

  private async worker(plan: FullTextPlan): Promise<void> {
    let readyAt = 0;
    while (this.pending.length && !this.aborted) {
      if (this.aborted) break;
      const item = this.pending.shift(); // 取り出しは同期的に行う。他のワーカーと二重にならない。
      if (!item) break;
      const b = await this.d.lookup(item);
      const recent = (await this.d.tries())[keyOf(item)];
      const tooSoon = !this.manual.has(keyOf(item)) && recent !== undefined && this.d.now() - recent < RETRY_MS;
      if (this.aborted) break;
      if (!b || tooSoon) {
        await this.publish({ skipped: (this.run.skipped ?? 0) + 1 });
        continue; // タブを開かないものには待ちを入れない。
      }
      await this.wait(readyAt - this.d.now());
      if (this.aborted) break;
      const r = await this.fetchOne(item, b.snapshot.url);
      // fetchOne の finally が自分のタブを閉じた時刻から間隔を計る。
      readyAt = this.d.now() + plan.gapMinMs + Math.round(this.d.random() * (plan.gapMaxMs - plan.gapMinMs));
      if (this.aborted || r === 'abort' || r === 'limit') break;
      if (r === 'ok') {
        this.failures = 0;
        await this.publish({ done: this.run.done + 1 });
      } else if (r === 'skip') {
        await this.publish({ skipped: (this.run.skipped ?? 0) + 1 });
      } else {
        this.failures++;
        const published = this.publish({ failed: this.run.failed + 1 });
        // 判定と中断は保存を await する前。他の成功で回数が変わっても判定を失わない。
        if (this.failures >= MAX_FAILURES) await this.stopWith('failures');
        await published;
      }
    }
  }

  private async stopWith(reason: FullTextStop): Promise<void> {
    if (!this.aborted) {
      this.aborted = true;
      this.pending = [];
      this.cancel(); // 全ワーカーの間隔・読取待ちを解く。
      const published = this.publish({ stopReason: reason });
      await this.closeAll();
      await published;
    } else await this.closeAll();
  }

  private close(id: number): Promise<void> {
    const pending = this.closing.get(id);
    if (pending) return pending;
    if (!this.tabs.delete(id)) return Promise.resolve();
    const closing = (async () => {
      try { await this.d.closeTab(id); }
      finally { await this.d.setTab(id, false).catch(() => {}); }
    })();
    this.closing.set(id, closing);
    void closing.finally(() => this.closing.delete(id)).catch(() => {});
    return closing;
  }
  private async closeAll(): Promise<void> {
    await Promise.all([...this.tabs].map(id => this.close(id)));
    await Promise.all([...this.closing.values()]);
  }

  /** 全ワーカー共通の起動ゲート。実際に開いた時刻から次の起動まで必ず 1000ms あける。 */
  private open(item: FullTextItem, url: string): Promise<number | null> {
    const opening = this.opening.then(async () => {
      await this.wait(this.lastOpen + 1000 - this.d.now());
      await this.waitForCollect();
      if (this.aborted) return null;
      await this.d.recordTry(keyOf(item), this.d.now());
      if (this.aborted) return null;
      this.lastOpen = this.d.now();
      const id = await this.d.openTab(url);
      this.lastOpen = this.d.now();
      this.tabs.add(id);
      try { await this.d.setTab(id); }
      catch (error) { await this.close(id); throw error; }
      return id;
    });
    this.opening = opening.catch(() => {});
    return opening;
  }

  private async fetchOne(item: FullTextItem, url: string): Promise<'ok' | 'fail' | 'limit' | 'skip' | 'abort'> {
    let tab: number | null = null;
    try {
      tab = await this.open(item, url);
      if (tab === null || this.aborted) return 'abort';
      const deadline = this.d.now() + TAB_TIMEOUT_MS;
      while (this.d.now() < deadline && !this.aborted) {
        try {
          // sendMessage 自体が返らない場合も、1 件全体の 15 秒を超えて待たない。
          let timer: ReturnType<typeof setTimeout> | undefined;
          let r: AskResult | null;
          try {
            r = await Promise.race([
              this.d.ask(tab, item.tweetId), this.cancelled.then(() => null),
              new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - this.d.now())); }),
            ]);
          } finally { clearTimeout(timer); }
          if (r === null) return this.aborted ? 'abort' : 'fail';
          if (this.aborted) return 'abort';
          if (r?.ok) {
            if (await this.d.refresh(item, { text: r.text, segments: r.segments, ...(r.translated === true ? { translated: true } : {}) })) return 'ok';
            return (await this.d.lookup(item)) ? 'fail' : 'skip';
          }
          if (r && !r.ok && r.reason === 'limit') {
            const published = this.publish({ failed: this.run.failed + 1 });
            await this.stopWith('limit');
            await published;
            return 'limit';
          }
        } catch { /* まだ読み込み中 (受け取り側がない) */ }
        await this.wait(POLL_MS);
      }
      return this.aborted ? 'abort' : 'fail';
    } catch { return this.aborted ? 'abort' : 'fail'; }
    finally { if (tab !== null) await this.close(tab); }
  }
}

/** 起動時: 前回、閉じ忘れた裏のタブがあれば閉じる。動いていた記録 (running) が残っていれば止まった扱いにする */
export async function cleanupAtStartup(d: FullTextDeps = defaultDeps()): Promise<void> {
  const ids = await getFullTextTab().catch(() => []);
  await Promise.all(ids.map(async id => {
    await d.closeTab(id);
    await d.setTab(id, false).catch(() => {});
  }));
  const run = await getFullTextRun().catch(() => null);
  if (run?.running) await d.saveRun({ ...run, running: false, updatedAt: d.now() }).catch(() => {});
}

/** 手動 (「いま取得する」): 現在のアカウントの、全文を取れていないポストを最大 50 件 */
export async function manualItems(accountId: string, cap = MANUAL_CAP): Promise<FullTextItem[]> {
  return (await listAllTruncated())
    .filter((b) => b.accountId === accountId)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, cap)
    .map((b) => ({ accountId: b.accountId, tweetId: b.tweetId }));
}
