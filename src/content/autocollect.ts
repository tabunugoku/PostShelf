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
import { hasTweetStatusLink, isBookmarksPath, queryAllFirst, queryFirst, timelineLoading } from '../shared/selectors';
import {
  clearCollectCommand, clearCollectRun, getCollectRun, getSettings, onCollectCommand, onCollectRunChanged, peekCollectCommand, saveCollectRun, setCollectOffer,
  type CollectCap, type CollectCommand, type CollectReason, type CollectRun, type CollectSpeed,
} from '../shared/settings';
import { addCollected, fillMissing, getSavedIds, missingFields, onDataChanged } from '../shared/storage';
import { requestFullTextBatch } from '../shared/cacheRequest';
import { getCurrentAccount, subscribeAccount } from './account';
import { pathListeners } from './collect';
import { extractTweet, fillSource, hasPending, tweetIdOf, type Extracted } from './snapshot';
import { SettleDiagnosis } from './settleDiagnosis';

/** スクロールごとの待ち時間 (ミリ秒) の範囲 */
export const SPEED_RANGES: Record<CollectSpeed, [number, number]> = { slow: [2000, 4000], normal: [1000, 2500] };
/** スクロール後の待ちの下限 (v32)。実際の下限は、この値から 1.5 倍までの乱数 (上限 = 速度ごとの待ちの範囲を超えない) */
export const WAIT_FLOORS: Record<CollectSpeed, number> = { slow: 800, normal: 400 };
/** 下限を過ぎたあと、新しいポストを調べる間隔。この刻みで一時停止・停止にも反応する */
export const WAIT_STEP_MS = 100;
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
/**
 * 読み込み中 (メディア・アイコン) のポストを待つ上限 (1 ポストあたりの合計) と、読み直しの間隔 (最小 + 乱数)。
 * 待つのは、読み込み中のポストがあるときだけ。スクロールの間隔や量は変えない
 */
export const SETTLE_MAX_MS = 8000;
export const SETTLE_POLL_MS = 300;
export const SETTLE_POLL_JITTER_MS = 200;
/** 「15 分後に再開する」の待ち時間 */
export const LIMIT_RESUME_MS = 15 * 60 * 1000;
/** 動かない (scrollY が増えない) うえに新しいポストも出ない状態がこの回数続いたら、読み込み中の表示があっても終わりとみなす */
export const STALL_END = 3;
/** 「止めない」を選んだときの、一度の取り込みの時間の上限 */
export const MAX_RUN_MS = 2 * 60 * 60 * 1000;
/** 開始のコマンドが有効な時間 (これより古いコマンドは捨てる) */
export const COMMAND_TTL_MS = 2 * 60 * 1000;
export const ACCOUNT_WAIT_MS = 15_000;

export interface CollectState extends CollectRun {
  /** countdown の残り秒 */
  countdown?: number;
  /** 「15 分後に再開する」を予約したときの再開時刻 */
  resumeAt?: number;
}

/** 保存へ渡す、画面に出た順の 1 件。snapshot が無いものは、保存済みの基準 (並び順を決めるためだけに使う) */
export type SeqEntry = Pick<Extracted, 'tweetId'> & { snapshot?: Extracted['snapshot'] };

export interface CollectDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  scrollBy(px: number): void;
  scrollToTop(): void;
  /** いまのスクロール位置 (動かなくなったことの判定用) */
  scrollY(): number;
  viewportHeight(): number;
  visible(excluded?: ReadonlySet<string>, only?: ReadonlySet<string>): Extracted[];
  /** 解析を省いた既読も含め、直前の visible での位置を返す (診断用)。 */
  visiblePosition?(tweetId: string): number | undefined;
  /** 画面に、seen にまだ無いポストがあるか (ID だけを軽く読む。スナップショットは作らない)。無ければ、待ちは上限まで */
  hasUnseen(seen: ReadonlySet<string>): boolean;
  isLoading(): boolean;
  hasLimit(): boolean;
  /** /i/history のブックマークのタブか (/i/history/likes などは false) */
  pageOk(): boolean;
  isHidden(): boolean;
  accountId(): string | null;
  /** アカウントの判定を待つための通知。ポーリングはしない。 */
  subscribeAccount?(cb: () => void): () => void;
  /** 保存先は取り込みを始めたアカウント (state.accountId)。画面の現在のアカウントではない */
  savedIds(accountId: string): Promise<Set<string>>;
  /** 保存データが (他の場所で) 変わったら呼ばれる。解除関数を返す */
  onDataChanged?(cb: () => void): () => void;
  /** 保存してある取り込みの記録 (owner / commandId の確認用) */
  loadRun?(): Promise<CollectRun | null>;
  /** seq = 前回の保存以降に画面に出た順のポスト (先頭は、保存済みの印のことがある)。保存の savedAt は一覧での位置から決める (ordering.ts) */
  addCollected(seq: SeqEntry[], startedAt: number, accountId: string): Promise<number>;
  /** 時間切れで保存したポストの欠けだけを補う。省略時は保存層の fillMissing を使う */
  fillMissing?(items: Parameters<typeof fillMissing>[0], accountId: string): Promise<number>;
  saveRun(run: CollectRun): Promise<void>;
  clearRun(): Promise<void>;
}

export function defaultDeps(): CollectDeps {
  const positions = new Map<string, number>();
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: () => Math.random(),
    scrollBy: (px) => window.scrollBy({ top: px, left: 0, behavior: 'instant' as ScrollBehavior }),
    scrollToTop: () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior }),
    scrollY: () => window.scrollY,
    viewportHeight: () => window.innerHeight,
    visible: (excluded, only) => {
      positions.clear();
      const items = new Map<string, Extracted>();
      for (const article of queryAllFirst(document, 'tweet').els) {
        const id = tweetIdOf(article);
        if (id && !positions.has(id)) positions.set(id, positions.size + 1);
        if (id && excluded?.has(id)) continue;
        if (only && (!id || !only.has(id))) continue;
        const item = extractTweet(article);
        if (item) items.set(item.tweetId, item);
      }
      return [...items.values()];
    },
    visiblePosition: (id) => positions.get(id),
    hasUnseen: (seen) => queryAllFirst(document, 'tweet').els.some((a) => {
      const id = tweetIdOf(a);
      return !!id && !seen.has(id);
    }),
    isLoading: () => timelineLoading(document),
    hasLimit: () => !!queryFirst(document, 'xError'),
    pageOk: () => isBookmarksPath(location.pathname),
    isHidden: () => document.visibilityState === 'hidden',
    accountId: () => getCurrentAccount()?.id ?? null,
    subscribeAccount: (cb) => subscribeAccount(cb),
    savedIds: (accountId) => getSavedIds(accountId),
    onDataChanged: (cb) => onDataChanged(cb),
    loadRun: () => getCollectRun(),
    addCollected: (seq, startedAt, accountId) => addCollected(seq, startedAt, accountId),
    fillMissing,
    saveRun: (run) => saveCollectRun(run),
    clearRun: () => clearCollectRun(),
  };
}

/** 実行中の「いま ○○ ごろ」に使う、直近の投稿日時の件数 */
const RECENT_POSTS = 10;
type StartCommand = Pick<CollectCommand, 'consent' | 'speed' | 'cap' | 'accountId'> & { id?: string };

export class AutoCollector {
  state: CollectState | null = null;
  private token = 0;
  private resumeToken = 0;
  private seen = new Set<string>();
  /** 前回の保存以降に画面に出た順のポスト。先頭は、保存済みの印 (ID だけ。並び順の基準) のことがある */
  private seq: SeqEntry[] = [];
  private pending: Extracted[] = [];
  /** 未保存の、読み込み中の項目があるポスト。settle で読み込みを待ち、最後に読めた値を持つ。一時停止・停止のときは、その値で保存する */
  private mediaRetry = new Map<string, Extracted>();
  /** DOM から消えたポストの最後の値。次画面で再取得し、終了時には必ず保存へ戻す */
  private vanishedRetry = new Map<string, Extracted>();
  /** 初回を含め 2 回消えたら保存する。再開をまたいでも回数をリセットしない */
  private vanishAttempts = new Set<string>();
  /** 読み直し待ちを seq から外しても一覧の位置を保持する。保存データには足さない */
  private positions = new Map<string, number>();
  private nextPosition = 0;
  /** 8 秒待っても pending だった ID。次の画面で 1 回だけ確認し、保存はしない */
  private timedOut = new Set<string>();
  private diagnosis = new SettleDiagnosis(() => this.d.now());
  private streak = 0;
  /** 上限の数え始め (再開のたびに、その時点の imported から数え直す) */
  private base = 0;
  /** ページの再読み込みのあとなので、再開は一覧の先頭からやり直す */
  private rewind = false;
  /** この取り込みで取り込んだ、たたまれた (truncated) ポストの ID。終わってから、全文の取得を依頼する (v24) */
  private truncatedIds: string[] = [];
  /** ページの再読み込みなどで、保存してある取り込みを引き継いだ。それまでの分のたたまれたポストの ID は、このタブには残っていない */
  private adopted = false;
  /** 直近に読んだ投稿日時 (最大 RECENT_POSTS 件。保存しない) */
  private recent: string[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private listeners = new Set<(s: CollectState | null) => void>();
  /** このタブの ID。保存データの取り込みの記録 (collectRun) に owner として残し、複数のタブで同じ取り込みを動かさない (v18) */
  readonly owner = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  /** 保存済みのポストの ID。開始のときに 1 回だけ読み、あとは自分が保存した分を足す。他の場所で変更があったら読み直す (null = 未読み込み) */
  private saved: Set<string> | null = null;
  /** 自分の保存の最中か (その間の変更の通知では、読み直さない) */
  private writing = false;
  /** 動かない (scrollY が増えない) うえに新しいポストも出ない回数 */
  private stalled = 0;
  private moved = true;
  /** この区間 (開始 / 再開) の始まり。「止めない」のときの時間の上限の基準 */
  private segmentStart = 0;
  private starting = false;
  private cancelAccountWait: (() => void) | null = null;

  get waitingForAccount(): boolean {
    return this.cancelAccountWait !== null;
  }

  /** 判定の通知と期限だけで待つ。停止・ページ移動・非表示では待機を解いて、同じ開始を取り消す。 */
  private waitForAccount(token: number): Promise<string | null> {
    return new Promise((resolve) => {
      let done = false;
      let off = () => {};
      const finish = (id: string | null, cancelled = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        pathListeners.delete(cancel);
        document.removeEventListener('visibilitychange', check);
        window.removeEventListener('pagehide', cancel);
        this.cancelAccountWait = null;
        if (cancelled && token === this.token) this.token++;
        resolve(id);
      };
      const cancel = () => finish(null, true);
      const check = () => {
        if (token !== this.token || !this.d.pageOk() || this.d.isHidden()) return cancel();
        const id = this.d.accountId();
        if (id) finish(id);
      };
      const timer = setTimeout(() => {
        check();
        finish(null);
      }, ACCOUNT_WAIT_MS);
      this.cancelAccountWait = cancel;
      pathListeners.add(cancel);
      document.addEventListener('visibilitychange', check);
      window.addEventListener('pagehide', cancel);
      off = (this.d.subscribeAccount ?? subscribeAccount)(check);
      if (done) off();
      else check(); // 購読の直前に判定された場合も拾う
    });
  }

  constructor(private d: CollectDeps) {
    d.onDataChanged?.(() => {
      if (!this.writing) this.saved = null;
    });
  }

  subscribe(cb: (s: CollectState | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(persist = true): void {
    const s = this.state;
    if (s && persist && s.status !== 'countdown') {
      const { countdown: _c, resumeAt: _r, ...run } = s;
      void this.d.saveRun({ ...run, owner: this.owner, updatedAt: this.d.now() }).catch(() => {});
    }
    this.listeners.forEach((l) => l(s ? { ...s } : null));
  }

  private refuse(reason: CollectReason, accountId: string, speed: CollectSpeed, cap: CollectCap): false {
    this.state = { status: 'stopped', accountId, startedAt: this.d.now(), imported: 0, skipped: 0, failed: 0, speed, cap, reason, updatedAt: this.d.now() };
    this.emit();
    return false;
  }

  /** 開始。同意 (consent) の無いコマンド、ブックマークのタブ以外、アカウントを判定できない / 違うときは始めない */
  async start(cmd: StartCommand): Promise<boolean> {
    if (cmd.consent !== true) return false;
    if (this.starting || (this.state && ['countdown', 'running'].includes(this.state.status))) return false;
    if (!this.d.pageOk() || this.d.isHidden()) return false;
    this.starting = true;
    try {
      return await this.startConfirmed(cmd);
    } finally {
      this.starting = false;
    }
  }

  private async startConfirmed(cmd: StartCommand): Promise<boolean> {
    const token = ++this.token;
    this.resumeToken++;
    const speed = cmd.speed ?? 'slow';
    const cap = cmd.cap ?? 300;
    const account = this.d.accountId() ?? await this.waitForAccount(token);
    if (token !== this.token || !this.d.pageOk() || this.d.isHidden()) return false;
    if (!account) return this.refuse('refused-unknown', cmd.accountId ?? '', speed, cap);
    if (cmd.accountId && cmd.accountId !== account) return this.refuse('refused-account', account, speed, cap);

    // 同じ開始コマンドを、複数のタブが同時に受け取っても、始めるのは 1 つだけ (先に印を付けたほう)
    if (cmd.id) {
      const cur = await this.d.loadRun?.().catch(() => null);
      if (cur?.commandId === cmd.id && cur.owner && cur.owner !== this.owner) return false;
    }
    if (token !== this.token || !this.d.pageOk() || this.d.isHidden()) return false;
    this.state = { status: 'countdown', accountId: account, startedAt: this.d.now(), imported: 0, skipped: 0, failed: 0, speed, cap, countdown: COUNTDOWN_SECONDS, updatedAt: this.d.now(), owner: this.owner, commandId: cmd.id };
    if (cmd.id && !(await this.claim())) {
      this.state = null;
      this.emit(false);
      return false;
    }
    if (token !== this.token) return false;
    // 同意したあとの取り消し用に、開始の 3 秒前に表示する
    for (let sec = COUNTDOWN_SECONDS; sec > 0; sec--) {
      this.state.countdown = sec;
      this.emit(false);
      await this.d.sleep(1000);
      if (token !== this.token) return false;
      if (!this.d.pageOk() || this.d.isHidden()) {
        await this.stop();
        return false;
      }
    }
    this.begin(token, true, true);
    return true;
  }

  /** 開始コマンドの ID と owner を保存データに書き、読み戻して自分のものか確かめる (同時に書いた別のタブがあれば、後から書いたほうが残る) */
  private async claim(): Promise<boolean> {
    const { countdown: _c, resumeAt: _r, ...run } = this.state!;
    try {
      await this.d.saveRun({ ...run, owner: this.owner, updatedAt: this.d.now() });
      const back = await this.d.loadRun?.();
      return !back?.owner || back.owner === this.owner;
    } catch {
      return true; // 記録できなくても、このタブでの取り込みは続ける
    }
  }

  /** rewind: 一覧の先頭から読み直す (開始と、ページの再読み込みのあとの再開)。そうでなければ、いまの位置から続ける */
  private begin(token: number, fresh: boolean, rewind: boolean): void {
    const s = this.state!;
    if (fresh) {
      this.diagnosis.reset();
      this.timedOut.clear();
      this.truncatedIds = [];
      this.adopted = false;
      s.startedAt = this.d.now();
      s.imported = 0;
      s.skipped = 0;
      s.failed = 0;
      s.oldestSeenPostDate = undefined;
      s.recentPostDate = undefined;
      this.recent = [];
    }
    s.status = 'running';
    s.reason = undefined;
    s.countdown = undefined;
    s.resumeAt = undefined;
    if (rewind) {
      this.resetPass();
      this.d.scrollToTop(); // 一覧の先頭から、同じ順にスクロールしていく (取り込み済みは読み飛ばす)
    }
    // 一時停止の最終保存後は seq の順だけで位置を復元できる。失敗して残った seq も順序を保つ。
    this.positions.clear();
    this.nextPosition = 0;
    for (const it of this.seq) this.positions.set(it.tweetId, this.nextPosition++);
    this.streak = 0;
    this.stalled = 0;
    this.moved = true;
    this.segmentStart = this.d.now();
    this.base = s.imported;
    this.emit();
    void this.loop(token);
  }

  private resetPass(): void {
    this.seen = new Set();
    this.seq = [];
    this.pending = [];
    this.mediaRetry.clear();
    this.vanishedRetry.clear();
    this.vanishAttempts.clear();
    this.positions.clear();
    this.streak = 0;
    this.rewind = false;
    this.saved = null; // 取り込みの開始のときに、保存済みの ID を 1 回読む
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

  /**
   * スクロール後の待ち (v32)。上限 (ceiling) は従来の delay()。下限 (floor〜floor×1.5 の乱数、ceiling 以内) を待ったあと、
   * 100ms ごとに新しいポストを調べ、あれば直ちに終える。出なければ ceiling まで待つ (従来と同じ)。
   * X が新しいポストをいつ DOM に出すかは実機未確認。
   */
  private async waitAfterScroll(alive: () => boolean): Promise<void> {
    const ceiling = this.delay();
    const probe = this.d.hasUnseen;
    const floor = Math.min(Math.round(WAIT_FLOORS[this.state!.speed] * (1 + 0.5 * this.d.random())), ceiling);
    let waited = 0;
    while (alive() && waited < ceiling) {
      const step = Math.min(WAIT_STEP_MS, waited < floor ? floor - waited : ceiling - waited);
      await this.d.sleep(step);
      waited += step;
      if (waited >= floor && probe.call(this.d, this.seen)) return;
    }
  }

  private async loop(token: number): Promise<void> {
    const alive = () => token === this.token;
    while (alive()) {
      const g = this.guard();
      if (g) return void (await this.pause(g));
      const fresh = await this.readVisible(token);
      if (!alive()) return;
      this.streak = fresh > 0 ? 0 : this.streak + 1;
      this.stalled = fresh === 0 && !this.moved ? this.stalled + 1 : 0;
      if (this.pending.length >= FLUSH_EVERY) await this.flush();
      if (!alive()) return;
      this.emit();
      if (this.d.hasLimit()) return void (await this.pause('limit'));
      const s = this.state!;
      // 読み直し待ちも終了時には保存するため、上限の枠を空けない。
      if (s.cap > 0 && s.imported + this.vanishedRetry.size - this.base >= s.cap) {
        return void (await this.pause('cap'));
      }
      // 「止めない」でも、一度の取り込みの時間には上限を設ける
      if (s.cap === 0 && this.d.now() - this.segmentStart >= MAX_RUN_MS) return void (await this.pause('time'));
      // 読み込み中の表示が出たままでも、動かず新しいポストも出ない状態が続いたら、終わりとみなす (実機未確認)
      if ((this.streak >= END_STREAK && !this.d.isLoading()) || this.stalled >= STALL_END) return void (await this.finish());
      const y0 = this.d.scrollY();
      this.d.scrollBy(Math.round(this.d.viewportHeight() * SCROLL_RATIO));
      await this.waitAfterScroll(alive);
      if (!alive()) return;
      // X の一覧は下端で追加のポストを読み込む。読み込み中の表示が消えるまで (上限つきで) 待つ
      for (let waited = 0; alive() && waited < LOAD_WAIT_MS && this.d.isLoading(); waited += LOAD_POLL_MS) await this.d.sleep(LOAD_POLL_MS);
      this.moved = this.d.scrollY() > y0;
    }
  }

  /** 画面に出ているポストを読む。X は画面外のポストを DOM から外す (仮想化) ので、スクロールのたびに読む。新しく見つけた件数を返す */
  private async readVisible(token: number): Promise<number> {
    // 時間切れ後の 1 回の補完だけは、既読でも再解析する。
    const excluded = this.timedOut.size
      ? new Set([...this.seen].filter((id) => !this.timedOut.has(id)))
      : this.seen;
    const items = this.d.visible(excluded);
    const saved = (this.saved ??= await this.d.savedIds(this.state!.accountId));
    if (token !== this.token) return 0;
    const s = this.state!;
    await this.rereadTimedOut(items, saved, s.accountId);
    if (token !== this.token) return 0;
    let fresh = 0;
    for (const [index, it] of items.entries()) {
      if (this.seen.has(it.tweetId)) continue; // 同じ取り込みの中で、同じポストを二重に数えない
      if (!this.positions.has(it.tweetId)) this.positions.set(it.tweetId, this.nextPosition++);
      this.vanishedRetry.delete(it.tweetId);
      this.seen.add(it.tweetId);
      fresh++;
      const posted = it.snapshot.createdAt;
      if (posted && (!s.oldestSeenPostDate || posted < s.oldestSeenPostDate)) s.oldestSeenPostDate = posted;
      if (posted) {
        this.recent.push(posted);
        if (this.recent.length > RECENT_POSTS) this.recent.shift();
        const sorted = [...this.recent].sort(); // 偶数件のときは、真ん中の 2 件のうち古い方
        s.recentPostDate = sorted[Math.ceil(sorted.length / 2) - 1];
      }
      if (!saved.has(it.tweetId) && hasPending(it)) {
        this.diagnosis.begin(it, this.d.visiblePosition?.(it.tweetId) ?? index + 1);
        this.mediaRetry.set(it.tweetId, it);
        this.insertSeq({ tweetId: it.tweetId }); // 保存前も画面に出た順序を保つ
        s.imported++; // 上限の数え方を変えず、保存だけを読み込みのあとへ回す
      } else if (saved.has(it.tweetId)) {
        this.insertSeq(it);
        s.skipped++;
      }
      else {
        this.diagnosis.checkUnflagged(it);
        this.insertSeq(it);
        this.pending.push(it);
        s.imported++;
      }
    }
    if (this.mediaRetry.size) await this.settle(token);
    return fresh;
  }

  /** 次画面へ回したポストも、最初に見えた一覧の位置へ戻す。 */
  private insertSeq(it: SeqEntry): void {
    const position = this.positions.get(it.tweetId)!;
    let low = 0;
    let high = this.seq.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.positions.get(this.seq[middle].tweetId)! > position) high = middle;
      else low = middle + 1;
    }
    this.seq.splice(low, 0, it);
  }

  /** 下側の DOM が次のスクロールで戻る想定 (実機未確認の推測)。2 回目は再度外さず保存する。 */
  private deferVanished(it: Extracted): void {
    if (this.vanishAttempts.has(it.tweetId)) return this.acceptMedia(it);
    this.vanishAttempts.add(it.tweetId);
    this.vanishedRetry.set(it.tweetId, it);
    this.mediaRetry.delete(it.tweetId);
    this.seq = this.seq.filter((entry) => entry.tweetId !== it.tweetId);
    this.pending = this.pending.filter((entry) => entry.tweetId !== it.tweetId);
    this.seen.delete(it.tweetId);
    this.state!.imported--;
  }

  /** 時間切れの次の画面で、追加の待ちなしに 1 回だけ確認する。DOM に残る時期は実機未確認の推測。 */
  private async rereadTimedOut(items: Extracted[], saved: ReadonlySet<string>, accountId: string): Promise<void> {
    const sources: Parameters<typeof fillMissing>[0] = [];
    for (const it of items) {
      if (!this.timedOut.delete(it.tweetId) || hasPending(it)) continue;
      const source = fillSource(it);
      if (saved.has(it.tweetId)) {
        sources.push({ tweetId: it.tweetId, snapshot: source });
      } else {
        // 20 件ごとの保存前にも次の画面で見える。保存間隔を保ち、seq と共有する保留内容の欠けだけを補う。
        const pending = this.pending.find((entry) => entry.tweetId === it.tweetId);
        const patch = pending ? missingFields(pending.snapshot, source) : null;
        if (pending && patch) pending.snapshot = { ...pending.snapshot, ...patch };
      }
    }
    if (sources.length) await (this.d.fillMissing ?? fillMissing)(sources, accountId).catch(() => 0);
  }

  /**
   * 読み込み中のポストが読み込み終わる (hasPending が偽になる) か、合計 SETTLE_MAX_MS 待つまで、短い間隔で画面を読み直す。
   * DOM に無いポストは最初の検知で次画面へ回す。リンクが残る読めない状態は最後の値で保存する。
   * 次画面への読み直し・2 回目の消失・終了時の保存は v54 の仕組みを使う。
   * 待ちの長さは、実際の時計ではなく待った刻みの合計で数える。一時停止・停止 (token の変化) では、待たずに戻る
   */
  private async settle(token: number): Promise<void> {
    this.diagnosis.screen();
    let waited = 0;
    while (this.mediaRetry.size) {
      const step = SETTLE_POLL_MS + Math.round(this.d.random() * SETTLE_POLL_JITTER_MS);
      await this.d.sleep(step);
      waited += step;
      if (token !== this.token) return; // 残りは flush(true) が、最後に読めた値で保存する
      this.diagnosis.step(step);
      const waiting = new Set(this.mediaRetry.keys());
      const visible = new Map(this.d.visible(undefined, waiting).map((it) => [it.tweetId, it]));
      for (const [id, last] of [...this.mediaRetry]) {
        const current = visible.get(id);
        if (!current) {
          const reason = hasTweetStatusLink(document, id) ? 'unreadable' : 'removed';
          this.diagnosis.complete(id, 'vanished', reason, { disappearedAfterMs: waited });
          if (reason === 'removed') this.deferVanished(last);
          else this.acceptMedia(last);
        }
        else {
          if (!hasPending(current) || waited >= SETTLE_MAX_MS) {
            this.diagnosis.complete(id, hasPending(current) ? 'timedOut' : 'resolved');
            if (hasPending(current)) this.timedOut.add(id);
            this.acceptMedia(current);
          }
          else this.mediaRetry.set(id, current);
        }
      }
    }
  }

  private acceptMedia(it: Extracted): void {
    this.mediaRetry.delete(it.tweetId);
    const at = this.seq.findIndex((entry) => entry.tweetId === it.tweetId);
    if (at >= 0) this.seq[at] = it;
    this.pending.push(it);
  }

  /**
   * たまった新しいポストを保存する (一覧の位置から savedAt を決める)。保存は 1 つずつ順に行う。
   * 保存できなかった分は pending に戻し、次の保存で (seq ごと) もう一度保存する。
   * 「失敗」に数えるのは、final (一時停止・停止・完了の保存) でも保存できなかった分だけ。
   */
  private flush(final = false): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (!this.state) return;
      if (final) {
        for (const it of this.vanishedRetry.values()) {
          this.insertSeq(it);
          this.pending.push(it);
          this.seen.add(it.tweetId);
          this.state.imported++;
        }
        this.vanishedRetry.clear();
      }
      // 停止時には追加の読み取りをせず、保留していた最初の内容も保存する。
      if (final) for (const it of this.mediaRetry.values()) {
        this.diagnosis.complete(it.tweetId, 'forced');
        this.acceptMedia(it);
      }
      if (!this.pending.length) return;
      // 読み直し待ちより後ろを先に保存すると、戻ったポストの savedAt が逆転する。
      let firstVanished = Infinity;
      for (const id of this.vanishedRetry.keys()) firstVanished = Math.min(firstVanished, this.positions.get(id)!);
      const deferredAt = this.seq.findIndex((it) =>
        this.mediaRetry.has(it.tweetId) || this.positions.get(it.tweetId)! > firstVanished,
      );
      const sent = deferredAt < 0 ? this.seq : this.seq.slice(0, deferredAt);
      const ready = new Set(sent.map((it) => it.tweetId));
      const batch = this.pending.filter((it) => ready.has(it.tweetId));
      if (batch.length === 0) return;
      this.pending = this.pending.filter((it) => !ready.has(it.tweetId));
      this.writing = true;
      try {
        await this.d.addCollected(sent, this.state.startedAt, this.state.accountId);
        for (const it of batch) {
          this.saved?.add(it.tweetId);
          if (it.snapshot.truncated) this.truncatedIds.push(it.tweetId); // 全文の要求は、保存できたものだけ
        }
        // 保存できた分は、いちばん下の 1 件の ID だけ残して捨てる (次の保存の並び順の基準。メモリを増やさず、保存も差分だけにする)
        const last = sent[sent.length - 1];
        if (last) this.seq = [{ tweetId: last.tweetId }, ...this.seq.slice(sent.length)];
        // 並び順の基準・未保存・読み直し待ち以外の位置は今後参照しない。
        const retained = new Set(this.seq.map((it) => it.tweetId));
        for (const id of this.vanishedRetry.keys()) retained.add(id);
        for (const id of this.positions.keys()) if (!retained.has(id)) this.positions.delete(id);
      } catch {
        if (final) {
          this.state.failed += batch.length;
          this.state.imported -= batch.length;
        } else this.pending = [...batch, ...this.pending];
      } finally {
        this.writing = false;
      }
    });
    return this.flushing;
  }

  async pause(reason: CollectReason = 'user'): Promise<void> {
    const s = this.state;
    if (!s || s.status !== 'running') return;
    this.token++;
    await this.flush(true);
    this.positions.clear();
    s.status = reason === 'limit' ? 'limit' : 'paused';
    s.reason = reason;
    this.diagnosis.report();
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
    if (!(await this.resume())) {
      // 予約の時刻に再開できなかった (タブが見えていない、など)。予約の表示を消し、止まったままにする (「再開」は押せる)
      s.resumeAt = undefined;
      this.emit(false);
    }
  }

  /** 停止 / ここで終了: そこまでの分は保存する */
  async stop(): Promise<void> {
    this.token++;
    this.resumeToken++;
    this.cancelAccountWait?.();
    const s = this.state;
    if (!s) return;
    if (s.status === 'countdown') {
      this.positions.clear();
      this.state = null;
      await this.d.clearRun().catch(() => {});
      this.emit(false);
      return;
    }
    if (['stopped', 'done'].includes(s.status)) return;
    await this.flush(true);
    this.positions.clear();
    s.status = 'stopped';
    this.timedOut.clear();
    s.reason = 'user';
    s.resumeAt = undefined;
    this.diagnosis.report();
    this.emit();
  }

  private async finish(): Promise<void> {
    const s = this.state!;
    this.token++;
    await this.flush(true);
    this.positions.clear();
    s.status = 'done';
    this.timedOut.clear();
    s.reason = undefined;
    this.diagnosis.report();
    this.emit();
  }

  /** パネルの「閉じる」。終わった状態を画面から消す (保存済みの記録は残す) */
  dismiss(): void {
    if (this.state && ['stopped', 'done'].includes(this.state.status)) {
      this.state = null;
      this.emit(false);
      void this.d.clearRun().catch(() => {}); // 終わった状態は、保存してある記録も消す (管理画面で開き直しても出ない)
    }
  }

  onHidden(): void {
    this.cancelAccountWait?.();
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
    if (this.d.isHidden()) return; // 見えているタブだけが引き継ぐ (見えるようになったら onVisible)
    if (!['countdown', 'running', 'paused', 'limit'].includes(run.status)) return;
    this.state = { ...run, status: run.status === 'limit' ? 'limit' : 'paused', reason: run.status === 'limit' ? 'limit' : 'reload' };
    this.rewind = true;
    this.adopted = true;
    this.emit(); // owner を自分の ID に書き換えて保存する
  }

  /** タブが見えるようになった: まだ引き継いでいなければ、保存してある取り込みを引き継ぐ */
  onVisible(): void {
    if (this.state || !this.d.loadRun) return;
    void this.d.loadRun().then((run) => this.adopt(run)).catch(() => {});
  }

  /**
   * 保存してある取り込みの記録が変わった。別のタブが引き継いだ (owner が自分でない) なら、
   * 自分の取り込みを止めて状態を消し、パネルを閉じる。
   */
  onRunChanged(run: CollectRun | null): void {
    // 終わった状態の記録が (管理画面などで閉じられて) 消えたら、このタブのパネルも閉じる
    if (!run && this.state && ['stopped', 'done'].includes(this.state.status)) {
      this.state = null;
      return this.emit(false);
    }
    if (!this.state || !run?.owner || run.owner === this.owner) return;
    this.token++;
    this.resumeToken++;
    this.pending = [];
    this.mediaRetry.clear();
    this.state = null;
    this.timedOut.clear();
    this.vanishedRetry.clear();
    this.vanishAttempts.clear();
    this.positions.clear();
    this.emit(false);
  }

  /** 保存してある記録の owner が、このタブか (記録が無い / owner が無いときは、このタブ) */
  async ownsRun(): Promise<boolean> {
    const run = await (this.d.loadRun?.() ?? getCollectRun()).catch(() => null);
    if (!run?.owner || run.owner === this.owner) return true;
    this.onRunChanged(run);
    return false;
  }

  /**
   * 取り込みで保存できた、たたまれたポストの ID を渡して、空にする (終わった / 止めたあとに 1 回)。
   * 引き継いだあと (adopted) は、それまでの分の ID が無いので、scan: true を返す: 全文取得のキューを、保存データの truncated から作り足す。
   */
  takeTruncated(): { ids: string[]; scan: boolean } {
    const ids = this.truncatedIds;
    this.truncatedIds = [];
    const scan = this.adopted;
    this.adopted = false;
    return { ids, scan };
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
  if (cmd.type === 'stop' && c.waitingForAccount) {
    await clearCollectCommand();
    await c.stop();
    return;
  }
  if (!c.state) return;
  if (!(await c.ownsRun())) return; // 取り込みを動かしているのは別のタブ。そのタブが実行する
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
    // 終わった / 止めたあとに、取り込んだ分のうち、たたまれていたものの全文を取る (動いている間は取らない。件数の上限は background が 30 件にする)
    if ((s?.status === 'done' || s?.status === 'stopped') && lastStatus !== s.status) {
      const { ids, scan } = c.takeTruncated();
      requestFullTextBatch(s.accountId, ids, scan);
    }
    lastStatus = s?.status;
    onState(s, c);
  });
  const tick = () => void handleCollectCommand(c, d).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') c.onHidden();
    else {
      c.onVisible();
      tick();
    }
  });
  onCollectRunChanged(() => void getCollectRun().then((run) => c.onRunChanged(run)).catch(() => {}));
  subscribeAccount((a) => c.onAccountChanged(a?.id ?? null));
  onCollectCommand(tick);
  void getCollectRun().then((run) => {
    c.adopt(run);
    tick();
  });
  return c;
}
