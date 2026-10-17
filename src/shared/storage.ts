/**
 * 保存層。chrome.storage.local へのアクセスはこのファイルに集約する。
 * 組み込みフォルダ「すべて」は保存せず、listFolders が先頭に付与する。
 *
 * v83 (スキーマ 3): ポストは bm:<accountId>:<tweetId> のキーに 1 件ずつ保存する。
 * folders・accounts・lastSeenAccount の形はスキーマ 2 と同じ。
 * 移行と旧版の bookmarks の回収は service worker だけで行い、他の画面は完了を待つ。
 * 「いま見ているアカウント」は実行環境ごとの scope (setAccountScope) で指定する。
 *
 * 同時書き込みについて (v83): 別のポストは別のキーなので、他の実行環境の変更を消さない。
 * 同じポストやフォルダの同時更新は後の書き込みが残る。同じ実行環境の中では serial() で順に行い、
 * ポストを読んだあと書くまでの間に、別の読み出しの await を挟まない。
 */
import { isEmojiImageUrl } from './avatar';
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
  type QuoteSnapshot,
  type Snapshot,
} from './models';
import { t } from './strings';
import { getSettings, updateSettings } from './settings';
import {
  ancestors,
  canParent,
  descendants,
  flattenFolders,
  normalizeFolderIds,
  reparentedFolderResolver,
  sanitizeParents,
  withAncestors,
  withAncestorResolver,
  withoutDeletedFolders,
  withoutDescendantsResolver,
} from './folderTree';
import { isXImageUrl } from './media';
import { assignOrder } from './ordering';
import { sanitizeSegments, type Segment } from './segments';

export { normalizeFolderIds };

const KEY_FOLDERS = 'folders';
const KEY_BOOKMARKS = 'bookmarks';
const KEY_ACCOUNTS = 'accounts';
const KEY_LAST_ACCOUNT = 'lastSeenAccount';
const KEY_SCHEMA = 'schemaVersion';
const KEY_REPAIRED = 'folderIdsRepaired';
export const SCHEMA_VERSION = 3;

export class StorageError extends Error {}

type BookmarkMap = Record<string, Bookmark>;

async function read<T>(key: string, fallback: T): Promise<T> {
  const res = await chrome.storage.local.get(key);
  return (res[key] as T | undefined) ?? fallback;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

let chain: Promise<unknown> = Promise.resolve();
/** 同じ実行環境の中で、保存データを書き換える処理を 1 つずつ順に行う (失敗しても次の処理は止めない) */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

// ---- アカウントの範囲 ----

let scope = UNKNOWN_ACCOUNT_ID;
/** 以降のフォルダ/ブックマーク操作の対象アカウントを切り替える */
export const setAccountScope = (id: string): void => {
  scope = id || UNKNOWN_ACCOUNT_ID;
};
export const getAccountScope = (): string => scope;

// ---- 移行 (スキーマ 1 → 2 → 3) ----

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

/** スキーマ 2 の map を、ポストごとの保存キーに変換する純粋関数。 */
export function migrateToV3(map: BookmarkMap): BookmarkMap {
  return Object.fromEntries(Object.entries(map).map(([key, b]) => ['bm:' + key, b]));
}

/** 保存キーを一か所で組み立て、公開 API の map のキーと区別する。 */
const storageKey = (accountId: string, tweetId: string) => 'bm:' + bookmarkKey(accountId, tweetId);

function verifyMigration(map: BookmarkMap, converted: BookmarkMap): void {
  if (Object.keys(map).length !== Object.keys(converted).length) throw new StorageError('migration check failed');
  for (const [key, b] of Object.entries(map)) {
    if (key !== bookmarkKey(b.accountId, b.tweetId) || !jsonEq(converted['bm:' + key], b)) {
      throw new StorageError('migration check failed');
    }
  }
}

let storageMigration: Promise<void> | undefined;
/** 裏方だけが旧データを移し、書き込みの検証後に古いキーを削除する。 */
export function runStorageMigration(): Promise<void> {
  storageMigration ??= (async () => {
    const raw = await chrome.storage.local.get([KEY_SCHEMA, KEY_REPAIRED, KEY_FOLDERS, KEY_BOOKMARKS]);
    const version = raw[KEY_SCHEMA] ?? 0;
    if (version >= SCHEMA_VERSION && !(KEY_BOOKMARKS in raw)) return;
    let folders: Folder[] = raw[KEY_FOLDERS] ?? [];
    let map: BookmarkMap = raw[KEY_BOOKMARKS] ?? {};
    if (version < 2) ({ folders, bookmarks: map } = migrateToV2({ folders, bookmarks: map }));
    if (version < SCHEMA_VERSION && !raw[KEY_REPAIRED]) {
      const repaired = repairedFolderData(map, folders);
      folders = repaired.folders;
      map = repaired.map;
    }
    const converted = migrateToV3(map);
    verifyMigration(map, converted);
    let additions = converted;
    if (version >= SCHEMA_VERSION) {
      // 旧版に戻した間の保存分は、新形式に無いポストだけを足す。
      const existing = await chrome.storage.local.get(Object.keys(converted));
      additions = Object.fromEntries(Object.entries(converted).filter(([key]) => !(key in existing)));
    }
    const items: Record<string, unknown> = { ...additions };
    if (version < SCHEMA_VERSION) {
      items[KEY_SCHEMA] = SCHEMA_VERSION;
      items[KEY_REPAIRED] = true;
      if (!jsonEq(folders, raw[KEY_FOLDERS] ?? [])) items[KEY_FOLDERS] = folders;
    }
    if (Object.keys(items).length) await chrome.storage.local.set(items);
    const written = await chrome.storage.local.get(Object.keys(additions));
    if (!Object.keys(additions).every((key) => jsonEq(written[key], additions[key]))) {
      throw new StorageError('migration readback failed');
    }
    if (KEY_BOOKMARKS in raw) await chrome.storage.local.remove(KEY_BOOKMARKS);
  })().finally(() => { storageMigration = undefined; });
  return storageMigration;
}

let migrating: Promise<void> | undefined;
let migrationReady = false;
let migrationVersion = 0;
let recoveryRequested = false;
let migrationEvents: typeof chrome.storage.onChanged | undefined;
let unwatchMigration: (() => void) | undefined;

/** スキーマの印が外から戻された場合だけ、実行環境内の判定を無効にする。 */
function watchMigration(): void {
  if (migrationEvents === chrome.storage.onChanged) return;
  unwatchMigration?.();
  migrationEvents = chrome.storage.onChanged;
  migrationReady = false;
  recoveryRequested = false;
  migrating = undefined;
  migrationVersion++;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const schema = changes[KEY_SCHEMA];
    if (schema && (schema.newValue ?? 0) < SCHEMA_VERSION) {
      migrationReady = false;
      recoveryRequested = false;
      migrationVersion++;
    }
  };
  const events = migrationEvents;
  events.addListener(listener);
  unwatchMigration = () => events.removeListener(listener);
}

function requestStorageMigration(): void {
  if (recoveryRequested) return;
  recoveryRequested = true;
  void chrome.runtime.sendMessage({ type: 'migrateStorage' }).catch((error) => console.error(error));
}

function waitForMigration(): Promise<void> {
  return new Promise((resolve, reject) => {
    const events = chrome.storage.onChanged;
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      events.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[KEY_SCHEMA]?.newValue >= SCHEMA_VERSION) finish();
    };
    // 時間切れのあとの操作では、裏方へもう一度頼む (裏方の移行が失敗して止まっている場合に備える)
    const timer = setTimeout(() => {
      recoveryRequested = false;
      finish(new StorageError('migration timed out'));
    }, 30_000);
    events.addListener(listener);
    requestStorageMigration();
    // 最初の読み出しと購読の間に完了した場合も取りこぼさない。
    void read(KEY_SCHEMA, 0).then((version) => {
      if (version >= SCHEMA_VERSION) finish();
    }, finish);
  });
}

/** 裏方に移行を頼み、スキーマ 3 の完了を待つ。移すデータの無い保存領域だけは自分で初期化する。 */
async function ensureMigrated(): Promise<void> {
  watchMigration();
  if (migrationReady) return;
  migrating ??= (async () => {
    while (!migrationReady) {
      const version = migrationVersion;
      const flags = await chrome.storage.local.get([KEY_SCHEMA, KEY_FOLDERS, KEY_BOOKMARKS]);
      if (version !== migrationVersion) continue;
      if ((flags[KEY_SCHEMA] ?? 0) >= SCHEMA_VERSION) {
        if (KEY_BOOKMARKS in flags) requestStorageMigration();
      } else if (!(KEY_BOOKMARKS in flags) && (flags[KEY_SCHEMA] === 2 || !(KEY_FOLDERS in flags))) {
        await chrome.storage.local.set({ [KEY_SCHEMA]: SCHEMA_VERSION, [KEY_REPAIRED]: true });
      } else {
        await waitForMigration();
      }
      if (version === migrationVersion) migrationReady = true;
    }
  })().finally(() => { migrating = undefined; });
  await migrating;
}

/** 新形式のポストの所属だけを修復し、変わったキーと受け皿を保存する。 */
export async function repairFolderIds(): Promise<void> {
  await serial(async () => {
    const folders = await readAllFolders();
    const map = await readMap();
    const repaired = repairedFolderData(map, folders);
    await chrome.storage.local.set({
      ...changedBookmarks(map, repaired.map),
      ...(jsonEq(folders, repaired.folders) ? {} : { [KEY_FOLDERS]: repaired.folders }),
      [KEY_REPAIRED]: true,
    });
  });
}

/** 移行前にも書き込まずに所属を修復し、ポストの内容が変わらないことを検証する。 */
function repairedFolderData(raw: unknown, rawFolders: unknown): { map: BookmarkMap; folders: Folder[] } {
  const map = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as BookmarkMap;
  const folders = (Array.isArray(rawFolders) ? rawFolders : []) as Folder[];
  const out: BookmarkMap = {};
  let changed = 0;
  const needInbox = new Set<string>();
  for (const [k, b] of Object.entries(map)) {
    const ids = normalizeFolderIds(Array.isArray(b?.folderIds) ? b.folderIds : []);
    const same = Array.isArray(b?.folderIds) && jsonEq(ids, b.folderIds);
    out[k] = same ? b : { ...b, folderIds: ids };
    if (!same) changed++;
    if (ids.includes(INBOX_ID)) needInbox.add(b.accountId ?? UNKNOWN_ACCOUNT_ID);
  }
  const bad = () => new StorageError('repair check failed');
  const keys = Object.keys(map);
  if (keys.length !== Object.keys(out).length) throw bad();
  for (const k of keys) {
    const { folderIds: _a, ...rest } = out[k];
    const { folderIds: _b, ...orig } = map[k];
    if (!jsonEq(rest, orig)) throw bad();
  }
  if (changed === 0) {
    return { map: out, folders };
  }
  // 「未分類」に入ったポストがあるアカウントには、受け皿のフォルダ (名前なし = 表示時に解決) を用意する
  const nextFolders = [...folders];
  for (const accountId of needInbox) {
    const mineF = nextFolders.filter((f) => (f.accountId ?? UNKNOWN_ACCOUNT_ID) === accountId);
    if (mineF.some((f) => f.id === INBOX_ID)) continue;
    nextFolders.push({ id: INBOX_ID, name: '', icon: 'ti-star', order: mineF.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId });
  }
  return { map: out, folders: nextFolders };
}

// ---- 読み書きの共通部品 (scope のデータだけを扱う) ----

async function readAllFolders(): Promise<Folder[]> {
  await ensureMigrated();
  return read<Folder[]>(KEY_FOLDERS, []);
}
async function keysOf(accountId?: string): Promise<string[]> {
  await ensureMigrated();
  const prefix = accountId === undefined ? 'bm:' : 'bm:' + accountId + ':';
  return (await chrome.storage.local.getKeys()).filter((key) => key.startsWith(prefix));
}

async function readMany(keys: string[]): Promise<BookmarkMap> {
  await ensureMigrated();
  if (!keys.length) return {};
  const data = await chrome.storage.local.get(keys.map((key) => 'bm:' + key));
  return Object.fromEntries(Object.entries(data).map(([key, b]) => [key.slice(3), b as Bookmark]));
}

async function readOne(accountId: string, tweetId: string): Promise<Bookmark | undefined> {
  await ensureMigrated();
  return read<Bookmark | undefined>(storageKey(accountId, tweetId), undefined);
}

async function readMap(accountId?: string): Promise<BookmarkMap> {
  const keys = await keysOf(accountId);
  return readMany(keys.map((key) => key.slice(3)));
}

/** フォルダと対象のポストを一緒に読み、別画面のフォルダ変更を待つ隙間を作らない。 */
async function readFoldersAndMap(keys: string[]): Promise<{ folders: Folder[]; map: BookmarkMap }> {
  await ensureMigrated();
  const data = await chrome.storage.local.get([KEY_FOLDERS, ...keys.map((key) => 'bm:' + key)]);
  return {
    folders: data[KEY_FOLDERS] ?? [],
    map: Object.fromEntries(keys.filter((key) => data['bm:' + key]).map((key) => [key, data['bm:' + key]])),
  };
}

/** 値が変わったポストだけを set の項目にする。本文と画像の複製は行わない。 */
function changedBookmarks(before: BookmarkMap, after: BookmarkMap): BookmarkMap {
  const changed: BookmarkMap = {};
  for (const [key, b] of Object.entries(after)) {
    const prev = before[key];
    if (prev === b) continue;
    if (prev && prev.accountId === b.accountId && prev.tweetId === b.tweetId && prev.savedAt === b.savedAt
      && prev.snapshot === b.snapshot && prev.folderIds.length === b.folderIds.length
      && prev.folderIds.every((id, index) => id === b.folderIds[index])) continue;
    changed['bm:' + key] = b;
  }
  return changed;
}

/** set と削除を同時に行う場合は、途中停止でデータが消えない順にする。 */
async function writeBookmarkChanges(
  before: BookmarkMap,
  after: BookmarkMap,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const removed = Object.keys(before).filter((key) => !(key in after)).map((key) => 'bm:' + key);
  const items = { ...changedBookmarks(before, after), ...extra };
  if (Object.keys(items).length || removed.length) await chrome.storage.local.set(items);
  if (removed.length) await chrome.storage.local.remove(removed);
}

/** ポストのループで全アカウントのフォルダを絞り直さず、同じ一覧を使い回す。 */
function foldersByAccount(folders: Folder[]): Map<string, Folder[]> {
  const groups = new Map<string, Folder[]>();
  for (const f of folders) {
    const accountId = f.accountId ?? UNKNOWN_ACCOUNT_ID;
    const group = groups.get(accountId);
    if (group) group.push(f);
    else groups.set(accountId, [f]);
  }
  return groups;
}
const mine = (f: Folder) => f.accountId === scope;
/** scope のフォルダ */
const readFolders = async () => (await readAllFolders()).filter(mine);
/** scope のフォルダを差し替えて保存する (他のアカウントのフォルダは触らない) */
async function writeFolders(all: Folder[], list: Folder[]): Promise<void> {
  const others = all.filter((f) => !mine(f));
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
  return folderList(await readFolders());
}

/** 読み込み済みのフォルダを、組み込み・未分類・ツリーの表示順に並べる。 */
function folderList(folders: Folder[]): Folder[] {
  // 「未分類」は常に「すべて」の次。残りは、ツリーの表示順 (親 → 子 → 孫。同じ親の中は order 昇順)
  const userFolders = folders.filter(f => f.id !== INBOX_ID);
  return [ALL_FOLDER, ...folders.filter(f => f.id === INBOX_ID), ...flattenFolders(userFolders).map(r => r.folder)];
}

export function createFolder(input: {
  name: string;
  icon?: string;
  color?: string;
  parentId?: string;
}): Promise<Folder> {
  return serial(async () => {
    const name = normalizeName(input.name);
    const icon = input.icon ?? FOLDER_ICON;
    checkIcon(icon);
    const all = await readAllFolders();
    const folders = all.filter(mine);
    if (!canParent(folders, undefined, input.parentId, scope)) throw new StorageError(t('errInvalidImport'));
    const folder: Folder = {
      id: newId(),
      name,
      icon,
      order: folders.filter(f => f.parentId === input.parentId).reduce((m, f) => Math.max(m, f.order), -1) + 1,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      accountId: scope,
    };
    if (input.color !== undefined) {
      checkColor(input.color);
      folder.color = input.color;
    }
    await writeFolders(all, [...folders, folder]);
    return folder;
  });
}

export function updateFolder(
  id: string,
  patch: { name?: string; icon?: string; color?: string | null; parentId?: string | null },
): Promise<Folder> {
  return serial(async () => {
    if (isBuiltinFolder(id)) throw new StorageError(t('errBuiltinImmutable'));
    const all = await readAllFolders();
    const folders = all.filter(mine);
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
    // 付け替えの前の祖先。付け替えたあとの木からは求められない
    const oldAncestorIds = patch.parentId !== undefined ? ancestors(folders, id).map(f => f.id) : [];
    if (patch.parentId !== undefined) {
      if (!canParent(folders, id, patch.parentId, scope)) throw new StorageError(t('errInvalidImport'));
      if (patch.parentId) next.parentId = patch.parentId; else delete next.parentId;
      // 親が変わったら、新しい親の子の末尾に置く
      if (next.parentId !== folders[idx].parentId) {
        next.order = folders.filter(f => f.parentId === next.parentId).reduce((m, f) => Math.max(m, f.order), -1) + 1;
      }
    }
    folders[idx] = next;
    if (patch.parentId !== undefined) await writeReparented(all, folders, id, oldAncestorIds);
    else await writeFolders(all, folders);
    return next;
  });
}

/** フォルダを削除したときに消える、フォルダ (子・孫を含む) と、所属が外れるポストの数。保存は変えない */
export async function folderDeletionImpact(id: string): Promise<{ folders: number; posts: number }> {
  const folders = await readFolders();
  const ids = new Set([id, ...descendants(folders, id).map(f => f.id)]);
  const posts = (await listBookmarks()).filter(b => b.folderIds.some(fid => ids.has(fid))).length;
  return { folders: folders.filter(f => ids.has(f.id)).length, posts };
}

/**
 * 親を付け替えたときの保存。動かしたフォルダ (子孫を含む) に入っているポストだけ、新しい木で祖先に入れ直す。
 * 古い祖先のうち新しい祖先に含まれないものは外す。祖先への所属は、直接選んだものと区別できないため。
 * 他のフォルダの祖先として必要な ID は、withAncestors で戻る。フォルダとポストを 1 回の書き込みで保存する
 */
async function writeReparented(
  all: Folder[],
  folders: Folder[],
  movedId: string,
  oldAncestorIds: string[],
): Promise<void> {
  const resolveMemberships = reparentedFolderResolver(folders, movedId, oldAncestorIds);
  const map = await readMap(scope);
  const before = { ...map };
  for (const [k, b] of Object.entries(map)) {
    if (inScope(b)) map[k] = { ...b, folderIds: resolveMemberships(b.folderIds) };
  }
  await writeBookmarkChanges(before, map, { [KEY_FOLDERS]: [...all.filter(f => !mine(f)), ...folders] });
}

/** フォルダを、子・孫ごと 1 回の書き込みで削除する。残る祖先への所属は保つ。所属がすべて無くなったポストは、未分類に入る */
export function deleteFolder(id: string): Promise<void> {
  return serial(async () => {
    if (isBuiltinFolder(id)) throw new StorageError(t('errBuiltinImmutable'));
    const all = await readAllFolders();
    const folders = all.filter(mine);
    if (!folders.some(f => f.id === id)) throw new StorageError(t('errNotFound'));
    const removed = new Set([id, ...descendants(folders, id).map(f => f.id)]);
    const next = all.filter(f => !mine(f) || !removed.has(f.id));
    const map = await readMap(scope);
    const before = { ...map };
    for (const [k, b] of Object.entries(map)) {
      if (inScope(b)) map[k] = { ...b, folderIds: normalizeFolderIds(withoutDeletedFolders(b.folderIds, removed)) };
    }
    const needsInbox = Object.values(map).some(b => inScope(b) && b.folderIds.includes(INBOX_ID));
    if (needsInbox && !next.some(f => mine(f) && f.id === INBOX_ID)) {
      next.push({ id: INBOX_ID, name: '', icon: 'ti-star', order: 0, accountId: scope });
    }
    await writeBookmarkChanges(before, map, { [KEY_FOLDERS]: next });
  });
}

// ---- Bookmarks ----

export async function listBookmarks(): Promise<Bookmark[]> {
  return Object.values(await readMap(scope));
}

/** 全アカウントの保存済みポストの tweetId (画像キャッシュの掃除用: どのアカウントにも無いポストの画像は消してよい) */
export async function listAllTweetIds(): Promise<Set<string>> {
  return new Set((await keysOf()).map((key) => key.slice(key.lastIndexOf(':') + 1)));
}

/** 全アカウントのブックマーク (画像キャッシュの post.json 用)。書き込み用ではない */
export async function listAllBookmarks(): Promise<Bookmark[]> {
  return Object.values(await readMap());
}

/** 保存済みポストの tweetId 一覧 (取り込み件数の計算用) */
export async function getSavedIds(accountId: string = scope): Promise<Set<string>> {
  const prefix = 'bm:' + accountId + ':';
  return new Set((await keysOf(accountId)).map((key) => key.slice(prefix.length)));
}

export async function getBookmark(tweetId: string): Promise<Bookmark | undefined> {
  return readOne(scope, tweetId);
}

/** アカウントを引数で指定して読む。裏方 (service worker) が、画面のアカウントの範囲 (scope) を入れ替えずに読むための関数 */
export async function getBookmarkOf(accountId: string, tweetId: string): Promise<Bookmark | undefined> {
  return readOne(accountId, tweetId);
}

/** 受け皿の作成を同期で計画し、ポストと同じ set にもまとめられるようにする。 */
function withInboxFolder(all: Folder[], accountId: string): Folder[] {
  const folders = all.filter((f) => f.accountId === accountId);
  if (folders.some((f) => f.id === INBOX_ID)) return all;
  const others = all.filter((f) => f.accountId !== accountId);
  return [...others, ...folders, {
    id: INBOX_ID, name: '', icon: 'ti-star',
    order: folders.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId,
  }];
}

/**
 * ポストの所属フォルダを設定する (保存)。INBOX_ID だけなら「未分類」として保存する。
 * 空配列も「未分類」として保存する (保存の解除は、明示的な removeBookmark だけ)。
 * 既存の savedAt / snapshot は、新規保存でなければ維持する。
 */
export function setBookmarkFolders(
  tweetId: string,
  folderIds: string[],
  snapshot: Bookmark['snapshot'],
): Promise<Bookmark> {
  return serial(async () => {
    const { folders: all, map } = await readFoldersAndMap([key(tweetId)]);
    const ids = withAncestors(folderIds, all.filter(mine)); // 「未分類」は他のフォルダと同時には持たない
    const nextFolders = ids.includes(INBOX_ID) ? withInboxFolder(all, scope) : all;
    const prev = map[key(tweetId)];
    const b: Bookmark = { accountId: scope, tweetId, folderIds: ids, savedAt: prev?.savedAt ?? Date.now(), snapshot: keepFullText(prev?.snapshot, snapshot) };
    await chrome.storage.local.set({
      [storageKey(scope, tweetId)]: b,
      ...(nextFolders !== all ? { [KEY_FOLDERS]: nextFolders } : {}),
    });
    return b;
  });
}

/**
 * たたまれた状態の snapshot で保存し直すとき、すでに全文を取れている (truncated が偽で、本文が長い) 保存分の本文を、
 * たたまれた短い本文で上書きしない (v24)。引用は新しい snapshot に無ければ保存分を残す。翻訳の印は採用した本文に合わせる。
 */
export function keepFullText(prev: Bookmark['snapshot'] | undefined, next: Bookmark['snapshot']): Bookmark['snapshot'] {
  const merged = next.quote || !prev?.quote ? next : { ...next, quote: prev.quote };
  if (!prev || next.truncated !== true || prev.truncated === true || prev.text.length < next.text.length) return merged;
  const { truncated: _t, segments: _s, translated: _tr, ...rest } = merged;
  return { ...rest, text: prev.text, ...(prev.segments ? { segments: prev.segments } : {}), ...(prev.translated ? { translated: true } : {}), truncated: false };
}

/** 全文を取れていない (truncated が真の) 現在のアカウントのポスト */
export async function listTruncated(): Promise<Bookmark[]> {
  return (await listBookmarks()).filter((b) => b.snapshot.truncated === true);
}

/** 全アカウントの、全文を取れていないポスト (裏方の取得用。書き込み用ではない) */
export async function listAllTruncated(): Promise<Bookmark[]> {
  return (await listAllBookmarks()).filter((b) => b.snapshot.truncated === true);
}

/**
 * 全文を取れたとき、保存してあるポストの text / segments / translated / truncated だけを更新する (v24)。
 * ほかの項目 (フォルダ、保存日時、メディアなど) は変えない。保存されていない / truncated が真でないポストは何もしない。
 * アカウントは引数で指定する (裏方は、画面のアカウントの範囲とは無関係に動かすため)。更新したら true
 */
export function refreshFullText(accountId: string, tweetId: string, full: { text: string; segments?: Segment[]; translated?: true }): Promise<boolean> {
  return serial(async () => {
    const cur = await readOne(accountId, tweetId);
    if (!cur || cur.snapshot.truncated !== true || !full.text) return false;
    const { segments: _s, translated: _tr, ...rest } = cur.snapshot;
    const next = {
      ...cur,
      snapshot: {
        ...rest,
        text: full.text,
        ...(full.segments ? { segments: full.segments } : {}),
        ...(full.translated === true ? { translated: true } : {}),
        truncated: false,
      },
    };
    await write(storageKey(accountId, tweetId), next);
    return true;
  });
}

/** PostShelf から外す (明示的な操作。X 側のブックマークには触らない) */
export function removeBookmark(tweetId: string): Promise<void> {
  return serial(async () => {
    const prev = await readOne(scope, tweetId);
    if (!prev) return;
    await chrome.storage.local.set({});
    await chrome.storage.local.remove(storageKey(scope, tweetId));
  });
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
/** 取り込んだフォルダの icon / color が候補に無ければ、icon は既定に、color は外す (CSS に入る値なので。フォルダ自体は残す) */
function cleanFolderLook<T extends Folder>(f: T): T {
  const { color, ...rest } = f;
  return {
    ...rest,
    icon: (ICONS as readonly string[]).includes(f.icon) ? f.icon : FOLDER_ICON,
    ...(isStr(color) && (COLORS as readonly string[]).includes(color) ? { color } : {}),
  } as T;
}
/** ポストの URL は x.com / twitter.com のものだけ (取り込んだ JSON が <a href> にそのまま使われるため) */
const X_URL = /^https:\/\/(x|twitter)\.com\//i;
const HTTPS_URL = /^https:\/\//i;
function validBookmark(b: any): b is Bookmark {
  return (
    b && isStr(b.tweetId) && Array.isArray(b.folderIds) && b.folderIds.every(isStr) &&
    typeof b.savedAt === 'number' && b.snapshot && isStr(b.snapshot.text) && isStr(b.snapshot.url) && X_URL.test(b.snapshot.url) &&
    isStr(b.snapshot.handle) && isStr(b.snapshot.author) && Array.isArray(b.snapshot.media)
  );
}
/** 引用が不正なら引用だけ落とす。翻訳の印と segments は独立に検証する。 */
function cleanQuote(raw: unknown): Bookmark['snapshot']['quote'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const q = raw as Record<string, unknown>;
  if (!isStr(q.author) || !isStr(q.handle) || !isStr(q.text) || !Array.isArray(q.media) || (q.createdAt !== undefined && !isStr(q.createdAt)) ||
      (q.url !== undefined && (!isStr(q.url) || !X_URL.test(q.url)))) return undefined;
  const segments = sanitizeSegments(q.segments);
  return {
    author: q.author, handle: q.handle, text: q.text, media: q.media.filter(isXImageUrl),
    ...(q.hasVideo === true
      ? { hasVideo: true, ...(isXImageUrl(q.videoPoster) ? { videoPoster: q.videoPoster } : {}) }
      : {}),
    ...(isXImageUrl(q.avatar) ? { avatar: q.avatar } : {}), ...(isStr(q.createdAt) ? { createdAt: q.createdAt } : {}),
    ...(isStr(q.url) ? { url: q.url } : {}), ...(segments ? { segments } : {}), ...(q.translated === true ? { translated: true } : {}),
  };
}

/** 取り込んだ JSON の snapshot の、省略できる項目 (v24) を検証する。不正なら、その項目だけ捨てる (text で表示する) */
function cleanSnapshot(s: Bookmark['snapshot']): Bookmark['snapshot'] {
  type RawSnapshot = Bookmark['snapshot'] & {
    segments?: unknown;
    truncated?: unknown;
    videoPoster?: unknown;
    hasVideo?: unknown;
    hasLink?: unknown;
    createdAt?: unknown;
  };
  const {
    segments,
    truncated,
    avatar,
    media,
    quote,
    translated,
    videoPoster,
    hasVideo,
    hasLink,
    createdAt,
    ...rest
  } = s as RawSnapshot;
  const seg = segments === undefined ? undefined : sanitizeSegments(segments);
  const clean = cleanQuote(quote);
  // 画像・アバターは X の画像の置き場の URL だけ (知らないサーバーへの勝手な要求や javascript: を通さない)。満たさない要素だけ捨てる
  return {
    ...rest,
    media: (media as unknown[]).filter(isXImageUrl),
    ...(isXImageUrl(avatar) ? { avatar } : {}),
    ...(isXImageUrl(videoPoster) ? { videoPoster } : {}),
    ...(typeof hasVideo === 'boolean' ? { hasVideo } : {}),
    ...(typeof hasLink === 'boolean' ? { hasLink } : {}),
    ...(isStr(createdAt) ? { createdAt } : {}),
    ...(seg ? { segments: seg } : {}),
    ...(typeof truncated === 'boolean' ? { truncated } : {}),
    ...(clean ? { quote: clean } : {}),
    ...(translated === true ? { translated: true } : {}),
  };
}
function validAccount(a: any): a is Account {
  return a && isStr(a.id) && a.id !== '' && isStr(a.handle) && typeof a.lastSeenAt === 'number';
}

/**
 * JSON を検証してマージ取り込みする (同じアカウントの同 ID は上書き)。不正なら StorageError。
 * 新形式 (version 2) はアカウントごとに入る。旧形式 (version 1 / accountId なし) は 'unknown' に入る。
 */
export function importData(json: unknown): Promise<number> {
  return serial(async () => {
    const d = json as (Partial<ExportData> & { version?: number }) | null;
    if (!d || d.app !== 'PostShelf' || !Array.isArray(d.folders) || !Array.isArray(d.bookmarks) || (d.version !== undefined && d.version > 2)) {
      throw new StorageError(t('errInvalidImport'));
    }
    const legacy = d.version === undefined || d.version < 2;
    const acc = (v: unknown) => (!legacy && isStr(v) && v ? (v === UNKNOWN_ACCOUNT_ID ? v : accountIdOf(v)) : UNKNOWN_ACCOUNT_ID);
    const folders = d.folders.filter(validFolder).map((f) => cleanFolderLook({ ...f, accountId: acc(f.accountId) }));
    // 保存時と同じ規則で所属を整える ([] / 'all' は「未分類」に)。件数と中身は変えない
    const bookmarks = d.bookmarks
      .filter(validBookmark)
      .map((b) => ({ ...b, folderIds: normalizeFolderIds(b.folderIds), snapshot: cleanSnapshot(b.snapshot), accountId: acc(b.accountId) }));
    const curFolders = new Map((await readAllFolders()).map((f) => [bookmarkKey(f.accountId ?? UNKNOWN_ACCOUNT_ID, f.id), f]));
    for (const f of folders) curFolders.set(bookmarkKey(f.accountId, f.id), f);
    const repairedFolders = sanitizeParents([...curFolders.values()]);
    const accountFolders = foldersByAccount(repairedFolders);
    curFolders.clear();
    for (const f of repairedFolders) curFolders.set(bookmarkKey(f.accountId ?? UNKNOWN_ACCOUNT_ID, f.id), f);
    for (const b of bookmarks) b.folderIds = withAncestors(b.folderIds, accountFolders.get(b.accountId) ?? []);
    // 「未分類」に入るポストがあるアカウントには、受け皿のフォルダを用意する
    for (const b of bookmarks) {
      if (!b.folderIds.includes(INBOX_ID) || curFolders.has(bookmarkKey(b.accountId, INBOX_ID))) continue;
      const mineF = accountFolders.get(b.accountId) ?? [];
      curFolders.set(bookmarkKey(b.accountId, INBOX_ID), { id: INBOX_ID, name: '', icon: 'ti-star', order: mineF.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId: b.accountId });
    }
    const accounts = await read<Record<string, Account>>(KEY_ACCOUNTS, {});
    const map = await readMap();
    const before = { ...map };
    for (const b of bookmarks) map[bookmarkKey(b.accountId, b.tweetId)] = b;
    for (const [k, b] of Object.entries(map)) {
      map[k] = { ...b, folderIds: withAncestors(b.folderIds, accountFolders.get(b.accountId) ?? []) };
    }
    if (!legacy && Array.isArray(d.accounts)) {
      for (const a of d.accounts.filter(validAccount)) {
        const id = accountIdOf(a.id);
        if (id === UNKNOWN_ACCOUNT_ID) continue;
        const { avatar, ...rest } = a;
        // アイコンは X の画像の置き場の URL だけ残す。満たさなければ項目ごと捨てる
        if (!accounts[id] || accounts[id].lastSeenAt < a.lastSeenAt) {
          accounts[id] = { ...rest, ...(isXImageUrl(avatar) ? { avatar } : {}), id };
        }
      }
    }
    await writeBookmarkChanges(before, map, {
      [KEY_FOLDERS]: [...curFolders.values()],
      [KEY_ACCOUNTS]: accounts,
    });
    return bookmarks.length;
  });
}

type FillItem = { tweetId: string; snapshot?: FillView };

/** 補えるかの判定に要る、保存側の項目 */
export type FillView = Pick<
  Snapshot,
  'author' | 'handle' | 'avatar' | 'media' | 'hasVideo' | 'hasLink' | 'videoPoster' | 'createdAt' | 'quote'
>;

const httpsUrl = (v: unknown): v is string => isStr(v) && HTTPS_URL.test(v);

/** 保存側の引用の、空の項目だけを画面側で埋める。補えるものが無ければ undefined */
function fillQuote(saved: QuoteSnapshot, incoming: QuoteSnapshot): QuoteSnapshot | undefined {
  const patch: Partial<QuoteSnapshot> = {};
  if ((!saved.avatar || isEmojiImageUrl(saved.avatar)) && incoming.avatar && !isEmojiImageUrl(incoming.avatar)) {
    patch.avatar = incoming.avatar;
  }
  if (!saved.media.length && !saved.hasVideo && incoming.media.length) patch.media = [...incoming.media];
  if (!saved.createdAt && incoming.createdAt) patch.createdAt = incoming.createdAt;
  if (saved.hasVideo && !saved.videoPoster && incoming.videoPoster) patch.videoPoster = incoming.videoPoster;
  return Object.keys(patch).length ? { ...saved, ...patch } : undefined;
}

/**
 * 保存側が空で、画面側に値がある項目だけを返す。既にある値は上書きしない。補えるものが無ければ null。
 * 保存データの更新 (fillMissing) と、画面側での「補える項目があるか」の判定の両方が、この 1 か所の規則を使う。
 */
export function missingFields(saved: FillView, incoming: FillView): Partial<Snapshot> | null {
  const patch: Partial<Snapshot> = {};
  if ((!saved.avatar || isEmojiImageUrl(saved.avatar)) && httpsUrl(incoming.avatar) && !isEmojiImageUrl(incoming.avatar)) {
    patch.avatar = incoming.avatar;
  }
  const media = incoming.media.filter(httpsUrl);
  if (!saved.media.length && !saved.hasVideo && media.length) patch.media = media;
  const poster = httpsUrl(incoming.videoPoster) ? incoming.videoPoster : undefined;
  if (saved.hasVideo && !saved.videoPoster && poster) patch.videoPoster = poster;
  if (!saved.hasVideo && !saved.media.length && incoming.hasVideo) {
    patch.hasVideo = true;
    if (poster) patch.videoPoster = poster;
  }
  // 名前が取れず、ハンドルで代用されていた保存分だけ
  const handleName = saved.handle.replace(/^@/, '');
  const name = incoming.author.trim();
  if (saved.author === handleName && name && name !== handleName) patch.author = name;
  if (!saved.createdAt && incoming.createdAt) patch.createdAt = incoming.createdAt;
  if (!saved.hasLink && incoming.hasLink) patch.hasLink = true;
  // quote の有無は新規保存時に決める。後から見えた引用候補の誤検出を補完で固定しない。
  const quote = saved.quote ? cleanQuote(incoming.quote) : undefined;
  if (quote && isEmojiImageUrl(quote.avatar)) delete quote.avatar;
  if (quote && saved.quote) {
    const merged = fillQuote(saved.quote, quote);
    if (merged) patch.quote = merged;
  }
  return Object.keys(patch).length ? patch : null;
}

/** 画面側の判定用に、保存済みポストの補う対象の項目だけを返す (snapshot 全体は運ばない) */
export async function getFillViews(accountId: string = scope): Promise<Map<string, FillView>> {
  const views = new Map<string, FillView>();
  for (const b of Object.values(await readMap(accountId))) {
    if (b.accountId !== accountId) continue;
    const { author, handle, avatar, media, hasVideo, hasLink, videoPoster, createdAt, quote } = b.snapshot;
    views.set(b.tweetId, { author, handle, avatar, media, hasVideo, hasLink, videoPoster, createdAt, quote });
  }
  return views;
}

/** 保存済みの欠けた項目だけを補う。既にある値・本文・所属先・時刻は変えず、未保存のものは作らない。変えたポストの件数を返す */
export function fillMissing(items: FillItem[], accountId: string = scope): Promise<number> {
  if (items.length === 0) return Promise.resolve(0);
  return serial(async () => {
    const map = await readMany(items.map((item) => bookmarkKey(accountId, item.tweetId)));
    const before = { ...map };
    let changed = 0;
    for (const it of items) {
      const k = bookmarkKey(accountId, it.tweetId);
      const old = map[k];
      if (!old || !it.snapshot) continue;
      const patch = missingFields(old.snapshot, it.snapshot);
      if (!patch) continue;
      map[k] = { ...old, snapshot: { ...old.snapshot, ...patch } };
      changed++;
    }
    if (changed) await writeBookmarkChanges(before, map); // 読み込みから書き込みまで別の await を挟まない
    return changed;
  });
}

/**
 * フォルダ未所属で取り込む (ページ収集用)。既存ポストは触らない。
 * 取り込んだポストは専用の「未分類」フォルダへ入れる。
 *
 * items は x.com の一覧の並び (上から下 = 新しい追加順) のまま渡す。savedAt は取り込んだ時刻ではなく、
 * 一覧での位置から決めるので (src/shared/ordering.ts)、「保存が新しい順」が x.com のブックマークの並びと一致する。
 * 取り込み済みのポストは、並びの基準 (すぐ上・すぐ下) として使うだけで、変更しない。
 * @param startedAt 取り込みの開始時刻 (いちばん上の区間の基準)
 */
export function addCollected(items: { tweetId: string; snapshot?: Bookmark['snapshot'] }[], startedAt: number = Date.now(), accountId: string = scope): Promise<number> {
  if (items.length === 0) return Promise.resolve(0);
  // 取り込み中にアカウントが切り替わっても、保存先は開始時のアカウントのまま (v26)。モジュールの scope には頼らない
  const keyOf = (tweetId: string) => bookmarkKey(accountId, tweetId);
  return serial(async () => {
    // snapshot の無い項目は並び順の基準 (保存済みのもの) としてだけ使う。保存データに無ければ、基準にもしない
    const plan = (m: BookmarkMap) => {
      const usable = items.filter((it) => it.snapshot || m[keyOf(it.tweetId)]);
      const order = assignOrder(
        usable.map((it) => ({ id: it.tweetId, savedAt: m[keyOf(it.tweetId)]?.savedAt })),
        startedAt,
      );
      return { order, fresh: usable.filter((it) => !m[keyOf(it.tweetId)] && order.has(it.tweetId)) };
    };
    const folders = await readAllFolders();
    const map = await readMany(items.map((item) => keyOf(item.tweetId)));
    const before = { ...map };
    const { order, fresh } = plan(map);
    if (fresh.length === 0) return 0;
    let added = 0;
    for (const it of fresh) {
      if (map[keyOf(it.tweetId)]) continue;
      map[keyOf(it.tweetId)] = { accountId, tweetId: it.tweetId, folderIds: [INBOX_ID], savedAt: order.get(it.tweetId)!, snapshot: it.snapshot! };
      added++;
    }
    // map を読んだあと別の await を挟まない。受け皿が無い場合も同じ書き込みで作る。
    const nextFolders = withInboxFolder(folders, accountId);
    await writeBookmarkChanges(before, map, {
      ...(nextFolders !== folders ? { [KEY_FOLDERS]: nextFolders } : {}),
    });
    return added;
  });
}

/** 時刻以外のアカウント情報と、同順位を含む新しい順が同じかを比べる。 */
function sameAccountData(change: chrome.storage.StorageChange): boolean {
  const { oldValue, newValue } = change;
  if (!oldValue || !newValue || typeof oldValue !== 'object' || typeof newValue !== 'object') return false;
  const before = oldValue as Record<string, Account>;
  const after = newValue as Record<string, Account>;
  const ids = Object.keys(before);
  if (ids.length !== Object.keys(after).length) return false;
  for (const id of ids) {
    const prev = before[id];
    const next = after[id];
    if (!validAccount(prev) || !validAccount(next)) return false;
    if (prev.id !== next.id || prev.handle !== next.handle
      || prev.displayName !== next.displayName || prev.avatar !== next.avatar) return false;
  }
  // accountSummaries と同じく未設定は最後。同順位の変化も通知し、表示対象が絞られていても順を保つ。
  const rank = (a: Account) => a.id === UNKNOWN_ACCOUNT_ID ? -Infinity : a.lastSeenAt;
  const sorted = (accounts: Record<string, Account>) => Object.keys(accounts)
    .sort((a, b) => rank(accounts[b]) - rank(accounts[a]));
  const oldOrder = sorted(before);
  const newOrder = sorted(after);
  for (let i = 0; i < oldOrder.length; i++) {
    const id = oldOrder[i];
    if (id !== newOrder[i]) return false;
    if (i === 0) continue;
    const wasTied = rank(before[id]) === rank(before[oldOrder[i - 1]]);
    const isTied = rank(after[id]) === rank(after[newOrder[i - 1]]);
    if (wasTied !== isTied) return false;
  }
  return true;
}

/** フォルダ/ブックマーク/アカウントが変わったら呼ばれる (別タブ・manager からの変更も拾う)。解除関数を返す */
export function onDataChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    if (KEY_FOLDERS in changes || Object.keys(changes).some((key) => key.startsWith('bm:'))
      || (KEY_ACCOUNTS in changes && !sameAccountData(changes[KEY_ACCOUNTS]))) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

// ---- Bulk operations (manager) ----
// どれも 1 回の書き込みにまとめ、取り消し用に変更前の状態 (BookmarkUndo) を返す。

/** 保存キー (accountId:tweetId) → 変更前のブックマーク (null は「もともと存在しなかった」) */
export type BookmarkUndo = Record<string, Bookmark | null>;

function mutateBookmarks(
  tweetIds: string[],
  fn: (b: Readonly<Bookmark>, withoutRemoved: (ids: readonly string[]) => string[]) => Bookmark | null,
  removeIds: readonly string[] = [],
): Promise<BookmarkUndo> {
  if (tweetIds.length === 0) return Promise.resolve({});
  return serial(async () => {
    // 受け皿も同じ set に含め、ポストを読んだあとに別の読み出しを挟まない。
    const treeFolders = await readAllFolders();
    const mineFolders = treeFolders.filter(mine);
    const includeAncestors = withAncestorResolver(mineFolders);
    const withoutRemoved = withoutDescendantsResolver(removeIds, mineFolders);
    const apply = (map: BookmarkMap): BookmarkUndo => {
      const undo: BookmarkUndo = {};
      for (const tid of new Set(tweetIds)) {
        const k = key(tid);
        const prev = map[k];
        if (!prev) continue;
        // fn は prev とその中身を変更せず、新しい所属を持つオブジェクトを返す。undo は変更前の参照を保つ。
        let next = fn(prev, withoutRemoved);
        if (next) next = { ...next, folderIds: includeAncestors(next.folderIds) };
        // 本文・画像を文字列化しない。所属以外を変える fn も、別の値・snapshot の参照なら変更として扱う。
        if (next && next.accountId === prev.accountId && next.tweetId === prev.tweetId &&
          next.savedAt === prev.savedAt && next.snapshot === prev.snapshot &&
          next.folderIds.length === prev.folderIds.length && next.folderIds.every((id, i) => id === prev.folderIds[i])) continue;
        undo[k] = prev;
        if (next) map[k] = next;
        else delete map[k];
      }
      return undo;
    };
    const map = await readMany([...new Set(tweetIds)].map(key));
    const before = { ...map };
    const undo = apply(map);
    if (Object.keys(undo).length === 0) return undo;
    const hasInbox = Object.keys(undo).some((key) => map[key]?.folderIds.includes(INBOX_ID));
    const nextFolders = hasInbox ? withInboxFolder(treeFolders, scope) : treeFolders;
    await writeBookmarkChanges(before, map, nextFolders === treeFolders ? {} : { [KEY_FOLDERS]: nextFolders });
    return undo;
  });
}

const uniq = (a: string[]) => [...new Set(a)];
const realIds = (ids: string[]) => ids.filter((id) => !isBuiltinFolder(id));

/** 一括メニューの確定。追加と解除を同じ書き込み・同じ取り消しにまとめる。 */
export const changeBookmarkFolders = (tweetIds: string[], addIds: string[], removeIds: string[]) =>
  mutateBookmarks(tweetIds, (b, withoutRemoved) => ({
    ...b,
    folderIds: addIds.includes(INBOX_ID) ? [INBOX_ID]
      : uniq([...withoutRemoved(b.folderIds), ...realIds(addIds)]),
  }), removeIds);

export const addToFolders = (tweetIds: string[], folderIds: string[]) =>
  mutateBookmarks(tweetIds, (b) => ({ ...b, folderIds: uniq([...b.folderIds, ...realIds(folderIds)]) }));

/**
 * フォルダから外す。最後のフォルダを外してもポストは消さず「未分類」に移す
 * (ポストを消すのは明示的な deleteBookmarks だけ)。
 */
export const removeFromFolders = (tweetIds: string[], folderIds: string[]) =>
  mutateBookmarks(tweetIds, (b, withoutRemoved) => {
    const rest = withoutRemoved(b.folderIds);
    return { ...b, folderIds: rest.length ? rest : [INBOX_ID] };
  }, folderIds);

/** from から外して to に入れる。from が「すべて」(または未指定) なら追加のみ */
export const moveToFolder = (tweetIds: string[], fromId: string | null, toId: string) =>
  mutateBookmarks(tweetIds, (b, withoutRemoved) => {
    const rest = withoutRemoved(b.folderIds);
    if (toId === INBOX_ID) return { ...b, folderIds: [INBOX_ID] }; // 行き先が「未分類」なら、ほかのフォルダは外す
    return { ...b, folderIds: uniq([...rest, ...realIds([toId])]) };
  }, fromId && !isBuiltinFolder(fromId) && fromId !== toId ? [fromId] : []);

/** PostShelf から削除する (X 側のブックマークには触らない) */
export const deleteBookmarks = (tweetIds: string[]) => mutateBookmarks(tweetIds, () => null);

/** BookmarkUndo の内容で変更前の状態に戻す (1 回の書き込み) */
export function restoreBookmarks(undo: BookmarkUndo): Promise<void> {
  if (Object.keys(undo).length === 0) return Promise.resolve();
  return serial(async () => {
    const folders = await readAllFolders();
    const accountFolders = foldersByAccount(folders);
    const map = await readMany(Object.keys(undo));
    const before = { ...map };
    for (const [k, prev] of Object.entries(undo)) {
      if (prev) map[k] = { ...prev, folderIds: withAncestors(prev.folderIds, accountFolders.get(prev.accountId) ?? []) };
      else delete map[k];
    }
    await writeBookmarkChanges(before, map);
  });
}

/** フォルダの並び順を更新する。orderedIds に無いフォルダは末尾に残す。「すべて」は無視、「未分類」は表示側で常に先頭 */
export function reorderFolders(orderedIds: string[], move?: { id:string; parentId:string | null }): Promise<void> {
  return serial(async () => {
    const all = await readAllFolders();
    const folders = all.filter(mine);
    let oldAncestorIds: string[] = []; // 付け替えの前の祖先 (parentId を書き換える前に求める)
    if (move) {
      if (!canParent(folders, move.id, move.parentId, scope)) throw new StorageError(t('errInvalidImport'));
      const f = folders.find(f => f.id === move.id)!;
      oldAncestorIds = ancestors(folders, move.id).map(a => a.id);
      if (move.parentId) f.parentId = move.parentId; else delete f.parentId;
    }
    const rank = new Map(realIds(orderedIds).map((id, i) => [id, i]));
    const sorted = [...folders].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.order - b.order);
    const counts = new Map<string,number>();
    // order は、同じ親の中での連番に振り直す
    const next = sorted.map(f => {
      const parent = f.parentId ?? '';
      const order = counts.get(parent) ?? 0;
      counts.set(parent, order + 1);
      return { ...f, order };
    });
    if (move) await writeReparented(all, next, move.id, oldAncestorIds);
    else await writeFolders(all, next);
  });
}


// ---- Accounts (v9) ----

const ACCOUNT_REFRESH_MS = 60_000;

/**
 * content script が読み取ったアカウントを記録する (accounts と lastSeenAccount)。
 * 内容が変わっていなければ、最後の記録から 1 分以内は書き込まない (DOM の変化のたびに呼ばれるため)。
 */
export function noteAccount(input: { handle: string; displayName?: string; avatar?: string }, now = Date.now()): Promise<Account> {
  return serial(async () => {
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
      avatar: (isEmojiImageUrl(input.avatar) ? undefined : input.avatar)
        ?? (isEmojiImageUrl(prev?.avatar) ? undefined : prev?.avatar),
      lastSeenAt: now,
    };
    const same = prev && last?.id === id && prev.handle === next.handle && prev.displayName === next.displayName && prev.avatar === next.avatar;
    if (same && now - prev.lastSeenAt < ACCOUNT_REFRESH_MS) return prev;
    await chrome.storage.local.set({ [KEY_ACCOUNTS]: { ...accounts, [id]: next }, [KEY_LAST_ACCOUNT]: next });
    return next;
  });
}

/** content script が最後に読み取ったアカウント (manager / サイドパネル / popup の既定の表示アカウント) */
export async function getLastSeenAccount(): Promise<Account | null> {
  const a = await read<Account | null>(KEY_LAST_ACCOUNT, null);
  return a && validAccount(a) ? a : null;
}

/** accounts の変更を時刻だけの場合も通知する。保存データは読み直さず、解除関数を返す。 */
export function onAccountsTouched(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && KEY_ACCOUNTS in changes) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
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
  return accountSummaries(await readMap());
}

/** 管理画面の一覧とアカウント別件数を同じ保存データから作る。全件の読み出しは 1 回。 */
export async function listBookmarksWithAccounts(): Promise<{ bookmarks: Bookmark[]; accounts: AccountSummary[] }> {
  const map = await readMap();
  return { bookmarks: Object.values(map).filter(inScope), accounts: await accountSummaries(map) };
}

/** 初期表示のアカウント選択と一覧で、全件とフォルダの読み込みを共有する。 */
export async function loadManagerData(): Promise<{
  accounts: AccountSummary[];
  forAccount: (accountId: string) => { bookmarks: Bookmark[]; folders: Folder[] };
}> {
  const [map, folders] = await Promise.all([readMap(), readAllFolders()]);
  const bookmarks = Object.values(map);
  return {
    accounts: await accountSummaries(map, folders),
    forAccount: (accountId) => ({
      bookmarks: bookmarks.filter((b) => b.accountId === accountId),
      folders: folderList(folders.filter((f) => f.accountId === accountId)),
    }),
  };
}

async function accountSummaries(map: BookmarkMap, loadedFolders?: Folder[]): Promise<AccountSummary[]> {
  const [accounts, folders, last] = await Promise.all([
    read<Record<string, Account>>(KEY_ACCOUNTS, {}),
    loadedFolders ?? readAllFolders(),
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
export function assignAccount(from: string, to: string): Promise<{ moved: number; merged: number }> {
  return serial(async () => {
    if (!to || from === to) throw new StorageError(t('errNotFound'));
    const [folders, map, accounts] = await Promise.all([readAllFolders(), readMap(), read<Record<string, Account>>(KEY_ACCOUNTS, {})]);
    const before = { ...map };
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
    for (const [k, b] of Object.entries(map)) {
      if (b.accountId === to) map[k] = { ...b, folderIds: withAncestors(b.folderIds, [...dest, ...movedFolders]) };
    }
    delete accounts[from];
    await writeBookmarkChanges(before, map, {
      [KEY_FOLDERS]: [...folders.filter((f) => f.accountId !== from), ...movedFolders],
      [KEY_ACCOUNTS]: accounts,
    });
    return { moved, merged };
  });
}

/** 1 つのアカウントのフォルダ・ポスト・アカウント情報を削除する (取り消し不可。X 側には触らない) */
export function deleteAccountData(accountId: string): Promise<void> {
  return serial(async () => {
    const [folders, map, accounts] = await Promise.all([readAllFolders(), readMap(), read<Record<string, Account>>(KEY_ACCOUNTS, {})]);
    const before = { ...map };
    for (const [k, b] of Object.entries(map)) if (b.accountId === accountId) delete map[k];
    delete accounts[accountId];
    await writeBookmarkChanges(before, map, {
      [KEY_FOLDERS]: folders.filter((f) => f.accountId !== accountId),
      [KEY_ACCOUNTS]: accounts,
    });
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
export function deleteAllData(): Promise<void> {
  return serial(async () => {
    const keys = await keysOf();
    await chrome.storage.local.set({ [KEY_FOLDERS]: [], [KEY_ACCOUNTS]: {}, [KEY_SCHEMA]: SCHEMA_VERSION, [KEY_REPAIRED]: true });
    await chrome.storage.local.remove([...keys, KEY_LAST_ACCOUNT]);
  });
}

/** ツリーの開閉は端末ごとの設定。呼び出し側は chrome.storage を直接触らず、この 2 つを使う */
export const getCollapsedFolders = async (): Promise<string[]> => (await getSettings()).folderTreeCollapsed ?? [];
export const setCollapsedFolders = async (ids: string[]): Promise<void> => {
  await updateSettings({ folderTreeCollapsed: [...new Set(ids)] });
};
