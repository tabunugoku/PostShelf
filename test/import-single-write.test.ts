// 版: v57-d
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { importData, onDataChanged, setAccountScope } from '../src/shared/storage';

let data: Record<string, any>;
const snapshot = {
  text: '架空の JSON の本文。', author: 'Sample User', handle: '@sample_user', media: [],
  url: 'https://x.com/sample_user/status/1',
};
const incoming = {
  app: 'PostShelf', version: 2,
  accounts: [{ id: 'sample_other', handle: 'sample_other', displayName: 'Sample Other', lastSeenAt: 10 }],
  folders: [{ id: 'sample_new', accountId: 'sample_other', name: 'Sample New', icon: 'ti-folder', order: 0 }],
  bookmarks: [{ accountId: 'sample_other', tweetId: '1', folderIds: ['sample_new'], savedAt: 2, snapshot }],
};
beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, {
    schemaVersion: 2, folderIdsRepaired: true,
    folders: [{ id: 'sample_old', accountId: 'me', name: 'Sample Old', icon: 'ti-folder', order: 0 }],
    bookmarks: { 'me:1': { accountId: 'me', tweetId: '1', folderIds: ['sample_old'], savedAt: 1, snapshot } },
    accounts: { me: { id: 'me', handle: 'me', displayName: 'Sample Me', lastSeenAt: 1 } },
  });
  setAccountScope('me');
});
afterEach(() => vi.restoreAllMocks());

it('JSON の 3 種類の保存データを 1 回の set でまとめて取り込む', async () => {
  const set = vi.spyOn(chrome.storage.local, 'set');
  expect(await importData(incoming)).toBe(1);
  expect(set.mock.calls).toHaveLength(1);
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual(['accounts', 'bookmarks', 'folders']);
  expect(data.folders).toHaveLength(2);
  expect(data.bookmarks['sample_other:1']).toEqual(incoming.bookmarks[0]);
  expect(data.bookmarks['me:1'].snapshot).toEqual(snapshot);
  expect(data.accounts.sample_other).toEqual(incoming.accounts[0]);
});

it('保存が失敗したらフォルダ・ポスト・アカウントのどれも変えない', async () => {
  const before = structuredClone(data);
  const set = chrome.storage.local.set;
  vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    // 旧実装はフォルダを保存した後、2 回目で失敗していた。まとめた set は変更前に失敗する。
    if ('bookmarks' in items) throw new Error('架空の取り込み失敗');
    return set(items);
  });
  await expect(importData(incoming)).rejects.toThrow('架空の取り込み失敗');
  expect(data).toEqual(before);
});

it('変更通知の時点で 3 種類のデータがすべて取り込み済みである', async () => {
  const states: unknown[] = [];
  const off = onDataChanged(() => states.push(structuredClone({
    folders: data.folders, bookmarks: data.bookmarks, accounts: data.accounts,
  })));
  try {
    await importData(incoming);
    expect(states).toEqual([{ folders: data.folders, bookmarks: data.bookmarks, accounts: data.accounts }]);
  } finally {
    off();
  }
});
