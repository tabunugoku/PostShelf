/**
 * 保存層。chrome.storage.local へのアクセスはこのファイルに集約する。
 * 組み込みフォルダ「すべて」は保存せず、listFolders が先頭に付与する。
 *
 * v9 (スキーマ 2): フォルダとブックマークはアカウントごとに分ける。
 *  - folders: Folder[] (accountId つき。全アカウント分を 1 つの配列に持つ)
 *  - bookmarks: Record<`${accountId}:${tweetId}`, Bookmark>
 *  - accounts: Record<accountId, Account> / lastSeenAccount: Account (content script が最後に読んだアカウント)
 *  - schemaVersion: 2。旧データ (accountId なし) は ensureMigrated が 1 回だけ 'unknown' アカウントへ移す
 * 「いま見ているアカウント」はモジュール内の scope (setAccountScope)。フォルダ/ブックマークの関数は scope のデータだけを扱う。
 * (content script は判定したアカウント、manager は表示中のアカウントを設定する。別々の実行環境なので互いに影響しない)
 */
import {
  ALL_FOLDER,
  COLORS,
  FOLDER_ICON,
  ICONS,
  INBOX_ID,
  UNKNOWN_ACCOUNT_ID,
  accountIdOf,
  bookmarkKey,
  isBuiltinFolder,
  type Account,
  type Bookmark,
  type Folder,
} from './models';
import { t } from './strings';

const KEY_FOLDERS = 'folders';
const KEY_BOOKMARKS = 'bookmarks';
const KEY_ACCOUNTS = 'accounts';
const KEY_LAST_ACCOUNT = 'lastSeenAccount';
const KEY_SCHEMA = 'schemaVersion';
export const SCHEMA_VERSION = 2;

export class StorageError extends Error {}

type BookmarkMap = Record<string, Bookmark>;

async function read<T>(key: string, fallback: T): Promise<T> {
  const res = await chrome.storage.local.get(key);
  return (res[key] as T | undefined) ?? fallback;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// ---- アカウントの範囲 ----

let scope = UNKNOWN_ACCOUNT_ID;
/** 以降のフォルダ/ブックマーク操作の対象アカウントを切り替える */
export const setAccountScope = (id: string): void => {
  scope = id || UNKNOWN_ACCOUNT_ID;
};
export const getAccountScope = (): string => scope;

// ---- 移行 (スキーマ 1 → 2) ----

const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 旧データ (accountId なし、ブックマークのキーは tweetId) を新しい形へ変換する純粋関数。冪等。
 * 結果をメモリ上で検証し、1 件でも欠けたり変わったりしていたら StorageError (呼び出し側は何も書き込まない)。
 */
export function migrateToV2(raw: { folders?: unknown; bookmarks?: unknown }): { folders: Folder[]; bookmarks: BookmarkMap } {
  const inFolders = (Array.isArray(raw.folders) ? raw.folders : []) as Folder[];
  const inMap = (raw.bookmarks && typeof raw.bookmarks === 'object' && !Array.isArray(raw.bookmarks) ? raw.bookmarks : {}) as Record<string, Bookmark>;
  const folders = inFolders.map((f) => ({ ...f, accountId: isStr(f.accountId) && f.accountId ? f.accountId : UNKNOWN_ACCOUNT_ID }));
  const bookmarks: BookmarkMap = {};
  for (const [k, b] of Object.entries(inMap)) {
    const tweetId = isStr(b?.tweetId) ? b.tweetId : k;
    const accountId = isStr(b?.accountId) && b.accountId ? b.accountId : UNKNOWN_ACCOUNT_ID;
    bookmarks[bookmarkKey(accountId, tweetId)] = { ...b, tweetId, accountId };
  }
  // 検証: 件数、ID、中身 (accountId 以外) が元と同じ
  const bad = () => new StorageError('migration check failed');
  if (folders.length !== inFolders.length || Object.keys(bookmarks).length !== Object.keys(inMap).length) throw bad();
  inFolders.forEach((f, i) => {
    const { accountId: _a, ...rest } = folders[i];
    const { accountId: _b, ...orig } = f;
    if (!jsonEq(rest, orig)) throw bad();
  });
  for (const [k, b] of Object.entries(inMap)) {
    const tweetId = isStr(b?.tweetId) ? b.tweetId : k;
    const out = bookmarks[bookmarkKey(isStr(b?.accountId) && b.accountId ? b.accountId : UNKNOWN_ACCOUNT_ID, tweetId)];
    const { accountId: _a, ...rest } = out ?? ({} as Bookmark);
    const { accountId: _b, ...orig } = { ...b, tweetId };
    if (!out || !jsonEq(rest, orig)) throw bad();
  }
  return { folders, bookmarks };
}

let migrating: Promise<void> | undefined;

/** どの公開関数も最初に呼ぶ。schemaVersion が古ければ (1 回だけ) 移行する。失敗時は何も書き込まず例外 */
async function ensureMigrated(): Promise<void> {
  if ((await read<number>(KEY_SCHEMA, 0)) >= SCHEMA_VERSION) return;
  migrating ??= (async () => {
    const [folders, bookmarks] = await Promise.all([read<unknown>(KEY_FOLDERS, []), read<unknown>(KEY_BOOKMARKS, {})]);
    const out = migrateToV2({ folders, bookmarks }); // 検証に失敗したらここで例外 = 書き込みなし
    await chrome.storage.local.set({ [KEY_FOLDERS]: out.folders, [KEY_BOOKMARKS]: out.bookmarks, [KEY_SCHEMA]: SCHEMA_VERSION }); // 1 回の書き込み
  })().finally(() => {
    migrating = undefined;
  });
  await migrating;
}

// ---- 読み書きの共通部品 (scope のデータだけを扱う) ----

async function readAllFolders(): Promise<Folder[]> {
  await ensureMigrated();
  return read<Folder[]>(KEY_FOLDERS, []);
}
async function readMap(): Promise<BookmarkMap> {
  await ensureMigrated();
  return read<BookmarkMap>(KEY_BOOKMARKS, {});
}
const mine = (f: Folder) => f.accountId === scope;
/** scope のフォルダ */
const readFolders = async () => (await readAllFolders()).filter(mine);
/** scope のフォルダを差し替えて保存する (他のアカウントのフォルダは触らない) */
async function writeFolders(list: Folder[]): Promise<void> {
  const others = (await readAllFolders()).filter((f) => !mine(f));
  await write(KEY_FOLDERS, [...others, ...list.map((f) => ({ ...f, accountId: scope }))]);
}
const key = (tweetId: string) => bookmarkKey(scope, tweetId);
const inScope = (b: Bookmark) => b.accountId === scope;

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
    accountId: scope,
  };
  if (input.color !== undefined) {
    checkColor(input.color);
    folder.color = input.color;
  }
  await writeFolders([...folders, folder]);
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
  folders[idx] = next;
  await writeFolders(folders);
  return next;
}

/** フォルダを削除し、ブックマークからも folderId を外す (ポスト自体は残す) */
export async function deleteFolder(id: string): Promise<void> {
  if (isBuiltinFolder(id)) throw new StorageError(t('errBuiltinImmutable'));
  const folders = await readFolders();
  if (!folders.some((f) => f.id === id)) throw new StorageError(t('errNotFound'));
  const map = await readMap();
  for (const b of Object.values(map)) if (inScope(b)) b.folderIds = b.folderIds.filter((x) => x !== id);
  await writeFolders(folders.filter((f) => f.id !== id));
  await write(KEY_BOOKMARKS, map);
}

// ---- Bookmarks ----

export async function listBookmarks(): Promise<Bookmark[]> {
  return Object.values(await readMap()).filter(inScope);
}

/** 全アカウントの保存済みポストの tweetId (画像キャッシュの掃除用: どのアカウントにも無いポストの画像は消してよい) */
export async function listAllTweetIds(): Promise<Set<string>> {
  return new Set(Object.values(await readMap()).map((b) => b.tweetId));
}

/** 全アカウントのブックマーク (画像キャッシュの post.json 用)。書き込み用ではない */
export async function listAllBookmarks(): Promise<Bookmark[]> {
  return Object.values(await readMap());
}

/** 保存済みポストの tweetId 一覧 (取り込み件数の計算用) */
export async function getSavedIds(): Promise<Set<string>> {
  return new Set((await listBookmarks()).map((b) => b.tweetId));
}

export async function getBookmark(tweetId: string): Promise<Bookmark | undefined> {
  return (await readMap())[key(tweetId)];
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
  const map = await readMap();
  const ids = [...new Set(folderIds.filter((id) => !isBuiltinFolder(id)))];
  if (ids.length === 0) {
    delete map[key(tweetId)];
    await write(KEY_BOOKMARKS, map);
    return undefined;
  }
  const prev = map[key(tweetId)];
  const b: Bookmark = { accountId: scope, tweetId, folderIds: ids, savedAt: prev?.savedAt ?? Date.now(), snapshot };
  map[key(tweetId)] = b;
  await write(KEY_BOOKMARKS, map);
  return b;
}

// ---- Export / Import ----

export interface ExportData {
  app: 'PostShelf';
  /** 2: アカウント対応 (v9)。1: 旧形式 (accountId なし。インポートすると 'unknown' に入る) */
  version: 2;
  exportedAt: number;
  accounts: Account[];
  folders: Folder[];
  bookmarks: Bookmark[];
}

/** 全アカウントのデータを書き出す (バックアップ用) */
export async function exportData(): Promise<ExportData> {
  return {
    app: 'PostShelf',
    version: 2,
    exportedAt: Date.now(),
    accounts: Object.values(await read<Record<string, Account>>(KEY_ACCOUNTS, {})),
    folders: await readAllFolders(),
    bookmarks: Object.values(await readMap()),
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
function validAccount(a: any): a is Account {
  return a && isStr(a.id) && a.id !== '' && isStr(a.handle) && typeof a.lastSeenAt === 'number';
}

/**
 * JSON を検証してマージ取り込みする (同じアカウントの同 ID は上書き)。不正なら StorageError。
 * 新形式 (version 2) はアカウントごとに入る。旧形式 (version 1 / accountId なし) は 'unknown' に入る。
 */
export async function importData(json: unknown): Promise<number> {
  const d = json as (Partial<ExportData> & { version?: number }) | null;
  if (!d || d.app !== 'PostShelf' || !Array.isArray(d.folders) || !Array.isArray(d.bookmarks) || (d.version !== undefined && d.version > 2)) {
    throw new StorageError(t('errInvalidImport'));
  }
  const legacy = d.version === undefined || d.version < 2;
  const acc = (v: unknown) => (!legacy && isStr(v) && v ? (v === UNKNOWN_ACCOUNT_ID ? v : accountIdOf(v)) : UNKNOWN_ACCOUNT_ID);
  const folders = d.folders.filter(validFolder).map((f) => ({ ...f, accountId: acc(f.accountId) }));
  const bookmarks = d.bookmarks.filter(validBookmark).map((b) => ({ ...b, accountId: acc(b.accountId) }));
  const curFolders = new Map((await readAllFolders()).map((f) => [bookmarkKey(f.accountId ?? UNKNOWN_ACCOUNT_ID, f.id), f]));
  for (const f of folders) curFolders.set(bookmarkKey(f.accountId, f.id), f);
  const map = await readMap();
  for (const b of bookmarks) map[bookmarkKey(b.accountId, b.tweetId)] = b;
  const accounts = await read<Record<string, Account>>(KEY_ACCOUNTS, {});
  if (!legacy && Array.isArray(d.accounts)) {
    for (const a of d.accounts.filter(validAccount)) {
      const id = accountIdOf(a.id);
      if (id === UNKNOWN_ACCOUNT_ID) continue;
      if (!accounts[id] || accounts[id].lastSeenAt < a.lastSeenAt) accounts[id] = { ...a, id };
    }
  }
  await write(KEY_FOLDERS, [...curFolders.values()]);
  await write(KEY_BOOKMARKS, map);
  await write(KEY_ACCOUNTS, accounts);
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
    inbox = { id: INBOX_ID, name: '', icon: 'ti-star', order: folders.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId: scope };
    await writeFolders([...folders, inbox]);
  }
  const map = await readMap();
  let added = 0;
  for (const it of items) {
    if (map[key(it.tweetId)]) continue;
    map[key(it.tweetId)] = { accountId: scope, tweetId: it.tweetId, folderIds: [INBOX_ID], savedAt: Date.now(), snapshot: it.snapshot };
    added++;
  }
  await write(KEY_BOOKMARKS, map);
  return added;
}

/** フォルダ/ブックマーク/アカウントが変わったら呼ばれる (別タブ・manager からの変更も拾う)。解除関数を返す */
export function onDataChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && (KEY_FOLDERS in changes || KEY_BOOKMARKS in changes || KEY_ACCOUNTS in changes)) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

// ---- Bulk operations (manager) ----
// どれも 1 回の書き込みにまとめ、取り消し用に変更前の状態 (BookmarkUndo) を返す。

/** 保存キー (accountId:tweetId) → 変更前のブックマーク (null は「もともと存在しなかった」) */
export type BookmarkUndo = Record<string, Bookmark | null>;

async function mutateBookmarks(
  tweetIds: string[],
  fn: (b: Bookmark) => Bookmark | null,
): Promise<BookmarkUndo> {
  const map = await readMap();
  const undo: BookmarkUndo = {};
  for (const tid of new Set(tweetIds)) {
    const k = key(tid);
    const prev = map[k];
    if (!prev) continue;
    const next = fn(structuredClone(prev));
    if (JSON.stringify(next) === JSON.stringify(prev)) continue;
    undo[k] = prev;
    if (next) map[k] = next;
    else delete map[k];
  }
  if (Object.keys(undo).length === 0) return undo;
  // 「未分類」に入るポストがあれば、受け皿のフォルダ (名前なし = 表示時に解決) を用意する
  if (Object.values(map).some((b) => inScope(b) && b.folderIds.includes(INBOX_ID))) {
    const folders = await readFolders();
    if (!folders.some((f) => f.id === INBOX_ID)) {
      const order = folders.reduce((m, f) => Math.max(m, f.order), -1) + 1;
      await writeFolders([...folders, { id: INBOX_ID, name: '', icon: 'ti-star', order }]);
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
  mutateBookmarks(tweetIds, (b) => {
    const rest = b.folderIds.filter((id) => !folderIds.includes(id));
    return { ...b, folderIds: rest.length ? rest : [INBOX_ID] };
  });

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
  const map = await readMap();
  for (const [k, prev] of Object.entries(undo)) {
    if (prev) map[k] = prev;
    else delete map[k];
  }
  await write(KEY_BOOKMARKS, map);
}

/** フォルダの並び順を更新する。orderedIds に無いフォルダは末尾に残す。「すべて」は無視、「未分類」は表示側で常に先頭 */
export async function reorderFolders(orderedIds: string[]): Promise<void> {
  const folders = await readFolders();
  const rank = new Map(realIds(orderedIds).map((id, i) => [id, i]));
  const sorted = [...folders].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.order - b.order);
  await writeFolders(sorted.map((f, i) => ({ ...f, order: i })));
}


// ---- Accounts (v9) ----

const ACCOUNT_REFRESH_MS = 60_000;

/**
 * content script が読み取ったアカウントを記録する (accounts と lastSeenAccount)。
 * 内容が変わっていなければ、最後の記録から 1 分以内は書き込まない (DOM の変化のたびに呼ばれるため)。
 */
export async function noteAccount(input: { handle: string; displayName?: string; avatar?: string }, now = Date.now()): Promise<Account> {
  await ensureMigrated();
  const handle = input.handle.replace(/^@/, '').trim();
  const id = accountIdOf(handle);
  if (!id || id === UNKNOWN_ACCOUNT_ID) throw new StorageError(t('errInvalidImport'));
  const accounts = await read<Record<string, Account>>(KEY_ACCOUNTS, {});
  const prev = accounts[id];
  const last = await read<Account | null>(KEY_LAST_ACCOUNT, null);
  const next: Account = {
    id,
    handle,
    displayName: input.displayName ?? prev?.displayName,
    avatar: input.avatar ?? prev?.avatar,
    lastSeenAt: now,
  };
  const same = prev && last?.id === id && prev.handle === next.handle && prev.displayName === next.displayName && prev.avatar === next.avatar;
  if (same && now - prev.lastSeenAt < ACCOUNT_REFRESH_MS) return prev;
  await chrome.storage.local.set({ [KEY_ACCOUNTS]: { ...accounts, [id]: next }, [KEY_LAST_ACCOUNT]: next });
  return next;
}

/** content script が最後に読み取ったアカウント (manager / サイドパネル / popup の既定の表示アカウント) */
export async function getLastSeenAccount(): Promise<Account | null> {
  const a = await read<Account | null>(KEY_LAST_ACCOUNT, null);
  return a && validAccount(a) ? a : null;
}

/** lastSeenAccount が変わったら呼ばれる (x.com でアカウントを切り替えた、など)。解除関数を返す */
export function onLastSeenAccountChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && KEY_LAST_ACCOUNT in changes) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

export interface AccountSummary {
  account: Account;
  /** 保存したポストの件数 */
  count: number;
}

/** 'unknown' を表す Account (保存はしない。表示名は accountLabel が解決する) */
export const UNKNOWN_ACCOUNT: Account = { id: UNKNOWN_ACCOUNT_ID, handle: '', lastSeenAt: 0 };

/**
 * 切替メニューに出すアカウント一覧: 保存履歴のあるアカウント + 最後に読み取ったアカウント (保存が 0 件でも)。
 * 「アカウント未設定」は、そのデータ (ポストかフォルダ) があるときだけ。新しく見たアカウントが先、未設定は最後。
 */
export async function listAccounts(): Promise<AccountSummary[]> {
  await ensureMigrated();
  const [accounts, map, folders, last] = await Promise.all([
    read<Record<string, Account>>(KEY_ACCOUNTS, {}),
    readMap(),
    readAllFolders(),
    getLastSeenAccount(),
  ]);
  const counts = new Map<string, number>();
  for (const b of Object.values(map)) counts.set(b.accountId, (counts.get(b.accountId) ?? 0) + 1);
  const hasFolders = new Set(folders.map((f) => f.accountId));
  const out: AccountSummary[] = [];
  const ids = new Set([...Object.keys(accounts), ...counts.keys(), ...(last ? [last.id] : [])]);
  for (const id of ids) {
    const count = counts.get(id) ?? 0;
    if (id === UNKNOWN_ACCOUNT_ID) {
      if (count > 0 || hasFolders.has(id)) out.push({ account: UNKNOWN_ACCOUNT, count });
      continue;
    }
    const account = accounts[id] ?? (last?.id === id ? last : { id, handle: id, lastSeenAt: 0 });
    if (count > 0 || last?.id === id || hasFolders.has(id)) out.push({ account, count });
  }
  const rank = (a: AccountSummary) => (a.account.id === UNKNOWN_ACCOUNT_ID ? -Infinity : a.account.lastSeenAt);
  return out.sort((a, b) => rank(b) - rank(a));
}

/**
 * from アカウントのフォルダとポストを to アカウントへ移す (「アカウント未設定」の割り当て / ハンドル変更後の付け替え)。
 * 同じ tweetId が移動先にすでにあればフォルダを統合する (savedAt は古いほう、本文は移動先を残す)。
 * 「未分類」フォルダは移動先にあればそちらへ統合する。1 回の書き込み。
 */
export async function assignAccount(from: string, to: string): Promise<{ moved: number; merged: number }> {
  if (!to || from === to) throw new StorageError(t('errNotFound'));
  const [folders, map, accounts] = await Promise.all([readAllFolders(), readMap(), read<Record<string, Account>>(KEY_ACCOUNTS, {})]);
  const dest = folders.filter((f) => f.accountId === to);
  const hasInbox = dest.some((f) => f.id === INBOX_ID);
  let order = dest.reduce((m, f) => Math.max(m, f.order), -1);
  const movedFolders: Folder[] = [];
  for (const f of folders.filter((x) => x.accountId === from).sort((a, b) => a.order - b.order)) {
    if (f.id === INBOX_ID && hasInbox) continue; // 移動先の「未分類」に統合
    movedFolders.push({ ...f, accountId: to, order: ++order });
  }
  let moved = 0;
  let merged = 0;
  for (const [k, b] of Object.entries(map)) {
    if (b.accountId !== from) continue;
    delete map[k];
    const nk = bookmarkKey(to, b.tweetId);
    const ex = map[nk];
    if (ex) {
      map[nk] = { ...ex, folderIds: [...new Set([...ex.folderIds, ...b.folderIds])], savedAt: Math.min(ex.savedAt, b.savedAt) };
      merged++;
    } else {
      map[nk] = { ...b, accountId: to };
      moved++;
    }
  }
  delete accounts[from];
  await chrome.storage.local.set({
    [KEY_FOLDERS]: [...folders.filter((f) => f.accountId !== from), ...movedFolders],
    [KEY_BOOKMARKS]: map,
    [KEY_ACCOUNTS]: accounts,
  });
  return { moved, merged };
}

/** 1 つのアカウントのフォルダ・ポスト・アカウント情報を削除する (取り消し不可。X 側には触らない) */
export async function deleteAccountData(accountId: string): Promise<void> {
  const [folders, map, accounts] = await Promise.all([readAllFolders(), readMap(), read<Record<string, Account>>(KEY_ACCOUNTS, {})]);
  for (const [k, b] of Object.entries(map)) if (b.accountId === accountId) delete map[k];
  delete accounts[accountId];
  await chrome.storage.local.set({
    [KEY_FOLDERS]: folders.filter((f) => f.accountId !== accountId),
    [KEY_BOOKMARKS]: map,
    [KEY_ACCOUNTS]: accounts,
  });
}

export interface DataCounts {
  folders: number;
  posts: number;
  accounts: number;
}

/** 保存データの総数 (「すべてのデータを削除」の確認表示用) */
export async function countAllData(): Promise<DataCounts> {
  const [folders, map, accounts] = await Promise.all([readAllFolders(), readMap(), read<Record<string, Account>>(KEY_ACCOUNTS, {})]);
  return { folders: folders.length, posts: Object.keys(map).length, accounts: Object.keys(accounts).length };
}

/** フォルダ・保存したポスト・アカウント情報 (lastSeenAccount を含む) をすべて削除する。設定は残す。取り消し不可 */
export async function deleteAllData(): Promise<void> {
  await chrome.storage.local.set({ [KEY_FOLDERS]: [], [KEY_BOOKMARKS]: {}, [KEY_ACCOUNTS]: {}, [KEY_SCHEMA]: SCHEMA_VERSION });
  await chrome.storage.local.remove?.(KEY_LAST_ACCOUNT);
}
