/**
 * 保存層。chrome.storage.local へのアクセスはこのファイルに集約する。
 * 組み込みフォルダ「すべて」は保存せず、listFolders が先頭に付与する。
 */
import {
  ALL_FOLDER,
  COLORS,
  FOLDER_ICON,
  ICONS,
  isBuiltinFolder,
  supportsColor,
  type Bookmark,
  type Folder,
} from './models';
import { STRINGS } from './strings';

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
  if (!n) throw new StorageError(STRINGS.errors.emptyName);
  return n;
}

function checkIcon(icon: string): void {
  if (!(ICONS as readonly string[]).includes(icon)) throw new StorageError(STRINGS.errors.invalidIcon);
}

function checkColor(color: string): void {
  if (!(COLORS as readonly string[]).includes(color)) throw new StorageError(STRINGS.errors.invalidColor);
}

/** 「すべて」+ 保存済みフォルダ (order 昇順) */
export async function listFolders(): Promise<Folder[]> {
  const folders = await readFolders();
  return [ALL_FOLDER, ...[...folders].sort((a, b) => a.order - b.order)];
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
  if (isBuiltinFolder(id)) throw new StorageError(STRINGS.errors.builtinImmutable);
  const folders = await readFolders();
  const idx = folders.findIndex((f) => f.id === id);
  if (idx < 0) throw new StorageError(STRINGS.errors.notFound);
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
  if (isBuiltinFolder(id)) throw new StorageError(STRINGS.errors.builtinImmutable);
  const folders = await readFolders();
  if (!folders.some((f) => f.id === id)) throw new StorageError(STRINGS.errors.notFound);
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
