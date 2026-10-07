/**
 * 保存層。chrome.storage.local へのアクセスはこのファイルに集約する。
 * 組み込みフォルダ「すべて」は保存せず、listFolders が先頭に付与する。
 */
import {
  ALL_FOLDER,
  COLORS,
  FOLDER_ICON,
  ICONS,
  INBOX_ID,
  isBuiltinFolder,
  supportsColor,
  type Bookmark,
  type Folder,
} from './models';
import { t } from './strings';

const KEY_FOLDERS = 'folders';
const KEY_BOOKMARKS = 'bookmarks';

export class StorageError extends Error {}

async function read<T>(key: string, fallback: T): Promise<T> {
  const res = await chrome.storage.local.get(key);
  return (res[key] as T | undefined) ?? fallback;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

const readFolders = () => read<Folder[]>(KEY_FOLDERS, []);

function newId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(name: string): string {
  const n = name.trim();
  if (!n) throw new StorageError(t('errEmptyName'));
  return n;
}

function checkIcon(icon: string): void {
  if (!(ICONS as readonly string[]).includes(icon)) throw new StorageError(t('errInvalidIcon'));
}

function checkColor(color: string): void {
  if (!(COLORS as readonly string[]).includes(color)) throw new StorageError(t('errInvalidColor'));
}

/** 「すべて」+ 保存済みフォルダ (order 昇順) */
export async function listFolders(): Promise<Folder[]> {
  const folders = await readFolders();
  // 「未分類」は常に「すべて」の次。残りは order 昇順
  const rank = (f: Folder) => (f.id === INBOX_ID ? -Infinity : f.order);
  return [ALL_FOLDER, ...[...folders].sort((a, b) => rank(a) - rank(b))];
}

export async function createFolder(input: {
  name: string;
  icon?: string;
  color?: string;
}): Promise<Folder> {
  const name = normalizeName(input.name);
  const icon = input.icon ?? FOLDER_ICON;
  checkIcon(icon);
  const folders = await readFolders();
  const folder: Folder = {
    id: newId(),
    name,
    icon,
    order: folders.reduce((m, f) => Math.max(m, f.order), -1) + 1,
  };
  if (input.color !== undefined && supportsColor(icon)) {
    checkColor(input.color);
    folder.color = input.color;
  }
  await write(KEY_FOLDERS, [...folders, folder]);
  return folder;
}

export async function updateFolder(
  id: string,
  patch: { name?: string; icon?: string; color?: string | null },
): Promise<Folder> {
  if (isBuiltinFolder(id)) throw new StorageError(t('errBuiltinImmutable'));
  const folders = await readFolders();
  const idx = folders.findIndex((f) => f.id === id);
  if (idx < 0) throw new StorageError(t('errNotFound'));
  const next: Folder = { ...folders[idx] };
  if (patch.name !== undefined) next.name = normalizeName(patch.name);
  if (patch.icon !== undefined) {
    checkIcon(patch.icon);
    next.icon = patch.icon;
  }
  if (patch.color !== undefined) {
    if (patch.color === null) delete next.color;
    else {
      checkColor(patch.color);
      next.color = patch.color;
    }
  }
  // 色はフォルダアイコンのときだけ有効。他のアイコンでは破棄する。
  if (!supportsColor(next.icon)) delete next.color;
  folders[idx] = next;
  await write(KEY_FOLDERS, folders);
  return next;
}

/** フォルダを削除し、ブックマークからも folderId を外す (ポスト自体は残す) */
export async function deleteFolder(id: string): Promise<void> {
  if (isBuiltinFolder(id)) throw new StorageError(t('errBuiltinImmutable'));
  const folders = await readFolders();
  if (!folders.some((f) => f.id === id)) throw new StorageError(t('errNotFound'));
  const bookmarks = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  for (const b of Object.values(bookmarks)) b.folderIds = b.folderIds.filter((x) => x !== id);
  await write(KEY_FOLDERS, folders.filter((f) => f.id !== id));
  await write(KEY_BOOKMARKS, bookmarks);
}

// ---- Bookmarks ----

export async function listBookmarks(): Promise<Bookmark[]> {
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  return Object.values(map);
}

export async function getBookmark(tweetId: string): Promise<Bookmark | undefined> {
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  return map[tweetId];
}

/**
 * ポストの所属フォルダを設定する。空配列ならブックマークごと削除する。
 * 既存の savedAt / snapshot は、新規保存でなければ維持する。
 */
export async function setBookmarkFolders(
  tweetId: string,
  folderIds: string[],
  snapshot: Bookmark['snapshot'],
): Promise<Bookmark | undefined> {
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  const ids = [...new Set(folderIds.filter((id) => !isBuiltinFolder(id)))];
  if (ids.length === 0) {
    delete map[tweetId];
    await write(KEY_BOOKMARKS, map);
    return undefined;
  }
  const prev = map[tweetId];
  const b: Bookmark = { tweetId, folderIds: ids, savedAt: prev?.savedAt ?? Date.now(), snapshot };
  map[tweetId] = b;
  await write(KEY_BOOKMARKS, map);
  return b;
}

// ---- Export / Import ----

export interface ExportData {
  app: 'PostShelf';
  version: 1;
  exportedAt: number;
  folders: Folder[];
  bookmarks: Bookmark[];
}

export async function exportData(): Promise<ExportData> {
  return {
    app: 'PostShelf',
    version: 1,
    exportedAt: Date.now(),
    folders: await readFolders(),
    bookmarks: await listBookmarks(),
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';

function validFolder(f: any): f is Folder {
  return f && isStr(f.id) && isStr(f.name) && isStr(f.icon) && typeof f.order === 'number' && !isBuiltinFolder(f.id);
}
function validBookmark(b: any): b is Bookmark {
  return (
    b && isStr(b.tweetId) && Array.isArray(b.folderIds) && b.folderIds.every(isStr) &&
    typeof b.savedAt === 'number' && b.snapshot && isStr(b.snapshot.text) && isStr(b.snapshot.url) &&
    Array.isArray(b.snapshot.media)
  );
}

/** JSON を検証してマージ取り込みする (同 ID は上書き)。不正なら StorageError。 */
export async function importData(json: unknown): Promise<number> {
  const d = json as Partial<ExportData> | null;
  if (!d || d.app !== 'PostShelf' || !Array.isArray(d.folders) || !Array.isArray(d.bookmarks)) {
    throw new StorageError(t('errInvalidImport'));
  }
  const folders = d.folders.filter(validFolder);
  const bookmarks = d.bookmarks.filter(validBookmark);
  const curFolders = new Map((await readFolders()).map((f) => [f.id, f]));
  for (const f of folders) curFolders.set(f.id, f);
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  for (const b of bookmarks) map[b.tweetId] = b;
  await write(KEY_FOLDERS, [...curFolders.values()]);
  await write(KEY_BOOKMARKS, map);
  return bookmarks.length;
}

/**
 * フォルダ未所属で取り込む (ページ収集用)。既存ポストは触らない。
 * ブックマークは folderIds が空だと消える仕様なので、専用の「未分類」フォルダへ入れる。
 */
export async function addCollected(items: { tweetId: string; snapshot: Bookmark['snapshot'] }[]): Promise<number> {
  const folders = await readFolders();
  let inbox = folders.find((f) => f.id === INBOX_ID);
  if (!inbox) {
    inbox = { id: INBOX_ID, name: '', icon: 'ti-star', order: folders.reduce((m, f) => Math.max(m, f.order), -1) + 1 };
    await write(KEY_FOLDERS, [...folders, inbox]);
  }
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  let added = 0;
  for (const it of items) {
    if (map[it.tweetId]) continue;
    map[it.tweetId] = { tweetId: it.tweetId, folderIds: [INBOX_ID], savedAt: Date.now(), snapshot: it.snapshot };
    added++;
  }
  await write(KEY_BOOKMARKS, map);
  return added;
}


/** フォルダ/ブックマークが変わったら呼ばれる (別タブ・manager からの変更も拾う)。解除関数を返す */
export function onDataChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && (KEY_FOLDERS in changes || KEY_BOOKMARKS in changes)) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

// ---- Bulk operations (manager) ----
// どれも 1 回の書き込みにまとめ、取り消し用に変更前の状態 (BookmarkUndo) を返す。

/** tweetId → 変更前のブックマーク (null は「もともと存在しなかった」) */
export type BookmarkUndo = Record<string, Bookmark | null>;

async function mutateBookmarks(
  tweetIds: string[],
  fn: (b: Bookmark) => Bookmark | null,
  opts: { ensureInbox?: boolean } = {},
): Promise<BookmarkUndo> {
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  const undo: BookmarkUndo = {};
  for (const id of new Set(tweetIds)) {
    const prev = map[id];
    if (!prev) continue;
    const next = fn(structuredClone(prev));
    if (JSON.stringify(next) === JSON.stringify(prev)) continue;
    undo[id] = prev;
    if (next) map[id] = next;
    else delete map[id];
  }
  if (Object.keys(undo).length === 0) return undo;
  if (opts.ensureInbox) {
    const folders = await readFolders();
    if (!folders.some((f) => f.id === INBOX_ID)) {
      const order = folders.reduce((m, f) => Math.max(m, f.order), -1) + 1;
      await write(KEY_FOLDERS, [...folders, { id: INBOX_ID, name: '', icon: 'ti-star', order }]);
    }
  }
  await write(KEY_BOOKMARKS, map);
  return undo;
}

const uniq = (a: string[]) => [...new Set(a)];
const realIds = (ids: string[]) => ids.filter((id) => !isBuiltinFolder(id));

export const addToFolders = (tweetIds: string[], folderIds: string[]) =>
  mutateBookmarks(tweetIds, (b) => ({ ...b, folderIds: uniq([...b.folderIds, ...realIds(folderIds)]) }));

/**
 * フォルダから外す。最後のフォルダを外してもポストは消さず「未分類」に移す
 * (ポストを消すのは明示的な deleteBookmarks だけ)。
 */
export const removeFromFolders = (tweetIds: string[], folderIds: string[]) =>
  mutateBookmarks(
    tweetIds,
    (b) => {
      const rest = b.folderIds.filter((id) => !folderIds.includes(id));
      return { ...b, folderIds: rest.length ? rest : [INBOX_ID] };
    },
    { ensureInbox: true },
  );

/** from から外して to に入れる。from が「すべて」(または未指定) なら追加のみ */
export const moveToFolder = (tweetIds: string[], fromId: string | null, toId: string) =>
  mutateBookmarks(tweetIds, (b) => {
    const rest = fromId && !isBuiltinFolder(fromId) && fromId !== toId ? b.folderIds.filter((id) => id !== fromId) : b.folderIds;
    return { ...b, folderIds: uniq([...rest, ...realIds([toId])]) };
  });

/** PostShelf から削除する (X 側のブックマークには触らない) */
export const deleteBookmarks = (tweetIds: string[]) => mutateBookmarks(tweetIds, () => null);

/** BookmarkUndo の内容で変更前の状態に戻す (1 回の書き込み) */
export async function restoreBookmarks(undo: BookmarkUndo): Promise<void> {
  const map = await read<Record<string, Bookmark>>(KEY_BOOKMARKS, {});
  for (const [id, prev] of Object.entries(undo)) {
    if (prev) map[id] = prev;
    else delete map[id];
  }
  await write(KEY_BOOKMARKS, map);
}

/** フォルダの並び順を更新する。orderedIds に無いフォルダは末尾に残す。「すべて」は無視、「未分類」は表示側で常に先頭 */
export async function reorderFolders(orderedIds: string[]): Promise<void> {
  const folders = await readFolders();
  const rank = new Map(realIds(orderedIds).map((id, i) => [id, i]));
  const sorted = [...folders].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.order - b.order);
  await write(KEY_FOLDERS, sorted.map((f, i) => ({ ...f, order: i })));
}
