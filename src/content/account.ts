/**
 * 現在ログイン中の X アカウントの判定 (ユーザーが見ている画面の DOM だけを読む。非公開 API は呼ばない)。
 * セレクタは selectors.ts (accountSwitcher)。読めなければ null を返し、例外にしない。
 * 判定できないときは保存・取り込みをしない (popover / collect が current === null を見て無効にする)。
 */
import { UNKNOWN_ACCOUNT_ID, accountIdOf, type Account } from '../shared/models';
import {
  closestFirst,
  handleFromAvatarTestId,
  queryAllFirst,
  queryEveryCandidate,
  queryFirst,
  selfOrDescendant,
} from '../shared/selectors';
import { noteAccount, setAccountScope } from '../shared/storage';
import { watchBody } from './domwatch';

export interface DetectedAccount {
  handle: string;
  displayName?: string;
  avatar?: string;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const validHandle = (h: string | undefined | null): h is string => !!h && HANDLE.test(h) && accountIdOf(h) !== UNKNOWN_ACCOUNT_ID;

/** 1 つの要素からハンドルを読む: 文字の @ハンドル → data-testid=UserAvatar-Container-ハンドル → リンクの href (/ハンドル) */
function handleFrom(el: Element): string | null {
  const text = el.textContent?.match(/@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/)?.[1];
  if (validHandle(text)) return text;
  const avatar = selfOrDescendant(el, 'accountAvatarHandle');
  const fromTestId = avatar ? handleFromAvatarTestId(avatar) : undefined;
  if (validHandle(fromTestId)) return fromTestId;
  const link = closestFirst(el, 'anyLink')?.el ?? queryFirst(el, 'anyLink')?.el ?? el;
  const href = link.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1];
  return validHandle(href) ? href : null;
}

/** 左メニューのアカウント表示から、ハンドル・表示名・アバターを読む。読めなければ null */
export function detectAccount(root: ParentNode = document): DetectedAccount | null {
  for (const { el } of queryEveryCandidate(root, 'accountSwitcher')) {
    const handle = handleFrom(el);
    if (!handle) continue;
    // 表示名: ボタン内の、@ で始まらない最初のテキスト (表示名とハンドルが別の要素に入っている想定。実機未確認)
    const displayName = queryAllFirst(el, 'accountLabel').els
      .filter((n) => n.children.length === 0)
      .map((n) => n.textContent?.trim() ?? '')
      .find((x) => x !== '' && !x.startsWith('@'));
    const avatar = queryFirst<HTMLImageElement>(el, 'accountAvatar')?.el.src || undefined;
    return { handle, displayName: displayName || undefined, avatar };
  }
  return null;
}

// ---- 現在のアカウント (content script 内のメモリ) ----

let current: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();

export const getCurrentAccount = (): Account | null => current;

/** アカウントが変わった (判定できた / 切り替わった) ときに呼ばれる。解除関数を返す */
export function subscribeAccount(cb: (a: Account | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 現在のアカウントを設定し、保存層の対象アカウントも合わせる (テストからも使う) */
export function setCurrentAccount(a: Account | null): void {
  const changed = (current?.id ?? null) !== (a?.id ?? null);
  current = a;
  setAccountScope(a?.id ?? UNKNOWN_ACCOUNT_ID);
  if (changed) listeners.forEach((l) => l(a));
}

/** 画面から読み直し、見えていてフォーカスのあるタブだけ記録する。読めなければ直前の判定を使う */
export function refreshAccount(root: ParentNode = document): void {
  const d = detectAccount(root);
  if (!d) return;
  setCurrentAccount({ id: accountIdOf(d.handle), handle: d.handle, displayName: d.displayName, avatar: d.avatar, lastSeenAt: Date.now() });
  // 裏のタブでも保存先の判定は進めるが、最後に見たアカウントは上書きしない。
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    void noteAccount(d).catch(() => {});
  }
}

const CHECK_EVERY_MS = 2000;
let lastCheck = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** DOM の変化から呼ぶ。2 秒に 1 回までにまとめる */
export function scheduleAccountCheck(now = Date.now()): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    lastCheck = Date.now();
    refreshAccount();
  }, Math.max(0, lastCheck + CHECK_EVERY_MS - now));
}

/** テスト用 */
export function resetAccount(): void {
  clearTimeout(timer);
  timer = undefined;
  lastCheck = 0;
  current = null;
  setAccountScope(UNKNOWN_ACCOUNT_ID);
}

/** アカウントの監視を始め、DOM・表示・フォーカスの購読と予約済みの確認を解除する関数を返す */
export function initAccount(): () => void {
  scheduleAccountCheck();
  const unwatch = watchBody(() => scheduleAccountCheck());
  // 復帰時は DOM が変わらなくても即座に読む。ブラウザのイベント順は実機未確認。
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refreshAccount();
  };
  const onFocus = () => refreshAccount();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  return () => {
    unwatch();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    clearTimeout(timer);
    timer = undefined;
  };
}
