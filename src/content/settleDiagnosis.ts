import type { Extracted } from './snapshot';

type Outcome = 'resolved' | 'timedOut' | 'vanished' | 'forced';
type Vanished = 'unreadable' | 'removed';
type PendingKind = 'avatar' | 'media' | 'quoteAvatar';
type VanishTiming = { disappearedAfterMs: number };
type Waiting = {
  tweetId: string;
  pending: PendingKind[];
  position: number;
  waitedMs: number;
  startedAt: number;
  visibilityStart: DocumentVisibilityState;
};
type Result = Omit<Waiting, 'startedAt'> & {
  reason: Outcome;
  elapsedMs: number;
  visibilityEnd: DocumentVisibilityState;
  vanished?: Vanished;
  disappearedAfterMs?: number;
};
const RECORD_LIMIT = 50;

/** 待ちの結果だけを実行中のメモリで数える。本文・名前・ハンドル・URL は保持せず、保存処理に関与しない。 */
export class SettleDiagnosis {
  private active = new Map<string, Waiting>();
  private counts = { resolved: 0, timedOut: 0, vanished: 0, forced: 0, unflagged: 0, vanishedGone: 0 };
  private vanished = { unreadable: 0, removed: 0 };
  private unresolved: Result[] = [];
  private unflagged: string[] = [];
  private screens = 0;
  private reported = false;

  constructor(private now: () => number) {}

  /** 新しい取り込みだけでリセットする。同じ取り込みの一時停止・再開では出力を増やさない。 */
  reset(): void {
    this.active.clear();
    this.counts = { resolved: 0, timedOut: 0, vanished: 0, forced: 0, unflagged: 0, vanishedGone: 0 };
    this.vanished = { unreadable: 0, removed: 0 };
    this.unresolved = [];
    this.unflagged = [];
    this.screens = 0;
    this.reported = false;
  }

  /** 画面内で新しく待ちを始めるポスト。同じ待ちの再通知では開始時の記録を保つ。 */
  begin(it: Extracted, position: number): void {
    // complete が待ちを閉じ、reset が新しい実行を始める。active に残る ID は同じ待ち。
    if (this.active.has(it.tweetId)) return;
    const pending: PendingKind[] = [];
    if (it.avatarPending) pending.push('avatar');
    if (it.mediaPending) pending.push('media');
    if (it.quoteAvatarPending) pending.push('quoteAvatar');
    this.active.set(it.tweetId, {
      tweetId: it.tweetId, pending, position, waitedMs: 0,
      startedAt: this.now(), visibilityStart: document.visibilityState,
    });
  }

  /** settle を始めた画面の回数。ポストの件数や読み直しの回数とは区別する。 */
  screen(): void {
    this.screens++;
  }

  /** 完了した sleep の刻みを加算する。途中で中断した刻みは elapsedMs のみに現れる。 */
  step(ms: number): void {
    for (const record of this.active.values()) record.waitedMs += ms;
  }

  /** 保存へ回す分岐の理由を数える。未解決の詳細だけ先頭 50 件を残す。 */
  complete(tweetId: string, reason: Outcome, vanished?: Vanished, timing?: VanishTiming): void {
    const record = this.active.get(tweetId);
    if (!record) return;
    this.active.delete(tweetId);
    this.counts[reason]++;
    if (reason === 'vanished') this.counts.vanishedGone++;
    if (vanished) this.vanished[vanished]++;
    if (reason === 'resolved' || this.unresolved.length >= RECORD_LIMIT) return;
    const { startedAt, ...fields } = record;
    this.unresolved.push({
      ...fields, reason, elapsedMs: this.now() - startedAt,
      visibilityEnd: document.visibilityState,
      ...(vanished ? { vanished } : {}),
      ...timing,
    });
  }

  /** 待ちの印が無いまま新規保存へ回る欠け。保存済みのスキップは数えない。 */
  checkUnflagged(it: Extracted): void {
    const { avatar, media, hasVideo, text } = it.snapshot;
    if (avatar && (media.length || hasVideo || text)) return;
    this.counts.unflagged++;
    if (this.unflagged.length < RECORD_LIMIT) this.unflagged.push(it.tweetId);
  }

  /** 最初の一時停止・停止・完了で 1 回だけ、後から変化しないオブジェクトを出力する。 */
  report(): void {
    if (this.reported) return;
    this.reported = true;
    console.info('[PostShelf] settle summary', {
      counts: { ...this.counts }, vanished: { ...this.vanished }, screens: this.screens,
      unresolved: [...this.unresolved], unflagged: [...this.unflagged],
    });
  }
}
