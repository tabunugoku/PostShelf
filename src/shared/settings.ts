import type { SortKey } from './query';

/** 設定ストア。chrome.storage.local の別キー (`settings`)。storage.ts と同様、直接 chrome.storage を触るのはここだけ。 */
export interface Settings {
  /** フォルダ保存に合わせて X 本来のブックマークも付ける/外す (既定オフ) */
  syncNative: boolean;
  /** x.com の標準ブックマークボタンの扱い。separate: 横に PostShelf のボタンを足す / replace: 標準ボタンのクリックを PostShelf のフォルダ選択に差し替える */
  buttonMode: ButtonMode;
  /** ツールバーアイコンのクリック時の動作。popup: ポップアップ / sidepanel: サイドパネルを開く */
  actionMode: ActionMode;
  /** manager の表示状態 (最後に開いたビュー / 表示形式 / 並べ替え)。chrome.storage.local に保存 (localStorage は使わない) */
  lastFolderId: string;
  viewMode: ViewMode;
  sortKey: SortKey;
}

export type ViewMode = 'post' | 'list' | 'grid';

export type ActionMode = 'popup' | 'sidepanel';

export type ButtonMode = 'separate' | 'replace';

export const DEFAULT_SETTINGS: Settings = { syncNative: false, buttonMode: 'separate', actionMode: 'popup', lastFolderId: 'all', viewMode: 'post', sortKey: 'savedDesc' };

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  const stored = (res[KEY] ?? {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (merged.buttonMode !== 'replace') merged.buttonMode = 'separate'; // 不正値は既定に戻す
  if (merged.actionMode !== 'sidepanel') merged.actionMode = 'popup';
  if (!['post', 'list', 'grid'].includes(merged.viewMode)) merged.viewMode = 'post';
  if (!['savedDesc', 'savedAsc', 'postedDesc', 'postedAsc'].includes(merged.sortKey)) merged.sortKey = 'savedDesc';
  if (typeof merged.lastFolderId !== 'string') merged.lastFolderId = 'all';
  return merged;
}

/** 設定が変わったら呼ばれる (別タブ・manager からの変更も拾う)。解除関数を返す */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && KEY in changes) void getSettings().then(cb);
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

// ---- 取り込み案内 (manager のバナー用) ----
// /i/bookmarks を開いたときに content script が「画面に出ている未取り込みの件数」を記録する。manager はそれを読んで案内を出す。
// 閉じた時点の件数 (dismissed) を保存し、記録された件数がそれを超えたときだけ再表示する。

export interface ImportHint {
  /** 最後に観測した未取り込み件数 */
  pending: number;
  /** バナーを閉じた時点の件数 */
  dismissed: number;
}

const HINT_KEY = 'importHint';

export async function getImportHint(): Promise<ImportHint> {
  const res = await chrome.storage.local.get(HINT_KEY);
  const h = (res[HINT_KEY] ?? {}) as Partial<ImportHint>;
  return { pending: Number(h.pending) || 0, dismissed: Number(h.dismissed) || 0 };
}

/** 観測した件数を記録する。件数が減ったら (取り込んだ等)、閉じた時点の件数も下げて、次の増加で再び案内できるようにする */
export async function recordPending(pending: number): Promise<void> {
  const h = await getImportHint();
  if (h.pending === pending && h.dismissed <= pending) return;
  await chrome.storage.local.set({ [HINT_KEY]: { pending, dismissed: Math.min(h.dismissed, pending) } });
}

export async function dismissImportHint(): Promise<void> {
  const h = await getImportHint();
  await chrome.storage.local.set({ [HINT_KEY]: { ...h, dismissed: h.pending } });
}

export const shouldShowImportHint = (h: ImportHint): boolean => h.pending > h.dismissed;

export function onImportHintChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && HINT_KEY in changes) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}
