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
} from './models';
import { t } from './strings';
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
let repairing: Promise<void> | undefined;

/** どの公開関数も最初に呼ぶ。schemaVersion が古ければ (1 回だけ) 移行し、所属フォルダの不整合を (1 回だけ) 直す。失敗時は何も書き込まず例外 */
async function ensureMigrated(): Promise<void> {
  if ((await read<number>(KEY_SCHEMA, 0)) < SCHEMA_VERSION) {
    migrating ??= (async () => {
      const [folders, bookmarks] = await Promise.all([read<unknown>(KEY_FOLDERS, []), read<unknown>(KEY_BOOKMARKS, {})]);
      const out = migrateToV2({ folders, bookmarks }); // 検証に失敗したらここで例外 = 書き込みなし
      await chrome.storage.local.set({ [KEY_FOLDERS]: out.folders, [KEY_BOOKMARKS]: out.bookmarks, [KEY_SCHEMA]: SCHEMA_VERSION }); // 1 回の書き込み
    })().finally(() => {
      migrating = undefined;
    });
    await migrating;
  }
  if (await read<boolean>(KEY_REPAIRED, false)) return;
  repairing ??= repairFolderIds().finally(() => {
    repairing = undefined;
  });
  await repairing;
}

/**
 * 所属フォルダが空のポストと、「未分類」と他のフォルダが同時に付いているポストを、1 回だけ直す (v18)。
 * 直し方は normalizeFolderIds と同じ。ポストの件数、tweetId、savedAt、snapshot は変えない (変わったら何も書かず例外)。
 * 直す対象が 0 件なら、書き込まずに印 (folderIdsRepaired) だけを付ける。
 */
export async function repairFolderIds(): Promise<void> {
  const [raw, rawFolders] = await Promise.all([read<unknown>(KEY_BOOKMARKS, {}), read<unknown>(KEY_FOLDERS, [])]);
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

export function createFolder(input: {
  name: string;
  icon?: string;
  color?: string;
}): Promise<Folder> {
  return serial(async () => {
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
  });
}

export function updateFolder(
  id: string,
  patch: { name?: string; icon?: string; color?: string | null },
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
    folders[idx] = next;
    await writeFolders(folders);
    return next;
  });
}

/** フォルダを削除し、ブックマークからも folderId を外す (ポスト自体は残す。所属が空になるポストは「未分類」へ移す) */
export function deleteFolder(id: string): Promise<void> {
  return serial(async () => {
    if (isBuiltinFolder(id)) throw new StorageError(t('errBuiltinImmutable'));
    if (!(await readFolders()).some((f) => f.id === id)) throw new StorageError(t('errNotFound'));
    const without = (b: Bookmark) => normalizeFolderIds(b.folderIds.filter((x) => x !== id));
    const toInbox = (m: BookmarkMap) => Object.values(m).some((b) => inScope(b) && without(b).includes(INBOX_ID));
    if (toInbox(await readMap())) await ensureInboxFolder(); // 読んだあと書くまでの間に await を挟まないよう、先に用意する
    const folders = await readFolders();
    const map = await readMap();
    for (const b of Object.values(map)) if (inScope(b)) b.folderIds = without(b);
    await writeFolders(folders.filter((f) => f.id !== id));
    await write(KEY_BOOKMARKS, map);
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
  const folders = all.filter((f) => f.accountId === accountId);
  if (folders.some((f) => f.id === INBOX_ID)) return;
  const others = all.filter((f) => f.accountId !== accountId);
  await write(KEY_FOLDERS, [...others, ...folders, { id: INBOX_ID, name: '', icon: 'ti-star', order: folders.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId }]);
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
    const ids = normalizeFolderIds(folderIds); // 「未分類」は他のフォルダと同時には持たない
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
  const http = (v: unknown): v is string => isStr(v) && /^https?:\/\//i.test(v);
  if (!isStr(q.author) || !isStr(q.handle) || !isStr(q.text) || !Array.isArray(q.media) || !q.media.every(http) ||
      (q.avatar !== undefined && !http(q.avatar)) || (q.createdAt !== undefined && !isStr(q.createdAt)) ||
      (q.url !== undefined && (!isStr(q.url) || !X_URL.test(q.url)))) return undefined;
  const segments = sanitizeSegments(q.segments);
  return {
    author: q.author, handle: q.handle, text: q.text, media: q.media,
    ...(q.avatar !== undefined ? { avatar: q.avatar } : {}), ...(isStr(q.createdAt) ? { createdAt: q.createdAt } : {}),
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
    // 「未分類」に入るポストがあるアカウントには、受け皿のフォルダを用意する
    for (const b of bookmarks) {
      if (!b.folderIds.includes(INBOX_ID) || curFolders.has(bookmarkKey(b.accountId, INBOX_ID))) continue;
      const mineF = [...curFolders.values()].filter((f) => (f.accountId ?? UNKNOWN_ACCOUNT_ID) === b.accountId);
      curFolders.set(bookmarkKey(b.accountId, INBOX_ID), { id: INBOX_ID, name: '', icon: 'ti-star', order: mineF.reduce((m, f) => Math.max(m, f.order), -1) + 1, accountId: b.accountId });
    }
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
    if (plan(await readMap()).fresh.length === 0) return 0;
    await ensureInboxFolder(accountId); // 読んだあと書くまでの間に await を挟まないよう、先に用意して読み直す
    const map = await readMap();
    const { order, fresh } = plan(map);
    if (fresh.length === 0) return 0;
    let added = 0;
    for (const it of fresh) {
      if (map[keyOf(it.tweetId)]) continue;
      map[keyOf(it.tweetId)] = { accountId, tweetId: it.tweetId, folderIds: [INBOX_ID], savedAt: order.get(it.tweetId)!, snapshot: it.snapshot! };
      added++;
    }
    await write(KEY_BOOKMARKS, map);
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
  fn: (b: Bookmark) => Bookmark | null,
): Promise<BookmarkUndo> {
  return serial(async () => {
    const apply = (map: BookmarkMap): BookmarkUndo => {
      const undo: BookmarkUndo = {};
      for (const tid of new Set(tweetIds)) {
        const k = key(tid);
        const prev = map[k];
        if (!prev) continue;
        let next = fn(structuredClone(prev));
        if (next) next = { ...next, folderIds: normalizeFolderIds(next.folderIds) }; // 「未分類」は他のフォルダと同時には持たない
        if (JSON.stringify(next) === JSON.stringify(prev)) continue;
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
    if (toId === INBOX_ID) return { ...b, folderIds: [INBOX_ID] }; // 行き先が「未分類」なら、ほかのフォルダは外す
    return { ...b, folderIds: uniq([...rest, ...realIds([toId])]) };
  });

/** PostShelf から削除する (X 側のブックマークには触らない) */
export const deleteBookmarks = (tweetIds: string[]) => mutateBookmarks(tweetIds, () => null);

/** BookmarkUndo の内容で変更前の状態に戻す (1 回の書き込み) */
export function restoreBookmarks(undo: BookmarkUndo): Promise<void> {
  return serial(async () => {
    const map = await readMap();
    for (const [k, prev] of Object.entries(undo)) {
      if (prev) map[k] = prev;
      else delete map[k];
    }
    await write(KEY_BOOKMARKS, map);
  });
}

/** フォルダの並び順を更新する。orderedIds に無いフォルダは末尾に残す。「すべて」は無視、「未分類」は表示側で常に先頭 */
export function reorderFolders(orderedIds: string[]): Promise<void> {
  return serial(async () => {
    const folders = await readFolders();
    const rank = new Map(realIds(orderedIds).map((id, i) => [id, i]));
    const sorted = [...folders].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.order - b.order);
    await writeFolders(sorted.map((f, i) => ({ ...f, order: i })));
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
      avatar: input.avatar ?? prev?.avatar,
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
