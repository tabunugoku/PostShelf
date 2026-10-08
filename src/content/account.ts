/**
 * 現在ログイン中の X アカウントの判定 (ユーザーが見ている画面の DOM だけを読む。非公開 API は呼ばない)。
 * セレクタは selectors.ts (accountSwitcher)。読めなければ null を返し、例外にしない。
 * 判定できないときは保存・取り込みをしない (popover / collect が current === null を見て無効にする)。
 */
import { UNKNOWN_ACCOUNT_ID, accountIdOf, type Account } from '../shared/models';
import { queryEveryCandidate } from '../shared/selectors';
import { noteAccount, setAccountScope } from '../shared/storage';

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
  const avatar = el.matches('[data-testid^="UserAvatar-Container-"]') ? el : el.querySelector('[data-testid^="UserAvatar-Container-"]');
  const fromTestId = avatar?.getAttribute('data-testid')?.slice('UserAvatar-Container-'.length);
  if (validHandle(fromTestId)) return fromTestId;
  const href = (el.closest('a') ?? el.querySelector('a') ?? el).getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1];
  return validHandle(href) ? href : null;
}

/** 左メニューのアカウント表示から、ハンドル・表示名・アバターを読む。読めなければ null */
export function detectAccount(root: ParentNode = document): DetectedAccount | null {
  for (const { el } of queryEveryCandidate(root, 'accountSwitcher')) {
    const handle = handleFrom(el);
    if (!handle) continue;
    // 表示名: ボタン内の、@ で始まらない最初のテキスト (表示名とハンドルが別の要素に入っている想定。実機未確認)
    const displayName = [...el.querySelectorAll('span,div')]
      .filter((n) => n.children.length === 0)
      .map((n) => n.textContent?.trim() ?? '')
      .find((x) => x !== '' && !x.startsWith('@'));
    const avatar = el.querySelector<HTMLImageElement>('img')?.src || undefined;
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

/** 画面から読み直す。読めたら記録する (lastSeenAccount)。読めなければ直前の判定をそのまま使う */
export function refreshAccount(root: ParentNode = document): void {
  const d = detectAccount(root);
  if (!d) return;
  setCurrentAccount({ id: accountIdOf(d.handle), handle: d.handle, displayName: d.displayName, avatar: d.avatar, lastSeenAt: Date.now() });
  void noteAccount(d).catch(() => {});
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

export function initAccount(): void {
  scheduleAccountCheck();
  new MutationObserver(() => scheduleAccountCheck()).observe(document.body, { childList: true, subtree: true });
}
