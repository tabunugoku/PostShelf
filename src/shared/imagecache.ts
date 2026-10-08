/**
 * 画像キャッシュの記憶装置 (v11-B)。他のコードは chrome.storage / IndexedDB / ファイルを直接触らず、このインターフェース越しに使う。
 *
 * - IdbStore: 専用の IndexedDB (DB 名 postshelf-images)。キーは `tweetId/名前`。メタ (サイズ、保存日、ポスト ID) は別ストア
 * - DirStore: File System Access API で選んだフォルダ。構成は下記 (ハンドルは IndexedDB に保存)
 * - MemoryStore: テスト用の実装
 *
 * フォルダ保存の構成:
 *   選んだフォルダ/.postshelf        この拡張が作ったフォルダの目印 (中身は版番号だけ)
 *   選んだフォルダ/README.txt        説明 (利用者の言語)
 *   選んだフォルダ/images/<ポストID>/N.<拡張子>, video-thumb.<拡張子>, post.json
 * ファイル名・フォルダ名にハンドルは入れない (ポスト ID だけ)。投稿者の情報は post.json だけ。本文は入れない。
 * 書き込みと削除は `images/` の下の、この拡張が作ったものだけ。選んだフォルダの他のファイルには触らない。
 */

export interface CacheMeta {
  tweetId: string;
  /** 'N' (画像の番号) / 'video-thumb'。拡張子は含まない */
  name: string;
  size: number;
  /** この画像を保存した時刻 (ms) */
  savedAt: number;
  type: string;
  /** そのポストを PostShelf に保存した時刻 (ms)。容量の整理で古いポストから消すのに使う */
  postSavedAt: number;
}

/** post.json に書くポストの情報 (本文は入れない) */
export interface PostInfo {
  tweetId: string;
  handle: string;
  displayName?: string;
  url: string;
  /** ms。post.json には ISO 8601 で書く */
  savedAt: number;
}

export interface PutMeta {
  postSavedAt?: number;
  post?: PostInfo;
}

export interface Usage {
  bytes: number;
  files: number;
  posts: number;
}

export interface ImageStore {
  readonly kind: 'idb' | 'dir' | 'memory';
  put(tweetId: string, name: string, blob: Blob, meta?: PutMeta): Promise<void>;
  get(tweetId: string, name: string): Promise<Blob | null>;
  removePost(tweetId: string): Promise<void>;
  usage(): Promise<Usage>;
  list(): Promise<CacheMeta[]>;
  clear(): Promise<void>;
}

export class CacheError extends Error {}
/** フォルダへのアクセス許可が外れている (Chrome の再起動後など) */
export class PermissionNeededError extends CacheError {}
/** 選んだフォルダが PostShelf の作ったフォルダではない (.postshelf が無い) */
export class NotOurFolderError extends CacheError {}

const ID = /^\d{1,32}$/;
const NAME = /^[A-Za-z0-9-]{1,32}$/;
function check(tweetId: string, name?: string): void {
  if (!ID.test(tweetId) || (name !== undefined && !NAME.test(name))) throw new CacheError('invalid key');
}

export const usageOf = (list: CacheMeta[]): Usage => ({
  bytes: list.reduce((n, m) => n + m.size, 0),
  files: list.length,
  posts: new Set(list.map((m) => m.tweetId)).size,
});

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
/** サーバーが返した形式に合わせた拡張子 */
export const extFor = (type: string): string => EXT[type.split(';')[0].trim().toLowerCase()] ?? 'bin';

/** フォルダ保存でのファイルの場所 (ルートからの相対) */
export const imagePath = (tweetId: string, name: string, type: string): string[] => ['images', tweetId, `${name}.${extFor(type)}`];

/** post.json の中身 (本文は入れない。投稿者の情報はここだけ) */
export function postJson(p: PostInfo): { tweetId: string; handle: string; displayName?: string; url: string; savedAt: string } {
  return { tweetId: p.tweetId, handle: p.handle, ...(p.displayName ? { displayName: p.displayName } : {}), url: p.url, savedAt: new Date(p.savedAt).toISOString() };
}

// ---- メモリ実装 (テスト用) ----

export class MemoryStore implements ImageStore {
  readonly kind = 'memory' as const;
  private blobs = new Map<string, { blob: Blob; meta: CacheMeta }>();
  async put(tweetId: string, name: string, blob: Blob, meta: PutMeta = {}): Promise<void> {
    check(tweetId, name);
    this.blobs.set(`${tweetId}/${name}`, { blob, meta: { tweetId, name, size: blob.size, type: blob.type, savedAt: Date.now(), postSavedAt: meta.postSavedAt ?? Date.now() } });
  }
  async get(tweetId: string, name: string): Promise<Blob | null> {
    return this.blobs.get(`${tweetId}/${name}`)?.blob ?? null;
  }
  async removePost(tweetId: string): Promise<void> {
    for (const k of [...this.blobs.keys()]) if (k.startsWith(`${tweetId}/`)) this.blobs.delete(k);
  }
  async list(): Promise<CacheMeta[]> {
    return [...this.blobs.values()].map((v) => v.meta);
  }
  async usage(): Promise<Usage> {
    return usageOf(await this.list());
  }
  async clear(): Promise<void> {
    this.blobs.clear();
  }
}

// ---- IndexedDB ----

const DB_NAME = 'postshelf-images';
const S_BLOBS = 'blobs';
const S_META = 'meta';
const S_DIRMETA = 'dirmeta';
const S_HANDLES = 'handles';

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((ok, ng) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((ok, ng) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => ng(tx.error);
    tx.onabort = () => ng(tx.error);
  });

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  const r = factory.open(DB_NAME, 1);
  r.onupgradeneeded = () => {
    for (const s of [S_BLOBS, S_META, S_DIRMETA, S_HANDLES]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
  };
  return req(r);
}

/** Blob を ArrayBuffer にする (Blob.arrayBuffer が無い環境では FileReader)。IndexedDB には {buf, type} で入れる = どの環境でも同じ動き */
function blobToBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((ok, ng) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result as ArrayBuffer);
    fr.onerror = () => ng(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

export class IdbStore implements ImageStore {
  readonly kind = 'idb' as const;
  private db?: Promise<IDBDatabase>;
  constructor(private factory?: IDBFactory) {}
  private open() {
    return (this.db ??= openDb(this.factory));
  }
  async put(tweetId: string, name: string, blob: Blob, meta: PutMeta = {}): Promise<void> {
    check(tweetId, name);
    const db = await this.open();
    const m: CacheMeta = { tweetId, name, size: blob.size, type: blob.type, savedAt: Date.now(), postSavedAt: meta.postSavedAt ?? Date.now() };
    const buf = await blobToBuffer(blob);
    const tx = db.transaction([S_BLOBS, S_META], 'readwrite');
    tx.objectStore(S_BLOBS).put({ buf, type: blob.type }, `${tweetId}/${name}`);
    tx.objectStore(S_META).put(m, `${tweetId}/${name}`);
    await done(tx);
  }
  async get(tweetId: string, name: string): Promise<Blob | null> {
    const db = await this.open();
    const v = (await req(db.transaction(S_BLOBS).objectStore(S_BLOBS).get(`${tweetId}/${name}`))) as { buf: ArrayBuffer; type: string } | undefined;
    return v ? new Blob([v.buf], { type: v.type }) : null;
  }
  async removePost(tweetId: string): Promise<void> {
    const db = await this.open();
    const range = IDBKeyRange.bound(`${tweetId}/`, `${tweetId}/￿`);
    const tx = db.transaction([S_BLOBS, S_META], 'readwrite');
    tx.objectStore(S_BLOBS).delete(range);
    tx.objectStore(S_META).delete(range);
    await done(tx);
  }
  async list(): Promise<CacheMeta[]> {
    const db = await this.open();
    return (await req(db.transaction(S_META).objectStore(S_META).getAll())) as CacheMeta[];
  }
  async usage(): Promise<Usage> {
    return usageOf(await this.list());
  }
  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([S_BLOBS, S_META], 'readwrite');
    tx.objectStore(S_BLOBS).clear();
    tx.objectStore(S_META).clear();
    await done(tx);
  }
}

// ---- フォルダ (File System Access API) ----

/** 使う部分だけの構造的な型 (テストでは偽のハンドルを渡す) */
export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}
export interface DirHandleLike {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, DirHandleLike | FileHandleLike]>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export const MARKER = '.postshelf';
export const README = 'README.txt';
const MARKER_VERSION = '1';

/** フォルダ保存のメタ (サイズ・ポスト ID など)。拡張機能側に持ち、「再スキャン」でフォルダの中身から作り直す */
export interface MetaIndex {
  all(): Promise<CacheMeta[]>;
  set(m: CacheMeta): Promise<void>;
  removePost(tweetId: string): Promise<void>;
  replaceAll(list: CacheMeta[]): Promise<void>;
}

export class MemoryIndex implements MetaIndex {
  private m = new Map<string, CacheMeta>();
  async all() {
    return [...this.m.values()];
  }
  async set(m: CacheMeta) {
    this.m.set(`${m.tweetId}/${m.name}`, m);
  }
  async removePost(id: string) {
    for (const k of [...this.m.keys()]) if (k.startsWith(`${id}/`)) this.m.delete(k);
  }
  async replaceAll(list: CacheMeta[]) {
    this.m = new Map(list.map((x) => [`${x.tweetId}/${x.name}`, x]));
  }
}

export class IdbIndex implements MetaIndex {
  private db?: Promise<IDBDatabase>;
  constructor(private factory?: IDBFactory) {}
  private open() {
    return (this.db ??= openDb(this.factory));
  }
  async all() {
    return (await req((await this.open()).transaction(S_DIRMETA).objectStore(S_DIRMETA).getAll())) as CacheMeta[];
  }
  async set(m: CacheMeta) {
    const tx = (await this.open()).transaction(S_DIRMETA, 'readwrite');
    tx.objectStore(S_DIRMETA).put(m, `${m.tweetId}/${m.name}`);
    await done(tx);
  }
  async removePost(id: string) {
    const tx = (await this.open()).transaction(S_DIRMETA, 'readwrite');
    tx.objectStore(S_DIRMETA).delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
    await done(tx);
  }
  async replaceAll(list: CacheMeta[]) {
    const tx = (await this.open()).transaction(S_DIRMETA, 'readwrite');
    const s = tx.objectStore(S_DIRMETA);
    s.clear();
    for (const m of list) s.put(m, `${m.tweetId}/${m.name}`);
    await done(tx);
  }
}

/** 選んだフォルダのハンドルの保存先。既定は IndexedDB (別の画面・background からも使える)。テストでは差し替える */
export interface HandleStorage {
  save(h: DirHandleLike): Promise<void>;
  load(): Promise<DirHandleLike | null>;
}
const idbHandles: HandleStorage = {
  async save(h) {
    const tx = (await openDb()).transaction(S_HANDLES, 'readwrite');
    tx.objectStore(S_HANDLES).put(h, 'dir');
    await done(tx);
  },
  async load() {
    return ((await req((await openDb()).transaction(S_HANDLES).objectStore(S_HANDLES).get('dir'))) as DirHandleLike | undefined) ?? null;
  },
};
let handles: HandleStorage = idbHandles;
/** テスト用: 偽のハンドルは IndexedDB の構造化複製でメソッドを失うので、メモリに保存する実装へ差し替える。null で既定に戻す */
export const setHandleStorage = (h: HandleStorage | null): void => {
  handles = h ?? idbHandles;
};
export const saveDirHandle = (h: DirHandleLike): Promise<void> => handles.save(h);
export const loadDirHandle = (): Promise<DirHandleLike | null> => handles.load();

export type DirPermission = 'granted' | 'prompt' | 'denied';
export async function dirPermission(h: DirHandleLike): Promise<DirPermission> {
  return (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
}
/** ユーザーのクリックの中で呼ぶ */
export async function requestDirPermission(h: DirHandleLike): Promise<boolean> {
  return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

async function tryGetDir(parent: DirHandleLike, name: string): Promise<DirHandleLike | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}
async function tryGetFile(parent: DirHandleLike, name: string): Promise<FileHandleLike | null> {
  try {
    return await parent.getFileHandle(name);
  } catch {
    return null;
  }
}
async function writeFile(dir: DirHandleLike, name: string, data: Blob | string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(data);
  await w.close();
}
const baseName = (file: string) => file.replace(/\.[^.]+$/, '');

export const hasMarker = async (root: DirHandleLike): Promise<boolean> => (await tryGetFile(root, MARKER)) !== null;

async function isEmpty(root: DirHandleLike): Promise<boolean> {
  for await (const _ of root.entries()) return false;
  return true;
}

/**
 * 選んだフォルダを使えるようにする。.postshelf があればそのまま。
 * 無くて空ならそのまま作る。空でないときは confirmNonEmpty の答えが true のときだけ作る (false なら NotOurFolderError)。
 * 作るのは .postshelf と README.txt だけ。
 */
export async function prepareDirectory(root: DirHandleLike, readmeText: string, confirmNonEmpty: () => Promise<boolean>): Promise<void> {
  if (await hasMarker(root)) return;
  if (!(await isEmpty(root)) && !(await confirmNonEmpty())) throw new NotOurFolderError('not an empty folder');
  await writeFile(root, MARKER, MARKER_VERSION);
  if (!(await tryGetFile(root, README))) await writeFile(root, README, readmeText);
}

export class DirStore implements ImageStore {
  readonly kind = 'dir' as const;
  constructor(private root: DirHandleLike, private index: MetaIndex = new MemoryIndex()) {}

  /** 許可が外れていれば PermissionNeededError、.postshelf が無ければ NotOurFolderError */
  private async ready(): Promise<void> {
    if ((await dirPermission(this.root)) !== 'granted') throw new PermissionNeededError('permission needed');
    if (!(await hasMarker(this.root))) throw new NotOurFolderError('no marker');
  }

  async put(tweetId: string, name: string, blob: Blob, meta: PutMeta = {}): Promise<void> {
    check(tweetId, name);
    await this.ready();
    const images = await this.root.getDirectoryHandle('images', { create: true });
    const post = await images.getDirectoryHandle(tweetId, { create: true });
    // 同じ名前で拡張子が違う古いファイル (画質を切り替えたときなど) は消してから書く = 1 枚につき 1 ファイル
    const file = `${name}.${extFor(blob.type)}`;
    for await (const [n, h] of post.entries()) if (h.kind === 'file' && n !== file && baseName(n) === name) await post.removeEntry(n);
    await writeFile(post, file, blob);
    if (meta.post) await writeFile(post, 'post.json', JSON.stringify(postJson(meta.post), null, 2));
    await this.index.set({ tweetId, name, size: blob.size, type: blob.type, savedAt: Date.now(), postSavedAt: meta.postSavedAt ?? meta.post?.savedAt ?? Date.now() });
  }

  async get(tweetId: string, name: string): Promise<Blob | null> {
    check(tweetId, name);
    await this.ready();
    const images = await tryGetDir(this.root, 'images');
    const post = images && (await tryGetDir(images, tweetId));
    if (!post) return null;
    for await (const [n, h] of post.entries()) if (h.kind === 'file' && n !== 'post.json' && baseName(n) === name) return (h as FileHandleLike).getFile();
    return null;
  }

  async removePost(tweetId: string): Promise<void> {
    check(tweetId);
    await this.ready();
    const images = await tryGetDir(this.root, 'images');
    if (images && (await tryGetDir(images, tweetId))) await images.removeEntry(tweetId, { recursive: true });
    await this.index.removePost(tweetId);
  }

  async list(): Promise<CacheMeta[]> {
    return this.index.all();
  }
  async usage(): Promise<Usage> {
    return usageOf(await this.list());
  }

  /** images/ の下だけを消す。.postshelf・README.txt・選んだフォルダの他のファイルは残す */
  async clear(): Promise<void> {
    await this.ready();
    if (await tryGetDir(this.root, 'images')) await this.root.removeEntry('images', { recursive: true });
    await this.index.replaceAll([]);
  }

  /** フォルダの中を数え直し、メタを作り直す。ポスト ID はフォルダ名から読む。戻り値は数えた画像の数 */
  async rescan(): Promise<number> {
    await this.ready();
    const prev = new Map((await this.index.all()).map((m) => [`${m.tweetId}/${m.name}`, m]));
    const out: CacheMeta[] = [];
    const images = await tryGetDir(this.root, 'images');
    if (images) {
      for await (const [id, dir] of images.entries()) {
        if (dir.kind !== 'directory' || !ID.test(id)) continue;
        for await (const [n, h] of (dir as DirHandleLike).entries()) {
          if (h.kind !== 'file' || n === 'post.json') continue;
          const name = baseName(n);
          if (!NAME.test(name)) continue;
          const f = await (h as FileHandleLike).getFile();
          out.push({ tweetId: id, name, size: f.size, type: f.type, savedAt: f.lastModified, postSavedAt: prev.get(`${id}/${name}`)?.postSavedAt ?? f.lastModified });
        }
      }
    }
    await this.index.replaceAll(out);
    return out.length;
  }
}
