import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { addCollected, setAccountScope } from '../src/shared/storage';

let data: Record<string, any>;
const snapshot = {
  text: '架空の取り込み本文。', author: 'Sample User', handle: '@sample_user', media: [],
  url: 'https://x.com/sample_user/status/1',
};
beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, { schemaVersion: 2, folderIdsRepaired: true, folders: [], bookmarks: {} });
  setAccountScope('me');
});
afterEach(() => vi.restoreAllMocks());

it('受け皿がなくても取り込みは全件を 1 回だけ読んで保存する', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await addCollected([{ tweetId: '1', snapshot }], 1000)).toBe(1);
  expect((get.mock.calls as unknown as [string][]).filter(([key]) => key === 'bookmarks')).toHaveLength(1);
  expect(data.bookmarks['me:1']).toEqual({
    accountId: 'me', tweetId: '1', savedAt: 1000, folderIds: ['inbox'], snapshot,
  });
  expect(data.folders).toEqual([{ id: 'inbox', name: '', icon: 'ti-star', order: 0, accountId: 'me' }]);
});

it('取り込む新規ポストがなければ受け皿も保存データも書き換えない', async () => {
  const set = vi.spyOn(chrome.storage.local, 'set');
  expect(await addCollected([{ tweetId: '1' }])).toBe(0);
  expect(set).not.toHaveBeenCalled();
  expect(data.folders).toEqual([]);
});

it('直列化した取り込みは先に保存したポストを失わず重複を数えない', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  expect(await Promise.all([
    addCollected([{ tweetId: '1', snapshot }], 1000),
    addCollected([{ tweetId: '1', snapshot }, { tweetId: '2', snapshot }], 2000),
  ])).toEqual([1, 1]);
  expect((get.mock.calls as unknown as [string][]).filter(([key]) => key === 'bookmarks')).toHaveLength(2);
  expect(Object.keys(data.bookmarks)).toEqual(['me:1', 'me:2']);
  expect(data.bookmarks['me:1'].savedAt).toBe(1000);
  expect(data.bookmarks['me:2'].savedAt).toBeLessThan(1000);
});
