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
import { isBookmarksPath, queryFirst, timelineLoading } from '../shared/selectors';
import {
  clearCollectCommand, clearCollectRun, getCollectRun, getSettings, onCollectCommand, onCollectRunChanged, peekCollectCommand, saveCollectRun, setCollectOffer,
  type CollectCap, type CollectCommand, type CollectReason, type CollectRun, type CollectSpeed,
} from '../shared/settings';
import { addCollected, getSavedIds, onDataChanged } from '../shared/storage';
import { requestFullTextBatch } from '../shared/cacheRequest';
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
/** 動かない (scrollY が増えない) うえに新しいポストも出ない状態がこの回数続いたら、読み込み中の表示があっても終わりとみなす */
export const STALL_END = 3;
/** 「止めない」を選んだときの、一度の取り込みの時間の上限 */
export const MAX_RUN_MS = 2 * 60 * 60 * 1000;
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
  /** いまのスクロール位置 (動かなくなったことの判定用) */
  scrollY(): number;
  viewportHeight(): number;
  visible(): Extracted[];
  isLoading(): boolean;
  hasLimit(): boolean;
  /** /i/history のブックマークのタブか (/i/history/likes などは false) */
  pageOk(): boolean;
  isHidden(): boolean;
  accountId(): string | null;
  /** 保存先は取り込みを始めたアカウント (state.accountId)。画面の現在のアカウントではない */
  savedIds(accountId: string): Promise<Set<string>>;
  /** 保存データが (他の場所で) 変わったら呼ばれる。解除関数を返す */
  onDataChanged?(cb: () => void): () => void;
  /** 保存してある取り込みの記録 (owner / commandId の確認用) */
  loadRun?(): Promise<CollectRun | null>;
  /** seq = 画面に出た順の全ポスト。保存の savedAt は一覧での位置から決める (ordering.ts) */
  addCollected(seq: Extracted[], startedAt: number, accountId: string): Promise<number>;
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
    scrollY: () => window.scrollY,
    viewportHeight: () => window.innerHeight,
    visible: () => collectVisible(),
    isLoading: () => timelineLoading(document),
    hasLimit: () => !!queryFirst(document, 'xError'),
    pageOk: () => isBookmarksPath(location.pathname),
    isHidden: () => document.visibilityState === 'hidden',
    accountId: () => getCurrentAccount()?.id ?? null,
    savedIds: (accountId) => getSavedIds(accountId),
    onDataChanged: (cb) => onDataChanged(cb),
    loadRun: () => getCollectRun(),
    addCollected: (seq, startedAt, accountId) => addCollected(seq, startedAt, accountId),
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
  /** この取り込みで取り込んだ、たたまれた (truncated) ポストの ID。終わってから、全文の取得を依頼する (v24) */
  private truncatedIds: string[] = [];
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
  async start(cmd: Pick<CollectCommand, 'consent' | 'speed' | 'cap' | 'accountId'> & { id?: string }): Promise<boolean> {
    if (cmd.consent !== true) return false;
    if (this.state && ['countdown', 'running'].includes(this.state.status)) return false;
    if (!this.d.pageOk()) return false;
    const speed = cmd.speed ?? 'slow';
    const cap = cmd.cap ?? 300;
    const account = this.d.accountId();
    if (!account) return this.refuse('refused-unknown', cmd.accountId ?? '', speed, cap);
    if (cmd.accountId && cmd.accountId !== account) return this.refuse('refused-account', account, speed, cap);

    // 同じ開始コマンドを、複数のタブが同時に受け取っても、始めるのは 1 つだけ (先に印を付けたほう)
    if (cmd.id) {
      const cur = await this.d.loadRun?.().catch(() => null);
      if (cur?.commandId === cmd.id && cur.owner && cur.owner !== this.owner) return false;
    }
    const token = ++this.token;
    this.resumeToken++;
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
      this.truncatedIds = [];
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
      if (s.cap > 0 && s.imported - this.base >= s.cap) return void (await this.pause('cap'));
      // 「止めない」でも、一度の取り込みの時間には上限を設ける
      if (s.cap === 0 && this.d.now() - this.segmentStart >= MAX_RUN_MS) return void (await this.pause('time'));
      // 読み込み中の表示が出たままでも、動かず新しいポストも出ない状態が続いたら、終わりとみなす (実機未確認)
      if ((this.streak >= END_STREAK && !this.d.isLoading()) || this.stalled >= STALL_END) return void (await this.finish());
      const y0 = this.d.scrollY();
      this.d.scrollBy(Math.round(this.d.viewportHeight() * SCROLL_RATIO));
      await this.d.sleep(this.delay());
      if (!alive()) return;
      // X の一覧は下端で追加のポストを読み込む。読み込み中の表示が消えるまで (上限つきで) 待つ
      for (let waited = 0; alive() && waited < LOAD_WAIT_MS && this.d.isLoading(); waited += LOAD_POLL_MS) await this.d.sleep(LOAD_POLL_MS);
      this.moved = this.d.scrollY() > y0;
    }
  }

  /** 画面に出ているポストを読む。X は画面外のポストを DOM から外す (仮想化) ので、スクロールのたびに読む。新しく見つけた件数を返す */
  private async readVisible(token: number): Promise<number> {
    const items = this.d.visible();
    const saved = (this.saved ??= await this.d.savedIds(this.state!.accountId));
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
        if (it.snapshot.truncated) this.truncatedIds.push(it.tweetId);
      }
    }
    return fresh;
  }

  /**
   * たまった新しいポストを保存する (一覧の位置から savedAt を決める)。保存は 1 つずつ順に行う。
   * 保存できなかった分は pending に戻し、次の保存で (seq ごと) もう一度保存する。
   * 「失敗」に数えるのは、final (一時停止・停止・完了の保存) でも保存できなかった分だけ。
   */
  private flush(final = false): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      const batch = this.pending;
      this.pending = [];
      if (batch.length === 0 || !this.state) return;
      this.writing = true;
      try {
        await this.d.addCollected(this.seq, this.state.startedAt, this.state.accountId);
        for (const it of batch) this.saved?.add(it.tweetId);
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
    if (!(await this.resume())) {
      // 予約の時刻に再開できなかった (タブが見えていない、など)。予約の表示を消し、止まったままにする (「再開」は押せる)
      s.resumeAt = undefined;
      this.emit(false);
    }
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
    await this.flush(true);
    s.status = 'stopped';
    s.reason = 'user';
    s.resumeAt = undefined;
    this.emit();
  }

  private async finish(): Promise<void> {
    const s = this.state!;
    this.token++;
    await this.flush(true);
    s.status = 'done';
    s.reason = undefined;
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
    this.state = null;
    this.emit(false);
  }

  /** 保存してある記録の owner が、このタブか (記録が無い / owner が無いときは、このタブ) */
  async ownsRun(): Promise<boolean> {
    const run = await (this.d.loadRun?.() ?? getCollectRun()).catch(() => null);
    if (!run?.owner || run.owner === this.owner) return true;
    this.onRunChanged(run);
    return false;
  }

  /** 取り込みで取り込んだ、たたまれたポストの ID を渡して、空にする (終わった / 止めたあとに 1 回) */
  takeTruncated(): string[] {
    const ids = this.truncatedIds;
    this.truncatedIds = [];
    return ids;
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
    if ((s?.status === 'done' || s?.status === 'stopped') && lastStatus !== s.status) requestFullTextBatch(s.accountId, c.takeTruncated());
    lastStatus = s?.status;
    onState(s, c);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') c.onHidden();
    else c.onVisible();
  });
  onCollectRunChanged(() => void getCollectRun().then((run) => c.onRunChanged(run)).catch(() => {}));
  subscribeAccount((a) => c.onAccountChanged(a?.id ?? null));
  const tick = () => void handleCollectCommand(c, d).catch(() => {});
  onCollectCommand(tick);
  void getCollectRun().then((run) => {
    c.adopt(run);
    tick();
  });
  return c;
}
