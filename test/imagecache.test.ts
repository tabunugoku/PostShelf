import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FakeDir } from './fake-fs';
import {
  DirStore,
  IdbIndex,
  IdbStore,
  MARKER,
  MemoryIndex,
  MemoryStore,
  NotOurFolderError,
  PermissionNeededError,
  extFor,
  imagePath,
  postJson,
  prepareDirectory,
  saveDirHandle,
  loadDirHandle,
  setHandleStorage,
  type ImageStore,
} from '../src/shared/imagecache';
import {
  afterPostsRemoved,
  cacheMissing,
  cachePost,
  cachePostById,
  clearAllCaches,
  deleteAccountDataAndCache,
  deleteAllDataAndCache,
  ensureRoom,
  evictToFit,
  migrateStore,
  openStore,
  previewEviction,
  pruneOrphans,
  targetsOf,
  type CacheDeps,
} from '../src/shared/cacheops';
import { DEFAULT_IMAGE_CACHE, MB, MAX_FETCH_FAILURES, getCacheCleanupNeeded, getCacheFailures, getSettings, resetSettings, updateImageCache, type ImageCacheSettings } from '../src/shared/settings';
import { createFolder, listBookmarks, noteAccount, setAccountScope, setBookmarkFolders, addCollected } from '../src/shared/storage';
import type { Bookmark } from '../src/shared/models';

const blob = (n: number, type = 'image/jpeg') => new Blob([new Uint8Array(n)], { type });
const readText = (b: Blob) =>
  new Promise<string>((ok, ng) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => ng(fr.error);
    fr.readAsText(b);
  });
const img = (n: string) => `https://pbs.twimg.com/media/${n}?format=jpg&name=small`;
const cfg = (over: Partial<ImageCacheSettings> = {}): ImageCacheSettings => ({ ...DEFAULT_IMAGE_CACHE, enabled: true, ...over });
const bm = (id: string, media: string[], savedAt = 1000, extra: Partial<Bookmark['snapshot']> = {}): Bookmark => ({
  accountId: 'me',
  tweetId: id,
  folderIds: ['inbox'],
  savedAt,
  snapshot: { text: 'SECRET BODY', author: 'Display Name', handle: '@someone', media, url: `https://x.com/someone/status/${id}`, ...extra },
});

/** 取得先の偽物。url ごとの応答を決められる */
function fakeDeps(table: Record<string, number | 'fail' | 'html'> = {}, sizeDefault = 100): CacheDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    delay: async () => {},
    fetch: (async (url: string) => {
      calls.push(url);
      const v = table[url] ?? sizeDefault;
      if (v === 'fail') return { ok: false, status: 404, blob: async () => blob(0) };
      if (v === 'html') return { ok: true, status: 200, blob: async () => blob(10, 'text/html') };
      return { ok: true, status: 200, blob: async () => blob(v as number) };
    }) as unknown as typeof fetch,
  };
}

beforeEach(async () => {
  installChromeMock();
  (globalThis as any).indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  setAccountScope('me');
  let kept: any = null; // フォルダのハンドルはメモリに保存する (偽物は IndexedDB の複製でメソッドを失うため)
  setHandleStorage({ save: async (h) => void (kept = h), load: async () => kept });
});

/** 3 つの実装で同じ契約を確かめる */
const impls: [string, () => Promise<{ store: ImageStore; dir?: FakeDir }>][] = [
  ['memory', async () => ({ store: new MemoryStore() })],
  ['idb', async () => ({ store: new IdbStore() })],
  ['dir (fake handle)', async () => {
    const dir = new FakeDir('D');
    await prepareDirectory(dir, 'readme', async () => true);
    return { store: new DirStore(dir, new MemoryIndex()), dir };
  }],
];

describe.each(impls)('ImageStore contract: %s', (_name, make) => {
  it('put / get / usage / list / removePost / clear', async () => {
    const { store } = await make();
    await store.put('100', '1', blob(300, 'image/jpeg'), { postSavedAt: 5, post: { tweetId: '100', handle: '@a', url: 'u', savedAt: 5 } });
    await store.put('100', '2', blob(200, 'image/png'), { postSavedAt: 5 });
    await store.put('200', 'video-thumb', blob(50, 'image/jpeg'), { postSavedAt: 9 });
    expect((await store.get('100', '1'))!.size).toBe(300);
    expect((await store.get('100', '2'))!.type).toBe('image/png');
    expect(await store.get('100', '3')).toBeNull();
    expect(await store.get('999', '1')).toBeNull();
    expect(await store.usage()).toEqual({ bytes: 550, files: 3, posts: 2 });
    const list = await store.list();
    expect(list.map((m) => `${m.tweetId}/${m.name}`).sort()).toEqual(['100/1', '100/2', '200/video-thumb']);
    expect(list.find((m) => m.name === '1')).toMatchObject({ size: 300, postSavedAt: 5, type: 'image/jpeg' });
    await store.removePost('100');
    expect(await store.usage()).toEqual({ bytes: 50, files: 1, posts: 1 });
    expect(await store.get('100', '1')).toBeNull();
    await store.clear();
    expect(await store.usage()).toEqual({ bytes: 0, files: 0, posts: 0 });
  });

  it('overwrites the same name (e.g. after changing the quality)', async () => {
    const { store } = await make();
    await store.put('100', '1', blob(100));
    await store.put('100', '1', blob(400));
    expect((await store.get('100', '1'))!.size).toBe(400);
    expect((await store.usage()).files).toBe(1);
  });

  it('rejects keys that could escape the layout', async () => {
    const { store } = await make();
    await expect(store.put('../x', '1', blob(1))).rejects.toThrow();
    await expect(store.put('100', '../1', blob(1))).rejects.toThrow();
  });
});

describe('IdbStore keeps the real bytes and the dedicated DB name', () => {
  it('round-trips the content and lives in the postshelf-images database', async () => {
    const s = new IdbStore();
    await s.put('1', '1', new Blob(['hello'], { type: 'image/png' }));
    expect(await readText((await s.get('1', '1'))!)).toBe('hello');
    const dbs = await (indexedDB as any).databases();
    expect(dbs.map((d: any) => d.name)).toContain('postshelf-images');
  });
});

describe('folder layout (docs: images/<ポストID>/N.ext, post.json, .postshelf, README.txt)', () => {
  it('builds paths from the post id and the server format; no handle in names', () => {
    expect(imagePath('123', '1', 'image/jpeg')).toEqual(['images', '123', '1.jpg']);
    expect(imagePath('123', '2', 'image/png')).toEqual(['images', '123', '2.png']);
    expect(imagePath('123', 'video-thumb', 'image/webp')).toEqual(['images', '123', 'video-thumb.webp']);
    expect(extFor('image/jpeg; charset=x')).toBe('jpg');
    expect(extFor('application/octet-stream')).toBe('bin');
  });

  it('post.json has id, handle, display name, url and ISO savedAt — and never the text', () => {
    const j = postJson({ tweetId: '5', handle: '@someone', displayName: 'Display Name', url: 'https://x.com/someone/status/5', savedAt: Date.UTC(2026, 9, 6, 1, 2, 3) });
    expect(j).toEqual({ tweetId: '5', handle: '@someone', displayName: 'Display Name', url: 'https://x.com/someone/status/5', savedAt: '2026-10-06T01:02:03.000Z' });
    expect(JSON.stringify(j)).not.toContain('text');
  });

  it('writes .postshelf, README.txt and images/<id>/{N.ext, video-thumb.ext, post.json} only', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'これは README', async () => true);
    const store = new DirStore(root, new MemoryIndex());
    const b = bm('123', [img('A'), img('B')], 777, { videoPoster: 'https://pbs.twimg.com/amplify_video_thumb/1/img/t.jpg?name=small' });
    await cachePost(store, cfg(), b, fakeDeps({}, 100));
    expect(root.paths()).toEqual(['.postshelf', 'README.txt', 'images/123/1.bin'.replace('.bin', '.jpg'), 'images/123/2.jpg', 'images/123/post.json', 'images/123/video-thumb.jpg'].sort());
    const pj = JSON.parse(await readText(root.read('images/123/post.json')));
    expect(pj).toEqual({ tweetId: '123', handle: '@someone', displayName: 'Display Name', url: 'https://x.com/someone/status/123', savedAt: new Date(777).toISOString() });
    expect(JSON.stringify(root.paths())).not.toContain('someone'); // ハンドルはフォルダ名・ファイル名に入れない
    expect(await readText(root.read('README.txt'))).toBe('これは README');
    expect(await readText(root.read(MARKER))).toBe('1');
  });

  it('refuses to write into a folder without .postshelf', async () => {
    const root = new FakeDir('foreign');
    root.put('mine/doc.txt');
    const store = new DirStore(root, new MemoryIndex());
    await expect(store.put('1', '1', blob(10))).rejects.toBeInstanceOf(NotOurFolderError);
    expect(root.paths()).toEqual(['mine/doc.txt']);
  });

  it('a non-empty folder without a marker asks first; declining leaves it untouched, accepting creates only the marker and README', async () => {
    const root = new FakeDir('foreign');
    root.put('photos/a.jpg');
    root.put('notes.txt');
    const confirm = vi.fn(async () => false);
    await expect(prepareDirectory(root, 'r', confirm)).rejects.toBeInstanceOf(NotOurFolderError);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(root.paths()).toEqual(['notes.txt', 'photos/a.jpg']);
    await prepareDirectory(root, 'r', async () => true);
    expect(root.paths()).toEqual(['.postshelf', 'README.txt', 'notes.txt', 'photos/a.jpg']);
    // 目印があれば、確認なしでそのまま使える
    const again = vi.fn(async () => false);
    await prepareDirectory(root, 'r', again);
    expect(again).not.toHaveBeenCalled();
  });

  it('an empty folder needs no confirmation', async () => {
    const confirm = vi.fn(async () => false);
    const root = new FakeDir();
    await prepareDirectory(root, 'r', confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(root.paths()).toEqual(['.postshelf', 'README.txt']);
  });

  it('delete and clear touch only images/ — other files in the chosen folder survive', async () => {
    const root = new FakeDir('chosen');
    root.put('my-own-file.txt', 'keep');
    root.put('docs/report.pdf', 'keep');
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root, new MemoryIndex());
    await store.put('1', '1', blob(10));
    await store.put('2', '1', blob(10));
    root.put('images/1/foreign.txt', 'user put this here'); // 万一ユーザーが入れていても (images の下) 他は壊さない
    await store.removePost('2');
    expect(root.paths()).toContain('my-own-file.txt');
    expect(root.paths().filter((p) => p.startsWith('images/2'))).toEqual([]);
    await store.clear();
    expect(root.paths()).toEqual(['.postshelf', 'README.txt', 'docs/report.pdf', 'my-own-file.txt']);
  });

  it('keeps one file per image: a different format replaces the old file', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root, new MemoryIndex());
    await store.put('1', '1', blob(10, 'image/jpeg'));
    await store.put('1', '1', blob(20, 'image/png'));
    expect(root.paths().filter((p) => p.startsWith('images/1/'))).toEqual(['images/1/1.png']);
  });

  it('writes nothing while permission is missing (and reads fail the same way); granting resumes', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root, new MemoryIndex());
    root.permission = 'prompt';
    await expect(store.put('1', '1', blob(10))).rejects.toBeInstanceOf(PermissionNeededError);
    expect(root.paths()).toEqual(['.postshelf', 'README.txt']);
    root.permission = 'granted';
    await store.put('1', '1', blob(10));
    expect(root.paths()).toContain('images/1/1.jpg');
  });

  it('rescan rebuilds size and post id from the folder (post id from the folder name)', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root, new MemoryIndex());
    root.put('images/555/1.jpg', blob(123));
    root.put('images/555/video-thumb.png', blob(45));
    root.put('images/555/post.json', '{}');
    root.put('images/not-an-id/1.jpg', blob(9));
    expect(await store.usage()).toEqual({ bytes: 0, files: 0, posts: 0 });
    expect(await store.rescan()).toBe(2);
    expect(await store.usage()).toEqual({ bytes: 168, files: 2, posts: 1 });
    expect((await store.list()).every((m) => m.tweetId === '555')).toBe(true);
    expect((await store.get('555', '1'))!.size).toBe(123);
  });

  it('the folder handle is saved in IndexedDB and loaded back', async () => {
    const root = new FakeDir('chosen');
    await saveDirHandle(root);
    expect((await loadDirHandle())!.name).toBe('chosen');
    expect(await new IdbIndex().all()).toEqual([]);
  });
});

describe('targets and quality', () => {
  it('images follow the quality setting; video keeps only the thumbnail', () => {
    const s = bm('1', [img('A')], 1, { hasVideo: true, videoPoster: 'https://pbs.twimg.com/amplify_video_thumb/1/img/t.jpg?name=small' }).snapshot;
    expect(targetsOf(s, 'large').map((t) => [t.name, t.url])).toEqual([
      ['1', 'https://pbs.twimg.com/media/A?format=jpg&name=large'],
      ['video-thumb', 'https://pbs.twimg.com/amplify_video_thumb/1/img/t.jpg?name=small'],
    ]);
    expect(targetsOf(s, 'orig')[0].url).toContain('name=orig');
  });
});

describe('capacity', () => {
  const fill = async (store: ImageStore) => {
    await store.put('1', '1', blob(400), { postSavedAt: 100 });
    await store.put('2', '1', blob(400), { postSavedAt: 300 });
    await store.put('3', '1', blob(400), { postSavedAt: 200 });
  };
  it('evict removes the posts with the oldest saved date first', async () => {
    const store = new MemoryStore();
    await fill(store);
    expect(await evictToFit(store, 800)).toBe(1);
    expect((await store.list()).map((m) => m.tweetId).sort()).toEqual(['2', '3']); // 保存日が最も古い 1 が消える
    expect(await evictToFit(store, 400)).toBe(1);
    expect((await store.list()).map((m) => m.tweetId)).toEqual(['2']);
  });

  it('ensureRoom: evict makes room (never the post being cached); stop refuses', async () => {
    const a = new MemoryStore();
    await fill(a);
    expect(await ensureRoom(a, cfg({ maxBytes: 1300, onFull: 'evict' }), 400)).toBe(true);
    expect((await a.list()).map((m) => m.tweetId).sort()).toEqual(['2', '3']);
    const b = new MemoryStore();
    await fill(b);
    expect(await ensureRoom(b, cfg({ maxBytes: 1300, onFull: 'stop' }), 400)).toBe(false);
    expect((await b.usage()).files).toBe(3); // 何も消さない
    const c = new MemoryStore();
    expect(await ensureRoom(c, cfg({ maxBytes: 100, onFull: 'evict' }), 400)).toBe(false); // 1 枚が上限より大きい
  });

  it('caching with onFull=evict deletes old posts to make room; onFull=stop saves nothing new', async () => {
    const limit = 250;
    const s1 = new MemoryStore();
    await cachePost(s1, cfg({ maxBytes: limit }), bm('10', [img('A')], 1), fakeDeps({}, 100));
    await cachePost(s1, cfg({ maxBytes: limit }), bm('11', [img('B')], 2), fakeDeps({}, 100));
    const r = await cachePost(s1, cfg({ maxBytes: limit }), bm('12', [img('C'), img('D')], 3), fakeDeps({}, 100));
    expect(r.cached).toBe(2);
    expect((await s1.list()).map((m) => m.tweetId).sort()).toEqual(['12', '12']); // 古い 10, 11 は整理された (12 自身は残る)
    const s2 = new MemoryStore();
    await cachePost(s2, cfg({ maxBytes: limit, onFull: 'stop' }), bm('10', [img('A'), img('B')], 1), fakeDeps({}, 100));
    const r2 = await cachePost(s2, cfg({ maxBytes: limit, onFull: 'stop' }), bm('11', [img('C')], 2), fakeDeps({}, 100));
    expect(r2.full).toBe(true);
    expect(r2.cached).toBe(0);
    expect((await s2.list()).map((m) => m.tweetId)).toEqual(['10', '10']);
  });

  it('lowering the maximum: previewEviction reports the count first, then the oldest are removed', async () => {
    const store = new MemoryStore();
    await fill(store);
    expect(await previewEviction(store, 1200)).toBe(0);
    expect(await previewEviction(store, 800)).toBe(1);
    expect(await previewEviction(store, 100)).toBe(3);
    expect((await store.usage()).files).toBe(3); // preview では消えない
  });
});

describe('failures: retried later, given up after 3', () => {
  it('records failures per image, succeeds on a later try, and stops at the limit', async () => {
    const store = new MemoryStore();
    const b = bm('20', [img('A'), img('B')]);
    const urlA = 'https://pbs.twimg.com/media/A?format=jpg&name=large';
    const deps = fakeDeps({ [urlA]: 'fail' });
    const r1 = await cachePost(store, cfg(), b, deps);
    expect(r1).toMatchObject({ cached: 1, failed: 1 });
    expect((await getCacheFailures())['20/1']).toBe(1);
    await cachePost(store, cfg(), b, deps);
    await cachePost(store, cfg(), b, deps);
    expect((await getCacheFailures())['20/1']).toBe(MAX_FETCH_FAILURES);
    const before = deps.calls.length;
    await cachePost(store, cfg(), b, deps);
    expect(deps.calls.length).toBe(before); // 3 回失敗したら再試行を止める: もう取得しない
    // 別の画像は影響を受けず、成功した画像の記録は消える
    const ok = fakeDeps();
    await cachePost(store, cfg(), bm('21', [img('Z')]), ok);
    expect((await getCacheFailures())['21/1']).toBeUndefined();
  });

  it('a non-image response counts as a failure', async () => {
    const store = new MemoryStore();
    const r = await cachePost(store, cfg(), bm('22', [img('H')]), fakeDeps({ 'https://pbs.twimg.com/media/H?format=jpg&name=large': 'html' }));
    expect(r).toMatchObject({ cached: 0, failed: 1 });
    expect((await store.usage()).files).toBe(0);
  });

  it('a failure then success clears the record (retry works on the next chance)', async () => {
    const store = new MemoryStore();
    const b = bm('23', [img('A')]);
    await cachePost(store, cfg(), b, fakeDeps({ 'https://pbs.twimg.com/media/A?format=jpg&name=large': 'fail' }));
    expect((await getCacheFailures())['23/1']).toBe(1);
    await cachePost(store, cfg(), b, fakeDeps());
    expect((await getCacheFailures())['23/1']).toBeUndefined();
    expect((await store.usage()).files).toBe(1);
  });
});

describe('bulk caching: progress, stop, resume', () => {
  const posts = () => [bm('31', [img('A'), img('B')], 3), bm('32', [img('C')], 2), bm('33', [img('D'), img('E')], 1)];
  it('fetches one at a time in order (newest first) with the delay between images, reporting progress', async () => {
    const store = new MemoryStore();
    const delays: number[] = [];
    const deps = { ...fakeDeps(), delay: async (ms: number) => void delays.push(ms) };
    const progress: string[] = [];
    const r = await cacheMissing(store, cfg(), posts(), { deps, onProgress: (p) => progress.push(`${p.done}/${p.total}`) });
    expect(r).toMatchObject({ done: 5, total: 5, cached: 5, aborted: false });
    expect(progress).toEqual(['0/5', '1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(delays).toEqual([300, 300, 300, 300]); // 間隔 (目安 300 ms)
  });

  it('can be stopped at any time, and the next run continues from where it left off (only the missing ones)', async () => {
    const store = new MemoryStore();
    const signal = { aborted: false };
    const deps = fakeDeps();
    const first = await cacheMissing(store, cfg(), posts(), { deps, signal, onProgress: (p) => void (p.done === 2 && (signal.aborted = true)) });
    expect(first).toMatchObject({ done: 2, total: 5, aborted: true });
    expect((await store.usage()).files).toBe(2);
    const second = await cacheMissing(store, cfg(), posts(), { deps });
    expect(second).toMatchObject({ total: 3, done: 3, cached: 3, aborted: false });
    expect((await store.usage()).files).toBe(5);
    expect(new Set(deps.calls).size).toBe(5); // 同じ画像を取り直していない
    const third = await cacheMissing(store, cfg(), posts(), { deps });
    expect(third.total).toBe(0);
  });

  it('stops when the destination is blocked (permission) without counting failures', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root, new MemoryIndex());
    root.permission = 'prompt';
    const r = await cacheMissing(store, cfg({ backend: 'dir' }), posts(), { deps: fakeDeps() });
    expect(r.blocked).toBe(true);
    expect(await getCacheFailures()).toEqual({});
    expect(root.paths()).toEqual(['.postshelf', 'README.txt']);
  });
});

describe('deleting posts / accounts / everything also deletes images', () => {
  const seed = async () => {
    await noteAccount({ handle: 'me' });
    await noteAccount({ handle: 'you' });
    setAccountScope('me');
    const f = await createFolder({ name: 'F' });
    await setBookmarkFolders('1', [f.id], bm('1', [img('A')]).snapshot);
    await setBookmarkFolders('2', [f.id], bm('2', [img('B')]).snapshot);
    setAccountScope('you');
    await addCollected([{ tweetId: '2', snapshot: bm('2', [img('B')]).snapshot }]); // 同じポストを別アカウントでも保存
    setAccountScope('me');
    const store = new IdbStore();
    for (const id of ['1', '2']) await store.put(id, '1', blob(10), { postSavedAt: 1 });
    return store;
  };

  it('afterPostsRemoved removes images of posts that no account has any more (but keeps shared ones)', async () => {
    const store = await seed();
    const { deleteBookmarks } = await import('../src/shared/storage');
    await deleteBookmarks(['1', '2']); // me の分を削除。2 は you がまだ持っている
    expect(await afterPostsRemoved()).toBe(true);
    expect((await store.list()).map((m) => m.tweetId)).toEqual(['2']);
  });

  it('deleting an account removes its posts and their images', async () => {
    const store = await seed();
    await deleteAccountDataAndCache('me');
    expect((await store.list()).map((m) => m.tweetId)).toEqual(['2']); // you が持つ 2 は残る
    await deleteAccountDataAndCache('you');
    expect(await store.list()).toEqual([]);
  });

  it('"delete all data" clears the cache too (both back ends) and settings are kept', async () => {
    const store = await seed();
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    const dir = new DirStore(root, new IdbIndex());
    await dir.put('1', '1', blob(10));
    await updateImageCache({ enabled: true, backend: 'idb', quality: 'orig' });
    expect(await deleteAllDataAndCache()).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await dir.list()).toEqual([]);
    expect(root.paths()).toEqual(['.postshelf', 'README.txt']);
    expect(await listBookmarks()).toEqual([]);
    expect((await getSettings()).imageCache).toMatchObject({ enabled: true, quality: 'orig' });
  });

  it('when the cache side cannot be deleted (no folder permission), the post deletion still succeeds and a cleanup is flagged', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await updateImageCache({ enabled: true, backend: 'dir' });
    const dir = new DirStore(root, new IdbIndex());
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    await addCollected([{ tweetId: '7', snapshot: bm('7', [img('A')]).snapshot }]);
    await dir.put('7', '1', blob(10));
    root.permission = 'prompt'; // Chrome の再起動後など
    await deleteAccountDataAndCache('me');
    expect(await listBookmarks()).toEqual([]); // ポストの削除は成功
    expect(await getCacheCleanupNeeded()).toBe(true); // 後で整理が必要
    expect(root.paths()).toContain('images/7/1.jpg'); // 画像は残っている
    root.permission = 'granted';
    expect(await afterPostsRemoved()).toBe(true);
    expect(await getCacheCleanupNeeded()).toBe(false);
    expect(root.paths().filter((p) => p.startsWith('images/7'))).toEqual([]);
  });

  it('clearAllCaches reports failure instead of throwing when a folder cannot be reached', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    root.permission = 'prompt';
    expect(await clearAllCaches()).toBe(false);
  });
});

describe('settings: image cache', () => {
  it('defaults: off, idb, 1 GB, large, evict; invalid values fall back; reset includes the cache settings', async () => {
    expect((await getSettings()).imageCache).toEqual({ enabled: false, backend: 'idb', maxBytes: 1024 * MB, quality: 'large', onFull: 'evict' });
    await updateImageCache({ enabled: true, backend: 'dir', maxBytes: 5 * 1024 * MB, quality: 'orig', onFull: 'stop' });
    expect((await getSettings()).imageCache).toEqual({ enabled: true, backend: 'dir', maxBytes: 5 * 1024 * MB, quality: 'orig', onFull: 'stop' });
    await updateImageCache({ maxBytes: 10 * MB }); // 100 MB 未満は受け付けない
    expect((await getSettings()).imageCache.maxBytes).toBe(1024 * MB);
    await updateImageCache({ maxBytes: 100 * MB });
    expect((await getSettings()).imageCache.maxBytes).toBe(100 * MB);
    await resetSettings();
    expect((await getSettings()).imageCache).toEqual(DEFAULT_IMAGE_CACHE);
  });
});

describe('save-time caching (background)', () => {
  const grant = (v: boolean) => ((globalThis as any).chrome.permissions = { contains: async () => v, request: async () => v });
  it('does nothing while off, or without the optional permission; caches when on and granted', async () => {
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    await addCollected([{ tweetId: '40', snapshot: bm('40', [img('A')]).snapshot }]);
    const deps = fakeDeps();
    grant(true);
    expect(await cachePostById('40', 'me', deps)).toBeNull(); // オフ
    await updateImageCache({ enabled: true });
    grant(false);
    expect(await cachePostById('40', 'me', deps)).toBeNull(); // 権限なし
    expect(deps.calls).toEqual([]);
    grant(true);
    expect(await cachePostById('40', 'me', deps)).toMatchObject({ cached: 1 });
    expect(deps.calls).toEqual(['https://pbs.twimg.com/media/A?format=jpg&name=large']);
    const { store } = await openStore('idb');
    expect((await store!.list()).map((m) => m.tweetId)).toEqual(['40']);
    expect(await cachePostById('999', 'me', deps)).toBeNull(); // 保存されていないポスト
  });
});

describe('switching the back end', () => {
  it('migrateStore copies everything (with progress) and empties the source', async () => {
    const from = new IdbStore();
    await from.put('1', '1', blob(10), { postSavedAt: 5 });
    await from.put('2', '1', blob(20), { postSavedAt: 6 });
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    const to = new DirStore(root, new MemoryIndex());
    const steps: string[] = [];
    await migrateStore(from, to, (p) => steps.push(`${p.done}/${p.total}`));
    expect(steps).toEqual(['0/2', '1/2', '2/2']);
    expect((await to.usage()).bytes).toBe(30);
    expect((await to.list()).find((m) => m.tweetId === '2')!.postSavedAt).toBe(6);
    expect(await from.list()).toEqual([]);
  });

  it('openStore reports why a folder cannot be used (no folder / needs permission / ok)', async () => {
    expect((await openStore('dir')).status).toBe('no-folder');
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    expect((await openStore('dir')).status).toBe('ok');
    root.permission = 'prompt';
    const o = await openStore('dir');
    expect(o.status).toBe('needs-permission');
    expect(o.store).toBeNull();
    expect(o.handle).toBeTruthy();
  });
});

describe('permissions in the manifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8'));
  it('the required permissions are unchanged; the image server is optional only', () => {
    expect(manifest.permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel']);
    expect(manifest.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://pbs.twimg.com/*']);
    expect(manifest.optional_permissions).toBeUndefined();
  });
});
