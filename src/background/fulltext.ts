/**
 * 長いポストの全文の取得 (v24)。CLAUDE.md の「守ること」の例外: 保存した時点で、たたまれたポストのページを裏のタブで開いて読む。
 *
 * 動かすのは「ポストのページを、裏のタブ (active: false) で開いて読んで閉じる」ことだけ。
 * タイムラインの「さらに表示」は押さない。いま見ているタブは移動も操作もしない。自動のスクロールもしない。
 *  - 同時に開く裏のタブは 1 つ。次を開くまで 4〜8 秒のランダムな間隔をあける。1 件の待ちは 15 秒まで
 *  - 自動取り込みの実行中は動かさない (終わるまで待つ)
 *  - X が制限や警告 (selectors の xError) を出したら止める。連続で 3 件失敗しても止める。止めた理由は、設定の画面に出す
 *  - 同じポストの再試行は 1 時間に 1 回まで
 * キューはメモリだけ (service worker が止まれば消える)。続きは、保存してある truncated のポストから作り直せる (設定の「いま取得する」)。
 * tabs の権限は使わない (chrome.tabs.create / remove / sendMessage は、権限なしで使える)。
 */
import type { Bookmark } from '../shared/models';
import type { Segment } from '../shared/segments';
import {
  getCollectRun, getFullTextTab, getFullTextTries, getFullTextRun, getSettings, recordFullTextTry, saveFullTextRun, setFullTextTab,
  type FullTextKind, type FullTextRun, type FullTextStop,
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
export type AskResult = { ok: true; text: string; segments?: Segment[] } | { ok: false; reason: 'wait' | 'limit' };

export interface FullTextDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  openTab(url: string): Promise<number>;
  closeTab(id: number): Promise<void>;
  /** 開いたタブの content script に、全文を読ませる。まだ受け取れない (読み込み中) ときは例外 */
  ask(tabId: number, tweetId: string): Promise<AskResult>;
  enabled(): Promise<boolean>;
  collectActive(): Promise<boolean>;
  lookup(item: FullTextItem): Promise<Bookmark | undefined>;
  refresh(item: FullTextItem, full: { text: string; segments?: Segment[] }): Promise<boolean>;
  tries(): Promise<Record<string, number>>;
  recordTry(key: string, now: number): Promise<void>;
  saveRun(r: FullTextRun): Promise<void>;
  setTab(id: number | null): Promise<void>;
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
    collectActive: async () => {
      const s = (await getCollectRun())?.status;
      return s === 'running' || s === 'countdown';
    },
    lookup: async (it) => (await listAllTruncated()).find((b) => b.accountId === it.accountId && b.tweetId === it.tweetId),
    refresh: (it, full) => refreshFullText(it.accountId, it.tweetId, full),
    tries: () => getFullTextTries(),
    recordTry: (key, now) => recordFullTextTry(key, now, RETRY_MS),
    saveRun: (r) => saveFullTextRun(r),
    setTab: (id) => setFullTextTab(id),
  };
}

const keyOf = (it: FullTextItem) => `${it.accountId}:${it.tweetId}`;

export class FullTextQueue {
  private pending: FullTextItem[] = [];
  private looping = false;
  private aborted = false;
  private run: FullTextRun = { running: false, kind: 'save', total: 0, done: 0, failed: 0, updatedAt: 0 };
  private failures = 0;

  constructor(private d: FullTextDeps = defaultDeps()) {}

  get state(): FullTextRun {
    return { ...this.run };
  }
  get busy(): boolean {
    return this.looping;
  }

  private async publish(patch: Partial<FullTextRun> = {}): Promise<void> {
    this.run = { ...this.run, ...patch, updatedAt: this.d.now() };
    await this.d.saveRun(this.run).catch(() => {});
  }

  /** 取得の依頼を入れる。設定がオフなら何もしない。依頼が入ったら、動いていなければ動かし始める (完了を待つ Promise を返す) */
  async enqueue(items: FullTextItem[], kind: FullTextKind): Promise<void> {
    if (items.length === 0 || !(await this.d.enabled())) return;
    const known = new Set(this.pending.map(keyOf));
    const fresh = items.filter((it) => !known.has(keyOf(it)));
    if (fresh.length === 0) return this.finished;
    this.pending.push(...fresh);
    if (!this.looping) {
      this.looping = true; // 続けて呼ばれても、動かすのは 1 つだけ (同時に開く裏のタブは 1 つ)
      this.aborted = false;
      this.failures = 0;
      await this.publish({ running: true, kind, total: fresh.length, done: 0, failed: 0, stopReason: undefined });
      this.finished = this.loop();
    } else await this.publish({ total: this.run.total + fresh.length });
    return this.finished;
  }
  private finished: Promise<void> = Promise.resolve();

  /** 止める (ユーザーの操作)。待っているものを捨て、いまのタブも閉じる */
  async stop(reason: FullTextStop = 'user'): Promise<void> {
    this.aborted = true;
    this.pending = [];
    if (this.looping) await this.publish({ stopReason: reason });
    else await this.publish({ running: false, stopReason: reason });
  }

  private async loop(): Promise<void> {
    this.looping = true;
    try {
      let first = true;
      while (this.pending.length && !this.aborted) {
        if (!first) await this.d.sleep(GAP_MIN_MS + Math.round(this.d.random() * (GAP_MAX_MS - GAP_MIN_MS)));
        first = false;
        // 自動取り込みの実行中は動かさない (終わるまで待つ。最大 30 分)
        for (let w = 0; w < 360 && !this.aborted && (await this.d.collectActive()); w++) await this.d.sleep(5000);
        if (this.aborted) break;
        const item = this.pending.shift()!;
        const b = await this.d.lookup(item);
        const recent = (await this.d.tries())[keyOf(item)];
        if (!b || (recent !== undefined && this.d.now() - recent < RETRY_MS)) {
          await this.publish({ done: this.run.done + 1 }); // 取得済み / 1 時間以内に試した: 飛ばす
          continue;
        }
        await this.d.recordTry(keyOf(item), this.d.now());
        const r = await this.fetchOne(item, b.snapshot.url);
        if (r === 'ok') {
          this.failures = 0;
          await this.publish({ done: this.run.done + 1 });
        } else if (r === 'limit') {
          await this.publish({ failed: this.run.failed + 1 });
          await this.stopWith('limit');
        } else {
          this.failures++;
          await this.publish({ failed: this.run.failed + 1 });
          if (this.failures >= MAX_FAILURES) await this.stopWith('failures');
        }
      }
    } finally {
      this.looping = false;
      this.pending = [];
      await this.publish({ running: false });
    }
  }

  private async stopWith(reason: FullTextStop): Promise<void> {
    this.aborted = true;
    this.pending = [];
    await this.publish({ stopReason: reason });
  }

  /** 1 件: 裏のタブで開き、読めるまで待ち (15 秒まで)、閉じる。閉じ忘れを残さない */
  private async fetchOne(item: FullTextItem, url: string): Promise<'ok' | 'fail' | 'limit'> {
    let tab: number | null = null;
    try {
      tab = await this.d.openTab(url);
      await this.d.setTab(tab);
      const deadline = this.d.now() + TAB_TIMEOUT_MS;
      while (this.d.now() < deadline && !this.aborted) {
        try {
          const r = await this.d.ask(tab, item.tweetId);
          if (r?.ok) return (await this.d.refresh(item, { text: r.text, segments: r.segments })) ? 'ok' : 'fail';
          if (r && !r.ok && r.reason === 'limit') return 'limit';
        } catch {
          /* まだ読み込み中 (受け取り側がない) */
        }
        await this.d.sleep(POLL_MS);
      }
      return 'fail';
    } catch {
      return 'fail';
    } finally {
      if (tab !== null) await this.d.closeTab(tab);
      await this.d.setTab(null).catch(() => {});
    }
  }
}

/** 起動時: 前回、閉じ忘れた裏のタブがあれば閉じる。動いていた記録 (running) が残っていれば止まった扱いにする */
export async function cleanupAtStartup(d: FullTextDeps = defaultDeps()): Promise<void> {
  const id = await getFullTextTab().catch(() => null);
  if (id !== null) {
    await d.closeTab(id);
    await d.setTab(null).catch(() => {});
  }
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
