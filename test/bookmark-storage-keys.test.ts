// 版: v83
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from '../src/shared/storage';
import type { Bookmark } from '../src/shared/models';
import { installChromeMock } from './chrome-mock';
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';

const snapshot = {
  text: '架空の本文', author: 'Sample', handle: '@sample_author', media: [],
  url: 'https://x.com/sample_author/status/1', truncated: true,
};
const bookmark = (tweetId = '1', accountId = 'sample_a'): Bookmark => ({
  accountId, tweetId, savedAt: 1, folderIds: ['sample_folder'], snapshot,
});
let data: Record<string, unknown>;
beforeEach(async () => {
  data = installChromeMock();
  seedBookmarks(data, [bookmark(), bookmark('1', 'sample_b'), bookmark('2')]);
  data.folders = [{ id: 'sample_folder', accountId: 'sample_a', name: '架空の棚', icon: 'ti-folder', order: 0 }];
  storage.setAccountScope('sample_a');
  await storage.listFolders();
});
afterEach(() => vi.restoreAllMocks());

it('getBookmark は対象の一つのキーだけを読む', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await storage.getBookmark('1')).toEqual(bookmark());
  expect(get).toHaveBeenCalledExactlyOnceWith('bm:sample_a:1');
});

it('保存済み ID は値を読まずキーだけから作る', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  const keys = vi.spyOn(chrome.storage.local, 'getKeys');
  expect(await storage.getSavedIds()).toEqual(new Set(['1', '2']));
  expect(await storage.listAllTweetIds()).toEqual(new Set(['1', '2']));
  expect(get).not.toHaveBeenCalled();
  expect(keys).toHaveBeenCalledTimes(2);
});

it('一覧は現在のアカウントのキーだけを読む', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await storage.listBookmarks()).toEqual([bookmark(), bookmark('2')]);
  expect(get).toHaveBeenCalledExactlyOnceWith(['bm:sample_a:1', 'bm:sample_a:2']);
});

it.each(['save', 'fulltext', 'fill'] as const)('%s は変わったポストのキーだけを書く', async (kind) => {
  const set = vi.spyOn(chrome.storage.local, 'set');
  if (kind === 'save') await storage.setBookmarkFolders('1', ['sample_folder'], { ...snapshot, text: '架空の更新' });
  if (kind === 'fulltext') await storage.refreshFullText('sample_a', '1', { text: '架空の長い本文' });
  if (kind === 'fill') await storage.fillMissing([{ tweetId: '1', snapshot: {
    ...snapshot, avatar: 'https://pbs.twimg.com/profile_images/sample.jpg',
  } }]);
  expect(set).toHaveBeenCalledTimes(1);
  expect(Object.keys(set.mock.calls[0][0])).toEqual(['bm:sample_a:1']);
});

it('未分類の受け皿とポストを一度に書く', async () => {
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.setBookmarkFolders('3', [], snapshot);
  expect(set).toHaveBeenCalledTimes(1);
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual(['bm:sample_a:3', 'folders']);
});

it('空の一括操作は何も書かず、remove に空配列を渡さない', async () => {
  const set = vi.spyOn(chrome.storage.local, 'set');
  const remove = vi.spyOn(chrome.storage.local, 'remove');
  await storage.deleteBookmarks([]);
  await storage.fillMissing([]);
  await storage.addCollected([]);
  await storage.restoreBookmarks({});
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it('未初期化の保存領域でも空配列の操作では初期化を書き込まない', async () => {
  data = installChromeMock();
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.deleteBookmarks([]);
  await storage.fillMissing([]);
  await storage.addCollected([]);
  await storage.restoreBookmarks({});
  expect(set).not.toHaveBeenCalled();
  expect(data).toEqual({});
});

it.each(['one', 'bulk', 'undo', 'assign', 'account', 'all'] as const)(
  '%s の削除では set が remove に先行する', async (operation) => {
    const calls: string[] = [];
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    const remove = chrome.storage.local.remove.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      calls.push('set');
      await set(items);
    });
    vi.spyOn(chrome.storage.local, 'remove').mockImplementation(async (keys) => {
      expect(keys).not.toEqual([]);
      calls.push('remove');
      await remove(keys);
    });
    if (operation === 'one') await storage.removeBookmark('1');
    if (operation === 'bulk') await storage.deleteBookmarks(['1']);
    if (operation === 'undo') await storage.restoreBookmarks({ 'sample_a:1': null });
    if (operation === 'assign') await storage.assignAccount('sample_a', 'sample_b');
    if (operation === 'account') await storage.deleteAccountData('sample_a');
    if (operation === 'all') await storage.deleteAllData();
    expect(calls).toEqual(['set', 'remove']);
    if (operation === 'all') {
      expect(Object.keys(data).filter((key) => key.startsWith('bm:'))).toEqual([]);
      expect(data).not.toHaveProperty('bookmarks');
    }
    if (operation === 'assign') {
      expect(Object.keys(storedBookmarks(data))).toEqual(['sample_b:1', 'sample_b:2']);
    }
  },
);

it('別々の実行環境の同時保存は別のポストを消さない', async () => {
  vi.resetModules();
  const other = await import('../src/shared/storage');
  other.setAccountScope('sample_b');
  await other.listFolders();
  await Promise.all([
    storage.setBookmarkFolders('3', ['sample_folder'], snapshot),
    other.setBookmarkFolders('4', ['sample_folder'], snapshot),
  ]);
  expect(Object.keys(storedBookmarks(data)).sort()).toEqual([
    'sample_a:1', 'sample_a:2', 'sample_a:3', 'sample_b:1', 'sample_b:4',
  ]);
});

it('取り込みは渡された項目だけを読み、既存のポストを書き直さない', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.addCollected([{ tweetId: '1' }, { tweetId: '3', snapshot }], 10);
  expect(get.mock.calls).toEqual([['folders'], [['bm:sample_a:1', 'bm:sample_a:3']]]);
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual(['bm:sample_a:3', 'folders']);
  expect(storedBookmarks(data)['sample_a:1']).toEqual(bookmark());
});

it('取り込みの読み出し後に別画面が保存した同じポストは、読んだ状態に従って扱う', async () => {
  const get = chrome.storage.local.get;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys) => {
    const result = await get(keys);
    if (Array.isArray(keys) && keys.includes('bm:sample_a:1')) {
      data['bm:sample_a:1'] = { ...bookmark(), savedAt: 100 };
    }
    return result;
  });
  const set = vi.spyOn(chrome.storage.local, 'set');
  expect(await storage.addCollected([{ tweetId: '1', snapshot }])).toBe(0);
  expect(set).not.toHaveBeenCalled();
  expect(storedBookmarks(data)['sample_a:1'].savedAt).toBe(100);
});

it('JSON の取り込みは取り込むポストと祖先の所属が変わるポストだけを書く', async () => {
  const folders = [
    { id: 'sample_folder', accountId: 'sample_a', name: '架空の棚', icon: 'ti-folder', order: 0 },
    { id: 'parent', accountId: 'sample_a', name: '架空の親', icon: 'ti-folder', order: 1 },
  ];
  data.folders = folders;
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.importData({
    app: 'PostShelf', version: 2, accounts: [],
    folders: [{ ...folders[0], parentId: 'parent' }],
    bookmarks: [bookmark('3', 'sample_b')],
  });
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual([
    'accounts', 'bm:sample_a:1', 'bm:sample_a:2', 'bm:sample_b:3', 'folders',
  ]);
  expect(storedBookmarks(data)['sample_b:1']).toEqual(bookmark('1', 'sample_b'));
  expect(storedBookmarks(data)['sample_a:1'].folderIds).toEqual(['sample_folder', 'parent']);
});

it('古い bookmarks の削除は通知せず、移行の判定も無効にしない', async () => {
  const changed = vi.fn();
  const stop = storage.onDataChanged(changed);
  data.bookmarks = {};
  await chrome.storage.local.remove('bookmarks');
  expect(changed).not.toHaveBeenCalled();
  const get = vi.spyOn(chrome.storage.local, 'get');
  await storage.getBookmark('1');
  expect(get).toHaveBeenCalledExactlyOnceWith('bm:sample_a:1');
  await chrome.storage.local.set({ 'bm:sample_a:1': bookmark() });
  expect(changed).toHaveBeenCalledTimes(1);
  stop();
});
