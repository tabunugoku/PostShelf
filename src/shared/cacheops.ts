/**
 * 画像キャッシュの方針 (どの画像を、いつ、どれだけ残すか)。記憶装置そのものは imagecache.ts。
 * 通信は画像の取得 (pbs.twimg.com) だけ。X の非公開 API は呼ばない。取得した画像はこの PC の中にだけ置く。
 */
import {
  DirStore,
  IdbIndex,
  IdbStore,
  PermissionNeededError,
  NotOurFolderError,
  dirPermission,
  loadDirHandle,
  type DirHandleLike,
  type ImageStore,
  type PostInfo,
} from './imagecache';
import { withImageSize } from './media';
import type { Bookmark, Snapshot } from './models';
import {
  MAX_FETCH_FAILURES,
  clearCacheFailure,
  getCacheFailures,
  getSettings,
  recordCacheFailure,
  resetCacheFailures,
  setCacheCleanupNeeded,
  type ImageCacheSettings,
} from './settings';
import { deleteAccountData, deleteAllData, getAccountScope, getBookmark, listAllBookmarks, setAccountScope } from './storage';
import { hasImagePermission } from './permissions';

export interface CacheDeps {
  fetch: typeof fetch;
  delay: (ms: number) => Promise<void>;
}
export const defaultDeps: CacheDeps = { fetch: (...a) => fetch(...a), delay: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** 画像を 1 枚取得する。画像でない応答・エラー応答は例外 */
export async function fetchImageBlob(url: string, f: typeof fetch = defaultDeps.fetch): Promise<Blob> {
  const res = await f(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('not an image');
  return blob;
}

export interface Target {
  /** キャッシュ上の名前 ('1', '2', … / 'video-thumb') */
  name: string;
  url: string;
}

/** ポストのキャッシュ対象: 画像は画質の設定に合わせた URL、動画はサムネイルだけ */
export function targetsOf(snapshot: Snapshot, quality: ImageCacheSettings['quality']): Target[] {
  const out: Target[] = snapshot.media.map((u, i) => ({ name: String(i + 1), url: withImageSize(u, quality) }));
  if (snapshot.videoPoster) out.push({ name: 'video-thumb', url: snapshot.videoPoster });
  return out;
}

export const postInfoOf = (b: Bookmark): PostInfo => ({ tweetId: b.tweetId, handle: b.snapshot.handle, displayName: b.snapshot.author, url: b.snapshot.url, savedAt: b.savedAt });

// ---- 記憶装置を開く ----

export type StoreStatus = 'ok' | 'unsupported' | 'no-folder' | 'needs-permission';
export interface OpenedStore {
  status: StoreStatus;
  store: ImageStore | null;
  /** dir のとき: 選んだフォルダ (許可が必要なときも返す。「許可する」ボタンで使う) */
  handle?: DirHandleLike | null;
}

export async function openStore(backend: ImageCacheSettings['backend']): Promise<OpenedStore> {
  if (typeof indexedDB === 'undefined') return { status: 'unsupported', store: null };
  if (backend === 'idb') return { status: 'ok', store: new IdbStore() };
  const handle = await loadDirHandle();
  if (!handle) return { status: 'no-folder', store: null, handle: null };
  if ((await dirPermission(handle)) !== 'granted') return { status: 'needs-permission', store: null, handle };
  return { status: 'ok', store: new DirStore(handle, new IdbIndex()), handle };
}

// ---- 容量 ----

interface PostEntry {
  tweetId: string;
  bytes: number;
  postSavedAt: number;
}

async function postsOldestFirst(store: ImageStore): Promise<{ posts: PostEntry[]; total: number }> {
  const byPost = new Map<string, PostEntry>();
  for (const m of await store.list()) {
    const e = byPost.get(m.tweetId) ?? { tweetId: m.tweetId, bytes: 0, postSavedAt: m.postSavedAt };
    e.bytes += m.size;
    e.postSavedAt = Math.min(e.postSavedAt, m.postSavedAt);
    byPost.set(m.tweetId, e);
  }
  const posts = [...byPost.values()].sort((a, b) => a.postSavedAt - b.postSavedAt);
  return { posts, total: posts.reduce((n, p) => n + p.bytes, 0) };
}

/** 保存日が古いポストの画像から消して、合計を limit 以下にする (keep のポストは消さない)。消したポストの数を返す */
export async function evictToFit(store: ImageStore, limit: number, keep?: string): Promise<number> {
  const { posts, total } = await postsOldestFirst(store);
  let bytes = total;
  let removed = 0;
  for (const p of posts) {
    if (bytes <= limit) break;
    if (p.tweetId === keep) continue;
    await store.removePost(p.tweetId);
    bytes -= p.bytes;
    removed++;
  }
  return removed;
}

/** 最大容量を newMax に下げたとき、消えるポストの数 (確認ダイアログ用。まだ消さない) */
export async function previewEviction(store: ImageStore, newMax: number): Promise<number> {
  const { posts, total } = await postsOldestFirst(store);
  let bytes = total;
  let n = 0;
  for (const p of posts) {
    if (bytes <= newMax) break;
    bytes -= p.bytes;
    n++;
  }
  return n;
}

/** size バイトを足せるか。足りなければ onFull に従う (evict: 古いものから消す / stop: false) */
export async function ensureRoom(store: ImageStore, cfg: ImageCacheSettings, size: number, keep?: string): Promise<boolean> {
  const { bytes } = await store.usage();
  if (bytes + size <= cfg.maxBytes) return true;
  if (cfg.onFull === 'stop') return false;
  await evictToFit(store, cfg.maxBytes - size, keep);
  return (await store.usage()).bytes + size <= cfg.maxBytes;
}

// ---- キャッシュする ----

export interface CacheResult {
  cached: number;
  failed: number;
  skipped: number;
  /** 容量がいっぱいで保存できなかった (onFull: stop など) */
  full: boolean;
  /** フォルダの許可が無い / PostShelf のフォルダではないので書き込みを保留した */
  blocked: boolean;
}

/** まだキャッシュに無く、失敗が上限に達していない対象 */
export async function missingTargets(store: ImageStore, b: Bookmark, cfg: ImageCacheSettings, have?: Set<string>, failures?: Record<string, number>): Promise<Target[]> {
  const h = have ?? new Set((await store.list()).map((m) => `${m.tweetId}/${m.name}`));
  const f = failures ?? (await getCacheFailures());
  return targetsOf(b.snapshot, cfg.quality).filter((t) => !h.has(`${b.tweetId}/${t.name}`) && (f[`${b.tweetId}/${t.name}`] ?? 0) < MAX_FETCH_FAILURES);
}

async function cacheOne(store: ImageStore, cfg: ImageCacheSettings, b: Bookmark, t: Target, deps: CacheDeps, r: CacheResult): Promise<'stop' | 'next'> {
  const key = `${b.tweetId}/${t.name}`;
  let blob: Blob;
  try {
    blob = await fetchImageBlob(t.url, deps.fetch);
  } catch {
    await recordCacheFailure(key); // 失敗は記録して次の機会に再試行 (3 回失敗したら再試行を止める)
    r.failed++;
    return 'next';
  }
  try {
    if (!(await ensureRoom(store, cfg, blob.size, b.tweetId))) {
      r.full = true;
      return 'stop';
    }
    await store.put(b.tweetId, t.name, blob, { postSavedAt: b.savedAt, post: postInfoOf(b) });
    await clearCacheFailure(key);
    r.cached++;
  } catch (e) {
    if (e instanceof PermissionNeededError || e instanceof NotOurFolderError) {
      r.blocked = true; // 書き込みを保留。失敗には数えない
      return 'stop';
    }
    await recordCacheFailure(key);
    r.failed++;
  }
  return 'next';
}

/** 1 ポスト分をキャッシュする (ポストを保存したとき)。キャッシュがオフなら呼び出し側が呼ばない */
export async function cachePost(store: ImageStore, cfg: ImageCacheSettings, b: Bookmark, deps: CacheDeps = defaultDeps): Promise<CacheResult> {
  const r: CacheResult = { cached: 0, failed: 0, skipped: 0, full: false, blocked: false };
  const all = targetsOf(b.snapshot, cfg.quality);
  const todo = await missingTargets(store, b, cfg);
  r.skipped = all.length - todo.length;
  for (const t of todo) if ((await cacheOne(store, cfg, b, t, deps, r)) === 'stop') break;
  return r;
}

export interface Progress {
  done: number;
  total: number;
}

/**
 * 保存済みのポストの未キャッシュの画像を、1 枚ずつ順に取得する。間隔を空ける (既定 300 ms)。いつでも中止できる。
 * 中断しても、キャッシュに入った分は残るので、次に呼ぶと続きから (未キャッシュのものだけ) 始まる。
 */
export async function cacheMissing(
  store: ImageStore,
  cfg: ImageCacheSettings,
  bookmarks: Bookmark[],
  opts: { signal?: { aborted: boolean }; onProgress?: (p: Progress) => void; delayMs?: number; deps?: CacheDeps } = {},
): Promise<Progress & CacheResult & { aborted: boolean }> {
  const deps = opts.deps ?? defaultDeps;
  const have = new Set((await store.list()).map((m) => `${m.tweetId}/${m.name}`));
  const failures = await getCacheFailures();
  const plan: { b: Bookmark; t: Target }[] = [];
  for (const b of [...bookmarks].sort((x, y) => y.savedAt - x.savedAt)) for (const t of await missingTargets(store, b, cfg, have, failures)) plan.push({ b, t });
  const r: CacheResult = { cached: 0, failed: 0, skipped: 0, full: false, blocked: false };
  let done = 0;
  opts.onProgress?.({ done, total: plan.length });
  let aborted = false;
  for (const { b, t } of plan) {
    if (opts.signal?.aborted) {
      aborted = true;
      break;
    }
    const res = await cacheOne(store, cfg, b, t, deps, r);
    done++;
    opts.onProgress?.({ done, total: plan.length });
    if (res === 'stop') break;
    if (done < plan.length) await deps.delay(opts.delayMs ?? 300);
  }
  return { ...r, done, total: plan.length, aborted };
}

// ---- 掃除 ----

/** どのアカウントにも保存されていないポストの画像を消す。消したポストの数を返す */
export async function pruneOrphans(store: ImageStore, live: Set<string>): Promise<number> {
  const ids = new Set((await store.list()).map((m) => m.tweetId));
  let n = 0;
  for (const id of ids) {
    if (live.has(id)) continue;
    await store.removePost(id);
    n++;
  }
  return n;
}

/**
 * ポスト / アカウントのデータを削除したあとに呼ぶ。対応する画像を消す。
 * 失敗 (フォルダの許可が無い、など) してもポストの削除は成功のまま。後で整理が必要なことを記録して、設定画面に表示する。
 */
export async function afterPostsRemoved(): Promise<boolean> {
  try {
    const s = await getSettings();
    const live = new Set((await listAllBookmarks()).map((b) => b.tweetId));
    let ok = true;
    for (const backend of ['idb', 'dir'] as const) {
      const opened = await openStore(backend);
      if (opened.status === 'unsupported') continue;
      if (!opened.store) {
        // 使っている保存先に届かないときだけ「整理が必要」。使っていない保存先は気にしない
        if (backend === s.imageCache.backend && opened.status === 'needs-permission') ok = false;
        continue;
      }
      await pruneOrphans(opened.store, live);
    }
    await setCacheCleanupNeeded(!ok);
    return ok;
  } catch {
    await setCacheCleanupNeeded(true).catch(() => {});
    return false;
  }
}

/** 両方の保存先のキャッシュを空にする (届かない保存先は飛ばす)。すべて成功したら true */
export async function clearAllCaches(): Promise<boolean> {
  let ok = true;
  for (const backend of ['idb', 'dir'] as const) {
    try {
      const opened = await openStore(backend);
      if (opened.store) await opened.store.clear();
      else if (opened.status === 'needs-permission') ok = false;
    } catch {
      ok = false;
    }
  }
  await resetCacheFailures().catch(() => {});
  await setCacheCleanupNeeded(!ok).catch(() => {});
  return ok;
}

/** 「すべてのデータを削除」: データとキャッシュの両方を消す。キャッシュが消せなくてもデータの削除は成功。キャッシュが消えたかを返す */
export async function deleteAllDataAndCache(): Promise<boolean> {
  await deleteAllData();
  return clearAllCaches();
}

/** アカウントのデータを削除し、どのアカウントにも無くなったポストの画像を消す */
export async function deleteAccountDataAndCache(accountId: string): Promise<boolean> {
  await deleteAccountData(accountId);
  return afterPostsRemoved();
}

// ---- 保存のきっかけ (background から) ----

/** ポストを保存したとき: キャッシュがオンで権限があれば、そのポストの画像を取得して保存する */
export async function cachePostById(tweetId: string, accountId: string, deps: CacheDeps = defaultDeps): Promise<CacheResult | null> {
  const s = await getSettings();
  if (!s.imageCache.enabled || !(await hasImagePermission())) return null;
  const prev = getAccountScope();
  setAccountScope(accountId);
  try {
    const b = await getBookmark(tweetId);
    if (!b) return null;
    const { store } = await openStore(s.imageCache.backend);
    return store ? await cachePost(store, s.imageCache, b, deps) : null;
  } finally {
    setAccountScope(prev);
  }
}

// ---- 保存先の切り替え ----

/** from の画像を to へコピーし、終わったら from を空にする (移す)。進捗を通知する */
export async function migrateStore(from: ImageStore, to: ImageStore, onProgress?: (p: Progress) => void): Promise<void> {
  const list = await from.list();
  const info = new Map((await listAllBookmarks()).map((b) => [b.tweetId, postInfoOf(b)]));
  let done = 0;
  onProgress?.({ done, total: list.length });
  for (const m of list) {
    const blob = await from.get(m.tweetId, m.name);
    if (blob) await to.put(m.tweetId, m.name, blob, { postSavedAt: m.postSavedAt, post: info.get(m.tweetId) });
    onProgress?.({ done: ++done, total: list.length });
  }
  await from.clear();
}
