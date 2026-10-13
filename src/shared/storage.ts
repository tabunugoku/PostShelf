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
 *
 * 同時書き込みについて (v18): bookmarks は全件をまとめて読んで、全件をまとめて書く。
 *  - 同じ実行環境の中では、「読んで、変えて、書く」を serial() で 1 つずつ順に行い、読んだあと書くまでの間に await を挟まない。
 *  - 別の実行環境 (x.com のタブと管理画面など) の間の排他はしていない。ちょうど重なると、後から書いたほうが先の変更を消すおそれが残る。
 *    いまは、重なる時間を短くすることで抑えている (自動取り込みは 20 件ごとに保存する)。
 *  - 根本の対策案: 保存のキーを 1 件ずつに分ける (`bookmark:<accountId>:<tweetId>`)。ただし全データの移行が要り、
 *    失敗したときの危険が大きいので、まだ行っていない。
 */
import { isEmojiImageUrl } from './avatar';
import {
  ALL_FOLDER,
  COLORS,
  FOLDER_ICON,
  ICONS,
  ALL_FOLDER_ID,
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
import { ancestors, canParent, descendants, flattenFolders, sanitizeParents, withAncestors, withoutDescendants } from './folderTree';
import { assignOrder } from './ordering';
import { sanitizeSegments, type Segment } from './segments';

const KEY_FOLDERS = 'folders';
const KEY_BOOKMARKS = 'bookmarks';
const KEY_ACCOUNTS = 'accounts';
const KEY_LAST_ACCOUNT = 'lastSeenAccount';
const KEY_SCHEMA = 'schemaVersion';
const KEY_REPAIRED = 'folderIdsRepaired';
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

let chain: Promise<unknown> = Promise.resolve();
/** 同じ実行環境の中で、保存データを書き換える処理を 1 つずつ順に行う (失敗しても次の処理は止めない) */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * ポストの所属フォルダ ID の並びを整える。
 * 重複と「すべて」を除く / 実際のフォルダが 1 つでもあれば「未分類」を外す / 何も残らなければ [「未分類」]。
 */
export function normalizeFolderIds(ids: readonly string[]): string[] {
  const list = [...new Set(ids.filter((id) => id !== ALL_FOLDER_ID))];
  const real = list.filter((id) => id !== INBOX_ID);
  return real.length ? real : [INBOX_ID];
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
let migrationReady = false;
let migrationVersion = 0;
let migrationEvents: typeof chrome.storage.onChanged | undefined;
let unwatchMigration: (() => void) | undefined;

/** 完了の印や保存データの外部削除で、コンテキスト内の移行判定を無効化する。 */
function watchMigration(): void {
  if (migrationEvents === chrome.storage.onChanged) return;
  unwatchMigration?.();
  migrationEvents = chrome.storage.onChanged;
  migrationReady = false;
  migrating = undefined;
  migrationVersion++;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const schema = changes[KEY_SCHEMA];
    const repaired = changes[KEY_REPAIRED];
    const removed = [KEY_BOOKMARKS, KEY_FOLDERS].some((key) => key in changes && changes[key].newValue === undefined);
    if ((schema && (schema.newValue ?? 0) < SCHEMA_VERSION) || (repaired && repaired.newValue !== true) || removed) {
      migrationReady = false;
      migrationVersion++;
    }
  };
  const events = migrationEvents;
  events.addListener(listener);
  unwatchMigration = () => events.removeListener(listener);
}

/** どの公開関数も最初に呼ぶ。schemaVersion が古ければ (1 回だけ) 移行し、所属フォルダの不整合を (1 回だけ) 直す。失敗時は何も書き込まず例外 */
async function ensureMigrated(): Promise<void> {
  watchMigration();
  if (migrationReady) return;
  migrating ??= (async () => {
    while (!migrationReady) {
      const version = migrationVersion;
      const flags = await chrome.storage.local.get([KEY_SCHEMA, KEY_REPAIRED]);
      if (version !== migrationVersion) continue;
      const legacy = (flags[KEY_SCHEMA] ?? 0) < SCHEMA_VERSION;
      if (legacy || !flags[KEY_REPAIRED]) {
        const raw = await chrome.storage.local.get([KEY_FOLDERS, KEY_BOOKMARKS]);
        if (version !== migrationVersion) continue;
        let folders = raw[KEY_FOLDERS] ?? [];
        let bookmarks = raw[KEY_BOOKMARKS] ?? {};
        if (legacy) {
          const out = migrateToV2({ folders, bookmarks });
          folders = out.folders;
          bookmarks = out.bookmarks;
          await chrome.storage.local.set({ [KEY_FOLDERS]: folders, [KEY_BOOKMARKS]: bookmarks, [KEY_SCHEMA]: SCHEMA_VERSION });
        }
        if (version !== migrationVersion) continue;
        if (!flags[KEY_REPAIRED]) await repairFolderData(bookmarks, folders);
      }
      // 読み込み・保存中に外から消された場合は、古い判定を記憶せず読み直す。
      if (version === migrationVersion) migrationReady = true;
    }
  })().finally(() => { migrating = undefined; });
  await migrating;
}

/**
 * 所属フォルダが空のポストと、「未分類」と他のフォルダが同時に付いているポストを、1 回だけ直す (v18)。
 * 直し方は normalizeFolderIds と同じ。ポストの件数、tweetId、savedAt、snapshot は変えない (変わったら何も書かず例外)。
 * 直す対象が 0 件なら、書き込まずに印 (folderIdsRepaired) だけを付ける。
 */
export async function repairFolderIds(): Promise<void> {
  const data = await chrome.storage.local.get([KEY_BOOKMARKS, KEY_FOLDERS]);
  await repairFolderData(data[KEY_BOOKMARKS], data[KEY_FOLDERS]);
}

/** 初回の移行と修復で同じ入力を共有し、大きな保存データの再読み込みを避ける。 */
async function repairFolderData(raw: unknown, rawFolders: unknown): Promise<void> {
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
    await write(KEY_REPAIRED, true);
    return;
  }
  // 「未分類」に入ったポストがあるアカウントには、受け皿のフォルダ (名前なし = 表示時に解決) を用意する
  const nextFolders = [...folders];
  for (const accountId of needInbox) {
    const mineF = nextFolders.filter((f) => (f.accountId ?? UNKNOWN_ACCOUNT_ID) === accountId);
    if (mineF.some((f) => f.id === INBOX_ID)) continue;
    nextFolders.push({ id: INBOX_ID, name: '', icon: 'ti-star', order: mineF.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId });
  }
  await chrome.storage.local.set({ [KEY_FOLDERS]: nextFolders, [KEY_BOOKMARKS]: out, [KEY_REPAIRED]: true });
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
    const folders = await readFolders();
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
    await writeFolders([...folders, folder]);
    return folder;
  });
}

export function updateFolder(
  id: string,
  patch: { name?: string; icon?: string; color?: string | null; parentId?: string | null },
): Promise<Folder> {
  return serial(async () => {
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
    // 付け替えの前の祖先。付け替えたあとの木からは求められない
    const oldAncestorIds = ancestors(folders, id).map(f => f.id);
    if (patch.parentId !== undefined) {
      if (!canParent(folders, id, patch.parentId, scope)) throw new StorageError(t('errInvalidImport'));
      if (patch.parentId) next.parentId = patch.parentId; else delete next.parentId;
      // 親が変わったら、新しい親の子の末尾に置く
      if (next.parentId !== folders[idx].parentId) {
        next.order = folders.filter(f => f.parentId === next.parentId).reduce((m, f) => Math.max(m, f.order), -1) + 1;
      }
    }
    folders[idx] = next;
    if (patch.parentId !== undefined) await writeReparented(folders, id, oldAncestorIds);
    else await writeFolders(folders);
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
async function writeReparented(folders: Folder[], movedId: string, oldAncestorIds: string[]): Promise<void> {
  const all = await readAllFolders();
  const map = await readMap();
  const newAncestorIds = new Set(ancestors(folders, movedId).map(f => f.id));
  const stale = new Set(oldAncestorIds.filter(id => !newAncestorIds.has(id)));
  const subtree = new Set([movedId, ...descendants(folders, movedId).map(f => f.id)]);
  for (const [k, b] of Object.entries(map)) {
    if (!inScope(b) || !b.folderIds.some(id => subtree.has(id))) continue;
    map[k] = { ...b, folderIds: withAncestors(b.folderIds.filter(id => !stale.has(id)), folders) };
  }
  await chrome.storage.local.set({ [KEY_FOLDERS]: [...all.filter(f => !mine(f)), ...folders], [KEY_BOOKMARKS]: map });
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
    const map = await readMap();
    for (const [k, b] of Object.entries(map)) {
      if (inScope(b)) map[k] = { ...b, folderIds: normalizeFolderIds(b.folderIds.filter(fid => !removed.has(fid))) };
    }
    const needsInbox = Object.values(map).some(b => inScope(b) && b.folderIds.includes(INBOX_ID));
    if (needsInbox && !next.some(f => mine(f) && f.id === INBOX_ID)) {
      next.push({ id: INBOX_ID, name: '', icon: 'ti-star', order: 0, accountId: scope });
    }
    await chrome.storage.local.set({ [KEY_FOLDERS]: next, [KEY_BOOKMARKS]: map });
  });
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
export async function getSavedIds(accountId: string = scope): Promise<Set<string>> {
  const map = await readMap();
  return new Set(Object.values(map).filter((b) => b.accountId === accountId).map((b) => b.tweetId));
}

export async function getBookmark(tweetId: string): Promise<Bookmark | undefined> {
  return (await readMap())[key(tweetId)];
}

/** アカウントを引数で指定して読む。裏方 (service worker) が、画面のアカウントの範囲 (scope) を入れ替えずに読むための関数 */
export async function getBookmarkOf(accountId: string, tweetId: string): Promise<Bookmark | undefined> {
  return (await readMap())[bookmarkKey(accountId, tweetId)];
}

/** 「未分類」の受け皿のフォルダ (名前なし = 表示時に解決) が無ければ作る */
async function ensureInboxFolder(accountId: string = scope): Promise<void> {
  const all = await readAllFolders();
  const next = withInboxFolder(all, accountId);
  if (next !== all) await write(KEY_FOLDERS, next);
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
    const ids = withAncestors(folderIds, await readFolders()); // 「未分類」は他のフォルダと同時には持たない
    if (ids.includes(INBOX_ID)) await ensureInboxFolder(); // 読んだあと書くまでの間に await を挟まない
    const map = await readMap();
    const prev = map[key(tweetId)];
    const b: Bookmark = { accountId: scope, tweetId, folderIds: ids, savedAt: prev?.savedAt ?? Date.now(), snapshot: keepFullText(prev?.snapshot, snapshot) };
    map[key(tweetId)] = b;
    await write(KEY_BOOKMARKS, map);
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
    const map = await readMap();
    const k = bookmarkKey(accountId, tweetId);
    const cur = map[k];
    if (!cur || cur.snapshot.truncated !== true || !full.text) return false;
    const { segments: _s, translated: _tr, ...rest } = cur.snapshot;
    map[k] = { ...cur, snapshot: { ...rest, text: full.text, ...(full.segments ? { segments: full.segments } : {}), ...(full.translated === true ? { translated: true } : {}), truncated: false } };
    await write(KEY_BOOKMARKS, map);
    return true;
  });
}

/** PostShelf から外す (明示的な操作。X 側のブックマークには触らない) */
export function removeBookmark(tweetId: string): Promise<void> {
  return serial(async () => {
    const map = await readMap();
    if (!(key(tweetId) in map)) return;
    delete map[key(tweetId)];
    await write(KEY_BOOKMARKS, map);
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
  const httpsOnly = (v: unknown): v is string => isStr(v) && HTTPS_URL.test(v);
  if (!isStr(q.author) || !isStr(q.handle) || !isStr(q.text) || !Array.isArray(q.media) || (q.createdAt !== undefined && !isStr(q.createdAt)) ||
      (q.url !== undefined && (!isStr(q.url) || !X_URL.test(q.url)))) return undefined;
  const segments = sanitizeSegments(q.segments);
  return {
    author: q.author, handle: q.handle, text: q.text, media: q.media.filter(httpsOnly),
    ...(q.hasVideo === true ? { hasVideo: true, ...(httpsOnly(q.videoPoster) ? { videoPoster: q.videoPoster } : {}) } : {}),
    ...(httpsOnly(q.avatar) ? { avatar: q.avatar } : {}), ...(isStr(q.createdAt) ? { createdAt: q.createdAt } : {}),
    ...(isStr(q.url) ? { url: q.url } : {}), ...(segments ? { segments } : {}), ...(q.translated === true ? { translated: true } : {}),
  };
}

/** 取り込んだ JSON の snapshot の、省略できる項目 (v24) を検証する。不正なら、その項目だけ捨てる (text で表示する) */
function cleanSnapshot(s: Bookmark['snapshot']): Bookmark['snapshot'] {
  const { segments, truncated, avatar, media, quote, translated, ...rest } = s as Bookmark['snapshot'] & { segments?: unknown; truncated?: unknown };
  const seg = segments === undefined ? undefined : sanitizeSegments(segments);
  const clean = cleanQuote(quote);
  // 画像・アバターは https の URL だけ (x.com 以外への勝手な要求や javascript: を通さない)。満たさない要素だけ捨てる
  const httpsOnly = (v: unknown): v is string => isStr(v) && HTTPS_URL.test(v);
  return {
    ...rest,
    media: (media as unknown[]).filter(httpsOnly),
    ...(httpsOnly(avatar) ? { avatar } : {}),
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
    const folders = d.folders.filter(validFolder).map((f) => ({ ...f, accountId: acc(f.accountId) }));
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
    const map = await readMap();
    for (const b of bookmarks) map[bookmarkKey(b.accountId, b.tweetId)] = b;
    const accounts = await read<Record<string, Account>>(KEY_ACCOUNTS, {});
    for (const [k, b] of Object.entries(map)) {
      map[k] = { ...b, folderIds: withAncestors(b.folderIds, accountFolders.get(b.accountId) ?? []) };
    }
    if (!legacy && Array.isArray(d.accounts)) {
      for (const a of d.accounts.filter(validAccount)) {
        const id = accountIdOf(a.id);
        if (id === UNKNOWN_ACCOUNT_ID) continue;
        if (!accounts[id] || accounts[id].lastSeenAt < a.lastSeenAt) accounts[id] = { ...a, id };
      }
    }
    await chrome.storage.local.set({
      [KEY_FOLDERS]: [...curFolders.values()],
      [KEY_BOOKMARKS]: map,
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
  for (const b of Object.values(await readMap())) {
    if (b.accountId !== accountId) continue;
    const { author, handle, avatar, media, hasVideo, hasLink, videoPoster, createdAt, quote } = b.snapshot;
    views.set(b.tweetId, { author, handle, avatar, media, hasVideo, hasLink, videoPoster, createdAt, quote });
  }
  return views;
}

/** 保存済みの欠けた項目だけを補う。既にある値・本文・所属先・時刻は変えず、未保存のものは作らない。変えたポストの件数を返す */
export function fillMissing(items: FillItem[], accountId: string = scope): Promise<number> {
  return serial(async () => {
    const map = await readMap();
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
    if (changed) await write(KEY_BOOKMARKS, map); // 読み込みから書き込みまで別の await を挟まない
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
    const map = await readMap();
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
    await chrome.storage.local.set({
      [KEY_BOOKMARKS]: map,
      ...(nextFolders !== folders ? { [KEY_FOLDERS]: nextFolders } : {}),
    });
    return added;
  });
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

function mutateBookmarks(
  tweetIds: string[],
  fn: (b: Readonly<Bookmark>, folders: readonly Folder[]) => Bookmark | null,
  atomicInbox = false,
): Promise<BookmarkUndo> {
  return serial(async () => {
    // 確定式の一括変更では受け皿も同じ set に含める。map を読む前に準備し、競合する時間を延ばさない。
    const treeFolders = await readAllFolders();
    const mineFolders = treeFolders.filter(mine);
    const allFolders = atomicInbox ? treeFolders : undefined;
    const apply = (map: BookmarkMap): BookmarkUndo => {
      const undo: BookmarkUndo = {};
      for (const tid of new Set(tweetIds)) {
        const k = key(tid);
        const prev = map[k];
        if (!prev) continue;
        // fn は prev とその中身を変更せず、新しい所属を持つオブジェクトを返す。undo は変更前の参照を保つ。
        let next = fn(prev, mineFolders);
        if (next) next = { ...next, folderIds: withAncestors(next.folderIds, mineFolders) };
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
    const hasInbox = (map: BookmarkMap) => Object.values(map).some((b) => inScope(b) && b.folderIds.includes(INBOX_ID));
    let map = await readMap();
    let undo = apply(map);
    if (Object.keys(undo).length === 0) return undo;
    if (allFolders) {
      const needsInbox = hasInbox(map) && !mineFolders.some(f => f.id === INBOX_ID);
      await chrome.storage.local.set({
        [KEY_BOOKMARKS]: map,
        ...(needsInbox ? { [KEY_FOLDERS]: [...allFolders, {
          id: INBOX_ID, name: '', icon: 'ti-star',
          order: mineFolders.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId: scope,
        }] } : {}),
      });
      return undo;
    }
    if (hasInbox(map)) {
      // 「未分類」に入るポストがあれば、受け皿のフォルダ (名前なし = 表示時に解決) を先に用意し、読み直してから書く
      await ensureInboxFolder();
      map = await readMap();
      undo = apply(map);
    }
    await write(KEY_BOOKMARKS, map);
    return undo;
  });
}

const uniq = (a: string[]) => [...new Set(a)];
const realIds = (ids: string[]) => ids.filter((id) => !isBuiltinFolder(id));

/** 一括メニューの確定。追加と解除を同じ書き込み・同じ取り消しにまとめる。 */
export const changeBookmarkFolders = (tweetIds: string[], addIds: string[], removeIds: string[]) =>
  mutateBookmarks(tweetIds, (b, folders) => ({
    ...b,
    folderIds: addIds.includes(INBOX_ID) ? [INBOX_ID]
      : uniq([...withoutDescendants(b.folderIds, removeIds, folders), ...realIds(addIds)]),
  }), true);

export const addToFolders = (tweetIds: string[], folderIds: string[]) =>
  mutateBookmarks(tweetIds, (b) => ({ ...b, folderIds: uniq([...b.folderIds, ...realIds(folderIds)]) }));

/**
 * フォルダから外す。最後のフォルダを外してもポストは消さず「未分類」に移す
 * (ポストを消すのは明示的な deleteBookmarks だけ)。
 */
export const removeFromFolders = (tweetIds: string[], folderIds: string[]) =>
  mutateBookmarks(tweetIds, (b, folders) => {
    const rest = withoutDescendants(b.folderIds, folderIds, folders);
    return { ...b, folderIds: rest.length ? rest : [INBOX_ID] };
  });

/** from から外して to に入れる。from が「すべて」(または未指定) なら追加のみ */
export const moveToFolder = (tweetIds: string[], fromId: string | null, toId: string) =>
  mutateBookmarks(tweetIds, (b, folders) => {
    const rest = fromId && !isBuiltinFolder(fromId) && fromId !== toId ? withoutDescendants(b.folderIds, [fromId], folders) : b.folderIds;
    if (toId === INBOX_ID) return { ...b, folderIds: [INBOX_ID] }; // 行き先が「未分類」なら、ほかのフォルダは外す
    return { ...b, folderIds: uniq([...rest, ...realIds([toId])]) };
  });

/** PostShelf から削除する (X 側のブックマークには触らない) */
export const deleteBookmarks = (tweetIds: string[]) => mutateBookmarks(tweetIds, () => null);

/** BookmarkUndo の内容で変更前の状態に戻す (1 回の書き込み) */
export function restoreBookmarks(undo: BookmarkUndo): Promise<void> {
  return serial(async () => {
    const folders = await readAllFolders();
    const accountFolders = foldersByAccount(folders);
    const map = await readMap();
    for (const [k, prev] of Object.entries(undo)) {
      if (prev) map[k] = { ...prev, folderIds: withAncestors(prev.folderIds, accountFolders.get(prev.accountId) ?? []) };
      else delete map[k];
    }
    await write(KEY_BOOKMARKS, map);
  });
}

/** フォルダの並び順を更新する。orderedIds に無いフォルダは末尾に残す。「すべて」は無視、「未分類」は表示側で常に先頭 */
export function reorderFolders(orderedIds: string[], move?: { id:string; parentId:string | null }): Promise<void> {
  return serial(async () => {
    const folders = await readFolders();
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
    if (move) await writeReparented(next, move.id, oldAncestorIds); else await writeFolders(next);
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

async function accountSummaries(map: BookmarkMap): Promise<AccountSummary[]> {
  const [accounts, folders, last] = await Promise.all([
    read<Record<string, Account>>(KEY_ACCOUNTS, {}),
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
export function assignAccount(from: string, to: string): Promise<{ moved: number; merged: number }> {
  return serial(async () => {
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
    for (const [k, b] of Object.entries(map)) {
      if (b.accountId === to) map[k] = { ...b, folderIds: withAncestors(b.folderIds, [...dest, ...movedFolders]) };
    }
    delete accounts[from];
    await chrome.storage.local.set({
      [KEY_FOLDERS]: [...folders.filter((f) => f.accountId !== from), ...movedFolders],
      [KEY_BOOKMARKS]: map,
      [KEY_ACCOUNTS]: accounts,
    });
    return { moved, merged };
  });
}

/** 1 つのアカウントのフォルダ・ポスト・アカウント情報を削除する (取り消し不可。X 側には触らない) */
export function deleteAccountData(accountId: string): Promise<void> {
  return serial(async () => {
    const [folders, map, accounts] = await Promise.all([readAllFolders(), readMap(), read<Record<string, Account>>(KEY_ACCOUNTS, {})]);
    for (const [k, b] of Object.entries(map)) if (b.accountId === accountId) delete map[k];
    delete accounts[accountId];
    await chrome.storage.local.set({
      [KEY_FOLDERS]: folders.filter((f) => f.accountId !== accountId),
      [KEY_BOOKMARKS]: map,
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
    await chrome.storage.local.set({ [KEY_FOLDERS]: [], [KEY_BOOKMARKS]: {}, [KEY_ACCOUNTS]: {}, [KEY_SCHEMA]: SCHEMA_VERSION, [KEY_REPAIRED]: true });
    await chrome.storage.local.remove?.(KEY_LAST_ACCOUNT);
  });
}

/** ツリーの開閉は端末ごとの設定。呼び出し側は chrome.storage を直接触らず、この 2 つを使う */
export const getCollapsedFolders = async (): Promise<string[]> => (await getSettings()).folderTreeCollapsed ?? [];
export const setCollapsedFolders = async (ids: string[]): Promise<void> => {
  await updateSettings({ folderTreeCollapsed: [...new Set(ids)] });
};
