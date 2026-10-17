// 版: v57-b
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seedBookmarks } from './stored-bookmarks';
import { installChromeMock } from './chrome-mock';
import { getBookmarkOf, listBookmarks, runStorageMigration, setAccountScope } from '../src/shared/storage';

let data: Record<string, any>;
const snapshot = {
  text: '架空の旧データの本文。', author: 'Sample User', handle: '@sample_user', media: [],
  url: 'https://x.com/sample_user/status/1',
};
const bookmark = { accountId: 'me', tweetId: '1', folderIds: ['sample_folder'], savedAt: 1, snapshot };
beforeEach(() => {
  data = installChromeMock();
  data.folders = [];
  seedBookmarks(data, [bookmark]);
  setAccountScope('me');
});
afterEach(() => vi.restoreAllMocks());
const keysRead = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.map(([key]) => key);

it('完了済みの印は初回に 1 回の get でまとめて確認する', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await getBookmarkOf('me', '1')).toEqual(bookmark);
  expect(keysRead(get)).toEqual([['schemaVersion', 'folders', 'bookmarks'], 'bm:me:1']);
});

it('2 回目以降は移行の印を読み直さず必要な保存データだけを読む', async () => {
  await getBookmarkOf('me', '1');
  const get = vi.spyOn(chrome.storage.local, 'get');
  await getBookmarkOf('me', '1');
  await getBookmarkOf('me', '1');
  expect(keysRead(get)).toEqual(['bm:me:1', 'bm:me:1']);
});

it('同時に呼ばれても初回の移行判定を共有する', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  await Promise.all([getBookmarkOf('me', '1'), getBookmarkOf('me', '1')]);
  expect(keysRead(get).filter((key) => Array.isArray(key) && key.includes('schemaVersion'))).toHaveLength(1);
});

it('旧データの移行と空の所属の修復を行い元の本文を維持する', async () => {
  delete data.schemaVersion;
  delete data['bm:me:1'];
  delete data.folderIdsRepaired;
  data.folders = [{ id: 'sample_folder', name: 'Sample Folder', icon: 'ti-folder', order: 0 }];
  const { accountId: _, ...legacy } = bookmark;
  data.bookmarks = { '1': { ...legacy, folderIds: [] } };
  setAccountScope('unknown');
  const get = vi.spyOn(chrome.storage.local, 'get');
  await runStorageMigration();
  expect(await listBookmarks()).toEqual([{ ...legacy, accountId: 'unknown', folderIds: ['inbox'] }]);
  expect(data.schemaVersion).toBe(3);
  expect(data.folderIdsRepaired).toBe(true);
  // 裏方の移行と修復には同じ入力を使う。
  expect(keysRead(get).filter((key) => Array.isArray(key) && key.includes('folderIdsRepaired'))).toHaveLength(1);
  expect(keysRead(get).filter((key) => key === 'bookmarks')).toHaveLength(0);
});

it('判定の読み込みが失敗したら記憶せず再試行する', async () => {
  vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('架空の読み込み失敗'));
  await expect(getBookmarkOf('me', '1')).rejects.toThrow('架空の読み込み失敗');
  expect(await getBookmarkOf('me', '1')).toEqual(bookmark);
});

it('修復の保存が失敗したら次の呼び出しで再試行する', async () => {
  data.schemaVersion = 2;
  data.folderIdsRepaired = false;
  data.bookmarks = { 'me:1': { ...bookmark, folderIds: [] } };
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('架空の修復失敗'));
  await expect(runStorageMigration()).rejects.toThrow('架空の修復失敗');
  expect(data.folderIdsRepaired).toBe(false);
  await runStorageMigration();
  expect((await getBookmarkOf('me', '1'))!.folderIds).toEqual(['inbox']);
  expect(data.folderIdsRepaired).toBe(true);
});

it('旧データの移行の保存が失敗しても完了を記憶せず再試行する', async () => {
  delete data.schemaVersion;
  delete data['bm:me:1'];
  delete data.folderIdsRepaired;
  const { accountId: _, ...legacy } = bookmark;
  data.bookmarks = { '1': legacy };
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('架空の移行失敗'));
  await expect(runStorageMigration()).rejects.toThrow('架空の移行失敗');
  expect(data.schemaVersion).toBeUndefined();
  expect(data.bookmarks).toEqual({ '1': legacy });
  await runStorageMigration();
  expect(await getBookmarkOf('unknown', '1')).toEqual({ ...legacy, accountId: 'unknown' });
});

it('ポストだけの外部削除では移行判定を無効にしない', async () => {
  await getBookmarkOf('me', '1');
  await chrome.storage.local.remove('bm:me:1');
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await getBookmarkOf('me', '1')).toBeUndefined();
  expect(keysRead(get)).toEqual(['bm:me:1']);
});

it('外から全データを消した後の旧データも再判定して移行する', async () => {
  await getBookmarkOf('me', '1');
  await chrome.storage.local.clear();
  const { accountId: _, ...legacy } = bookmark;
  await chrome.storage.local.set({ folders: [], bookmarks: { '1': legacy } });
  await runStorageMigration();
  expect(await getBookmarkOf('unknown', '1')).toEqual({ ...legacy, accountId: 'unknown' });
  expect(data.schemaVersion).toBe(3);
});

it('修復の印の削除ではスキーマ 3 の完了判定を捨てない', async () => {
  await getBookmarkOf('me', '1');
  await chrome.storage.local.remove('folderIdsRepaired');
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await getBookmarkOf('me', '1')).toEqual(bookmark);
  expect(keysRead(get)).toEqual(['bm:me:1']);
});

it('移行判定を読んでいる間の外部削除でも古い完了状態を記憶しない', async () => {
  const get = chrome.storage.local.get;
  let resolve!: () => void;
  const gate = new Promise<void>((done) => { resolve = done; });
  let first = true;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (key: any) => {
    const value = await get(key);
    if (first) {
      first = false;
      await gate;
    }
    return value;
  });
  const read = getBookmarkOf('me', '1');
  await chrome.storage.local.clear();
  resolve();
  await read;
  expect(data.schemaVersion).toBe(3);
  expect(data.folderIdsRepaired).toBe(true);
});
