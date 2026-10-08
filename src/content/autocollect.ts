/**
 * ブックマークの自動取り込み (v15-B-1)。「自動スクロールで大量取得しない」の例外 (CLAUDE.md の「守ること」を参照)。
 *
 * 守る条件 (この条件を満たさない自動化は入れない):
 *  - ユーザーが、管理画面の確認ダイアログで同意して「始める」を押したときだけ動く (コマンドに consent: true が要る)。
 *    インストール直後・アカウント切替直後・ページを開いただけでは始まらない。
 *  - x.com の非公開 API / GraphQL は呼ばない。fetch / XMLHttpRequest も使わない。
 *    ユーザーが見ているページを、ユーザーの代わりにスクロールして、画面に出たポストの DOM を読むだけ。
 *  - 速度を抑える (待ち時間を入れる)。いつでも一時停止・停止できる。X が制限やエラーを出したら自動で止める。
 *  - 再開は、ユーザーが押したときだけ (「15 分後に再開する」も、押したときだけ予約される)。
 *
 * 実機未確認 (docs/MANUAL_TEST.md): X の一覧の仮想化への追従、終わりの判定、制限・エラー表示のセレクタ。
 * 判定の条件は定数にして、調整しやすくしてある。
 */
import { isBookmarksPath, queryFirst } from '../shared/selectors';
import {
  clearCollectCommand, clearCollectRun, getCollectRun, getSettings, onCollectCommand, peekCollectCommand, saveCollectRun, setCollectOffer,
  type CollectCap, type CollectCommand, type CollectReason, type CollectRun, type CollectSpeed,
} from '../shared/settings';
import { addCollected, getSavedIds } from '../shared/storage';
import { getCurrentAccount, subscribeAccount } from './account';
import { collectVisible } from './collect';
import type { Extracted } from './snapshot';

/** スクロールごとの待ち時間 (ミリ秒) の範囲 */
export const SPEED_RANGES: Record<CollectSpeed, [number, number]> = { slow: [2000, 4000], normal: [1000, 2500] };
/** 画面の高さのこの割合ずつスクロールする */
export const SCROLL_RATIO = 0.8;
/** 新しいポスト (取り込み済みを含む) が、この回数続けて出なかったら、終わりとみなす (読み込み中の表示が無いとき)。実機未確認 */
export const END_STREAK = 5;
/** 新しいポストが、この件数たまるごとに保存する (一時停止・終了のときにも保存する) */
export const FLUSH_EVERY = 20;
export const COUNTDOWN_SECONDS = 3;
/** スクロールのあと、読み込み中の表示が消えるのを待つ上限と確認の間隔 */
export const LOAD_WAIT_MS = 8000;
export const LOAD_POLL_MS = 500;
/** 「15 分後に再開する」の待ち時間 */
export const LIMIT_RESUME_MS = 15 * 60 * 1000;
/** 開始のコマンドが有効な時間 (これより古いコマンドは捨てる) */
export const COMMAND_TTL_MS = 2 * 60 * 1000;

export interface CollectState extends CollectRun {
  /** countdown の残り秒 */
  countdown?: number;
  /** 「15 分後に再開する」を予約したときの再開時刻 */
  resumeAt?: number;
}

export interface CollectDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  scrollBy(px: number): void;
  scrollToTop(): void;
  viewportHeight(): number;
  visible(): Extracted[];
  isLoading(): boolean;
  hasLimit(): boolean;
  /** /i/history のブックマークのタブか (/i/history/likes などは false) */
  pageOk(): boolean;
  isHidden(): boolean;
  accountId(): string | null;
  savedIds(): Promise<Set<string>>;
  /** seq = 画面に出た順の全ポスト。保存の savedAt は一覧での位置から決める (ordering.ts) */
  addCollected(seq: Extracted[], startedAt: number): Promise<number>;
  saveRun(run: CollectRun): Promise<void>;
  clearRun(): Promise<void>;
}

export function defaultDeps(): CollectDeps {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: () => Math.random(),
    scrollBy: (px) => window.scrollBy({ top: px, left: 0, behavior: 'instant' as ScrollBehavior }),
    scrollToTop: () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior }),
    viewportHeight: () => window.innerHeight,
    visible: () => collectVisible(),
    isLoading: () => !!queryFirst(document, 'loadingIndicator'),
    hasLimit: () => !!queryFirst(document, 'xError'),
    pageOk: () => isBookmarksPath(location.pathname),
    isHidden: () => document.visibilityState === 'hidden',
    accountId: () => getCurrentAccount()?.id ?? null,
    savedIds: () => getSavedIds(),
    addCollected: (seq, startedAt) => addCollected(seq, startedAt),
    saveRun: (run) => saveCollectRun(run),
    clearRun: () => clearCollectRun(),
  };
}

export class AutoCollector {
  state: CollectState | null = null;
  private token = 0;
  private resumeToken = 0;
  private seen = new Set<string>();
  private seq: Extracted[] = [];
  private pending: Extracted[] = [];
  private streak = 0;
  /** 上限の数え始め (再開のたびに、その時点の imported から数え直す) */
  private base = 0;
  /** ページの再読み込みのあとなので、再開は一覧の先頭からやり直す */
  private rewind = false;
  private flushing: Promise<void> = Promise.resolve();
  private listeners = new Set<(s: CollectState | null) => void>();

  constructor(private d: CollectDeps) {}

  subscribe(cb: (s: CollectState | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(persist = true): void {
    const s = this.state;
    if (s && persist && s.status !== 'countdown') {
      const { countdown: _c, resumeAt: _r, ...run } = s;
      void this.d.saveRun({ ...run, updatedAt: this.d.now() }).catch(() => {});
    }
    this.listeners.forEach((l) => l(s ? { ...s } : null));
  }

  private refuse(reason: CollectReason, accountId: string, speed: CollectSpeed, cap: CollectCap): false {
    this.state = { status: 'stopped', accountId, startedAt: this.d.now(), imported: 0, skipped: 0, failed: 0, speed, cap, reason, updatedAt: this.d.now() };
    this.emit();
    return false;
  }

  /** 開始。同意 (consent) の無いコマンド、ブックマークのタブ以外、アカウントを判定できない / 違うときは始めない */
  async start(cmd: Pick<CollectCommand, 'consent' | 'speed' | 'cap' | 'accountId'>): Promise<boolean> {
    if (cmd.consent !== true) return false;
    if (this.state && ['countdown', 'running'].includes(this.state.status)) return false;
    if (!this.d.pageOk()) return false;
    const speed = cmd.speed ?? 'slow';
    const cap = cmd.cap ?? 300;
    const account = this.d.accountId();
    if (!account) return this.refuse('refused-unknown', cmd.accountId ?? '', speed, cap);
    if (cmd.accountId && cmd.accountId !== account) return this.refuse('refused-account', account, speed, cap);

    const token = ++this.token;
    this.resumeToken++;
    this.state = { status: 'countdown', accountId: account, startedAt: this.d.now(), imported: 0, skipped: 0, failed: 0, speed, cap, countdown: COUNTDOWN_SECONDS, updatedAt: this.d.now() };
    // 同意したあとの取り消し用に、開始の 3 秒前に表示する
    for (let sec = COUNTDOWN_SECONDS; sec > 0; sec--) {
      this.state.countdown = sec;
      this.emit(false);
      await this.d.sleep(1000);
      if (token !== this.token) return false;
    }
    this.begin(token, true, true);
    return true;
  }

  /** rewind: 一覧の先頭から読み直す (開始と、ページの再読み込みのあとの再開)。そうでなければ、いまの位置から続ける */
  private begin(token: number, fresh: boolean, rewind: boolean): void {
    const s = this.state!;
    if (fresh) {
      s.startedAt = this.d.now();
      s.imported = 0;
      s.skipped = 0;
      s.failed = 0;
      s.oldestSeenPostDate = undefined;
    }
    s.status = 'running';
    s.reason = undefined;
    s.countdown = undefined;
    s.resumeAt = undefined;
    if (rewind) {
      this.resetPass();
      this.d.scrollToTop(); // 一覧の先頭から、同じ順にスクロールしていく (取り込み済みは読み飛ばす)
    }
    this.streak = 0;
    this.base = s.imported;
    this.emit();
    void this.loop(token);
  }

  private resetPass(): void {
    this.seen = new Set();
    this.seq = [];
    this.pending = [];
    this.streak = 0;
    this.rewind = false;
  }

  private guard(): CollectReason | null {
    const s = this.state!;
    if (!this.d.pageOk()) return 'page';
    if (this.d.isHidden()) return 'hidden';
    const id = this.d.accountId();
    if (id && id !== s.accountId) return 'account';
    return null;
  }

  private delay(): number {
    const [min, max] = SPEED_RANGES[this.state!.speed];
    return Math.round(min + this.d.random() * (max - min));
  }

  private async loop(token: number): Promise<void> {
    const alive = () => token === this.token;
    while (alive()) {
      const g = this.guard();
      if (g) return void (await this.pause(g));
      const fresh = await this.readVisible(token);
      if (!alive()) return;
      this.streak = fresh > 0 ? 0 : this.streak + 1;
      if (this.pending.length >= FLUSH_EVERY) await this.flush();
      if (!alive()) return;
      this.emit();
      if (this.d.hasLimit()) return void (await this.pause('limit'));
      const s = this.state!;
      if (s.cap > 0 && s.imported - this.base >= s.cap) return void (await this.pause('cap'));
      if (this.streak >= END_STREAK && !this.d.isLoading()) return void (await this.finish());
      this.d.scrollBy(Math.round(this.d.viewportHeight() * SCROLL_RATIO));
      await this.d.sleep(this.delay());
      if (!alive()) return;
      // X の一覧は下端で追加のポストを読み込む。読み込み中の表示が消えるまで (上限つきで) 待つ
      for (let waited = 0; alive() && waited < LOAD_WAIT_MS && this.d.isLoading(); waited += LOAD_POLL_MS) await this.d.sleep(LOAD_POLL_MS);
    }
  }

  /** 画面に出ているポストを読む。X は画面外のポストを DOM から外す (仮想化) ので、スクロールのたびに読む。新しく見つけた件数を返す */
  private async readVisible(token: number): Promise<number> {
    const items = this.d.visible();
    const saved = await this.d.savedIds();
    if (token !== this.token) return 0;
    const s = this.state!;
    let fresh = 0;
    for (const it of items) {
      if (this.seen.has(it.tweetId)) continue; // 同じ取り込みの中で、同じポストを二重に数えない
      this.seen.add(it.tweetId);
      this.seq.push(it);
      fresh++;
      const posted = it.snapshot.createdAt;
      if (posted && (!s.oldestSeenPostDate || posted < s.oldestSeenPostDate)) s.oldestSeenPostDate = posted;
      if (saved.has(it.tweetId)) s.skipped++;
      else {
        this.pending.push(it);
        s.imported++;
      }
    }
    return fresh;
  }

  /** たまった新しいポストを保存する (一覧の位置から savedAt を決める)。保存は 1 つずつ順に行う */
  private flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      const batch = this.pending;
      this.pending = [];
      if (batch.length === 0 || !this.state) return;
      try {
        await this.d.addCollected(this.seq, this.state.startedAt);
      } catch {
        this.state.failed += batch.length; // 保存できなかった分は、取り込めなかったものとして数える
        this.state.imported -= batch.length;
      }
    });
    return this.flushing;
  }

  async pause(reason: CollectReason = 'user'): Promise<void> {
    const s = this.state;
    if (!s || s.status !== 'running') return;
    this.token++;
    await this.flush();
    s.status = reason === 'limit' ? 'limit' : 'paused';
    s.reason = reason;
    this.emit();
  }

  /** 再開 (ユーザーが押したときだけ)。ページの再読み込みのあとは、一覧の先頭からやり直す */
  async resume(): Promise<boolean> {
    const s = this.state;
    if (!s || !['paused', 'limit'].includes(s.status)) return false;
    if (!this.d.pageOk() || this.d.isHidden()) return false;
    const id = this.d.accountId();
    if (!id || id !== s.accountId) return false;
    const token = ++this.token;
    this.resumeToken++;
    this.begin(token, false, this.rewind);
    return true;
  }

  /** 「15 分後に再開する」: 押したときだけ予約される。待っている間も、停止できる */
  async resumeLater(ms = LIMIT_RESUME_MS): Promise<void> {
    const s = this.state;
    if (!s || !['paused', 'limit'].includes(s.status)) return;
    const my = ++this.resumeToken;
    s.resumeAt = this.d.now() + ms;
    this.emit(false);
    await this.d.sleep(ms);
    if (my !== this.resumeToken) return;
    await this.resume();
  }

  /** 停止 / ここで終了: そこまでの分は保存する */
  async stop(): Promise<void> {
    const s = this.state;
    if (!s) return;
    if (s.status === 'countdown') {
      this.token++;
      this.state = null;
      await this.d.clearRun().catch(() => {});
      this.emit(false);
      return;
    }
    if (['stopped', 'done'].includes(s.status)) return;
    this.token++;
    this.resumeToken++;
    await this.flush();
    s.status = 'stopped';
    s.reason = 'user';
    s.resumeAt = undefined;
    this.emit();
  }

  private async finish(): Promise<void> {
    const s = this.state!;
    this.token++;
    await this.flush();
    s.status = 'done';
    s.reason = undefined;
    this.emit();
  }

  /** パネルの「閉じる」。終わった状態を画面から消す (保存済みの記録は残す) */
  dismiss(): void {
    if (this.state && ['stopped', 'done'].includes(this.state.status)) {
      this.state = null;
      this.emit(false);
    }
  }

  onHidden(): void {
    if (this.state?.status === 'running') void this.pause('hidden');
  }

  onAccountChanged(id: string | null): void {
    const s = this.state;
    if (!s || !id || id === s.accountId) return;
    if (s.status === 'running') void this.pause('account');
  }

  /** ページを読み込み直したあと、前回の状態 (保存済み) を引き継ぐ。動いていたものは、止まっている扱いにする */
  adopt(run: CollectRun | null): void {
    if (!run || this.state) return;
    if (!['countdown', 'running', 'paused', 'limit'].includes(run.status)) return;
    this.state = { ...run, status: run.status === 'limit' ? 'limit' : 'paused', reason: run.status === 'limit' ? 'limit' : 'reload' };
    this.rewind = true;
    this.emit();
  }

  get needsRewind(): boolean {
    return this.rewind;
  }
}

// ---- 組み込み (content script) ----

let collector: AutoCollector | null = null;
export const getCollector = (): AutoCollector | null => collector;

/** manager からのコマンドを処理する。start は、同意の印 (consent) と新しさ (COMMAND_TTL_MS) を確かめる */
export async function handleCollectCommand(c: AutoCollector, d: Pick<CollectDeps, 'pageOk' | 'isHidden' | 'now'> = defaultDeps()): Promise<void> {
  const cmd = await peekCollectCommand();
  if (!cmd) return;
  if (d.now() - cmd.at > COMMAND_TTL_MS) return void (await clearCollectCommand());
  if (cmd.type === 'start') {
    // 見えていないタブ・ブックマーク以外のページでは取らない (開いたあとの遷移で、見えているタブが処理する)
    if (!d.pageOk() || d.isHidden()) return;
    await clearCollectCommand();
    if (cmd.consent !== true || !(await getSettings()).autoCollect.enabled) return;
    await c.start(cmd);
    return;
  }
  if (!c.state) return;
  await clearCollectCommand();
  if (cmd.type === 'pause') await c.pause('user');
  else if (cmd.type === 'resume') await c.resume();
  else if (cmd.type === 'stop') await c.stop();
}

/** 取り込みが終わった (完了) とき、そのアカウントの案内を「済み」にする */
export async function markOfferDone(accountId: string): Promise<void> {
  await setCollectOffer(accountId, 'done').catch(() => {});
}

export function installAutoCollect(onState: (s: CollectState | null, c: AutoCollector) => void, d: CollectDeps = defaultDeps()): AutoCollector {
  const c = new AutoCollector(d);
  collector = c;
  let lastStatus: string | undefined;
  c.subscribe((s) => {
    if (s?.status === 'done' && lastStatus !== 'done') void markOfferDone(s.accountId);
    lastStatus = s?.status;
    onState(s, c);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') c.onHidden();
  });
  subscribeAccount((a) => c.onAccountChanged(a?.id ?? null));
  const tick = () => void handleCollectCommand(c, d).catch(() => {});
  onCollectCommand(tick);
  void getCollectRun().then((run) => {
    c.adopt(run);
    tick();
  });
  return c;
}
