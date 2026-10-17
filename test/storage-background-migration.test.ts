// 版: v83
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from '../src/shared/storage';
import type { Bookmark } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { storedBookmarks } from './stored-bookmarks';

const bookmark = (tweetId = '1', accountId = 'sample_a'): Bookmark => ({
  accountId, tweetId, savedAt: Number(tweetId), folderIds: ['sample_folder'],
  snapshot: {
    text: '架空の本文 ' + tweetId, author: 'Sample', handle: '@sample_author', media: [],
    url: 'https://x.com/sample_author/status/' + tweetId,
  },
});
let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock();
  installPanelMock();
  Object.assign(data, { schemaVersion: 2, folderIdsRepaired: true, folders: [], bookmarks: {
    'sample_a:1': bookmark(),
  } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('2 アカウント 5000 件を移し、書き出しの内容を保つ', async () => {
  const list = ['sample_a', 'sample_b'].flatMap((accountId) => Array.from({ length: 2500 }, (_, index) =>
    bookmark(String(index + 1), accountId)));
  data.bookmarks = Object.fromEntries(list.map((b) => [b.accountId + ':' + b.tweetId, b]));
  data.accounts = Object.fromEntries(['sample_a', 'sample_b'].map((id) => [id, { id, handle: id, lastSeenAt: 1 }]));
  const before = structuredClone(storedBookmarks(data));
  const expected = { app: 'PostShelf', version: 2, accounts: Object.values(data.accounts), folders: [], bookmarks: list };
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.runStorageMigration();
  expect(storedBookmarks(data)).toEqual(before);
  expect(data).not.toHaveProperty('bookmarks');
  expect(data.schemaVersion).toBe(3);
  expect(set).toHaveBeenCalledTimes(1);
  const { exportedAt: _, ...dump } = await storage.exportData();
  expect(dump).toEqual(expected);
});

it('スキーマ 1 の所属も修復して一度で 3 にする', async () => {
  delete data.schemaVersion;
  delete data.folderIdsRepaired;
  const { accountId: _, ...legacy } = bookmark();
  data.bookmarks = { '1': { ...legacy, folderIds: [] } };
  await storage.runStorageMigration();
  expect(storedBookmarks(data)).toEqual({ 'unknown:1': { ...legacy, accountId: 'unknown', folderIds: ['inbox'] } });
  expect(data.schemaVersion).toBe(3);
  expect(data.folders).toContainEqual({ id: 'inbox', accountId: 'unknown', name: '', icon: 'ti-star', order: 0 });
});

it('並行した移行を一つにまとめ、完了後は書き直さない', async () => {
  const set = vi.spyOn(chrome.storage.local, 'set');
  const first = storage.runStorageMigration();
  expect(storage.runStorageMigration()).toBe(first);
  await first;
  expect(set).toHaveBeenCalledTimes(1);
  set.mockClear();
  const remove = vi.spyOn(chrome.storage.local, 'remove');
  await storage.runStorageMigration();
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it.each(['count', 'key', 'content'])('変換結果の %s の不一致では何も書かない', async (kind) => {
  const fromEntries = Object.fromEntries;
  vi.spyOn(Object, 'fromEntries').mockImplementation((entries) => {
    const result = fromEntries(entries);
    if ('bm:sample_a:1' in result) {
      if (kind === 'count') delete result['bm:sample_a:1'];
      if (kind === 'key') {
        result['bm:sample_a:2'] = result['bm:sample_a:1'];
        delete result['bm:sample_a:1'];
      }
      if (kind === 'content') result['bm:sample_a:1'] = { ...bookmark(), savedAt: -1 };
    }
    return result;
  });
  const set = vi.spyOn(chrome.storage.local, 'set');
  const remove = vi.spyOn(chrome.storage.local, 'remove');
  await expect(storage.runStorageMigration()).rejects.toBeInstanceOf(storage.StorageError);
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it('読み直しで不一致なら旧キーを残す', async () => {
  const get = chrome.storage.local.get;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys) => {
    const result = await get(keys);
    if (Array.isArray(keys) && keys.includes('bm:sample_a:1')) return {};
    return result;
  });
  const remove = vi.spyOn(chrome.storage.local, 'remove');
  await expect(storage.runStorageMigration()).rejects.toBeInstanceOf(storage.StorageError);
  expect(remove).not.toHaveBeenCalled();
  expect(data.bookmarks).toEqual({ 'sample_a:1': bookmark() });
});

it('set の後で停止しても次の起動で重複だけを片付ける', async () => {
  vi.spyOn(chrome.storage.local, 'remove').mockRejectedValueOnce(new Error('架空の停止'));
  await expect(storage.runStorageMigration()).rejects.toThrow('架空の停止');
  const before = structuredClone(data['bm:sample_a:1']);
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.runStorageMigration();
  expect(set).not.toHaveBeenCalled();
  expect(data['bm:sample_a:1']).toEqual(before);
  expect(data.bookmarks).toBeUndefined();
});

it('旧版で残ったポストのうち新形式に無いものだけを足す', async () => {
  data.schemaVersion = 3;
  data['bm:sample_a:1'] = { ...bookmark(), savedAt: 10 };
  data.bookmarks['sample_b:1'] = bookmark('1', 'sample_b');
  const set = vi.spyOn(chrome.storage.local, 'set');
  await storage.runStorageMigration();
  expect(set).toHaveBeenCalledExactlyOnceWith({ 'bm:sample_b:1': bookmark('1', 'sample_b') });
  expect(storedBookmarks(data)).toEqual({
    'sample_a:1': { ...bookmark(), savedAt: 10 }, 'sample_b:1': bookmark('1', 'sample_b'),
  });
  expect(data.bookmarks).toBeUndefined();
});

it('裏方以外は移行を一度頼んで完了を待つ', async () => {
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  const set = vi.spyOn(chrome.storage.local, 'set');
  const pending = [storage.getBookmarkOf('sample_a', '1'), storage.getBookmarkOf('sample_a', '1')];
  await vi.waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'migrateStorage' }));
  expect(set).not.toHaveBeenCalled();
  await storage.runStorageMigration();
  expect(await Promise.all(pending)).toEqual([bookmark(), bookmark()]);
});

it('裏方が失敗したまま 30 秒経つと書かずに StorageError にする', async () => {
  vi.useFakeTimers();
  const set = vi.spyOn(chrome.storage.local, 'set');
  const pending = expect(storage.getBookmarkOf('sample_a', '1')).rejects.toBeInstanceOf(storage.StorageError);
  await vi.advanceTimersByTimeAsync(30_000);
  await pending;
  expect(set).not.toHaveBeenCalled();
});

it('30 秒の時間切れのあとの操作では、裏方へもう一度頼む', async () => {
  vi.useFakeTimers();
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  const first = expect(storage.getBookmarkOf('sample_a', '1')).rejects.toBeInstanceOf(storage.StorageError);
  await vi.advanceTimersByTimeAsync(30_000);
  await first;
  const second = storage.getBookmarkOf('sample_a', '1');
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await storage.runStorageMigration();
  expect(await second).toEqual(bookmark());
});

it('空の保存領域なら裏方を待たずに保存できる', async () => {
  data = installChromeMock();
  storage.setAccountScope('sample_a');
  await expect(storage.setBookmarkFolders('1', ['sample_folder'], bookmark().snapshot)).resolves.toMatchObject({ tweetId: '1' });
  expect(data.schemaVersion).toBe(3);
  expect(data['bm:sample_a:1']).toBeDefined();
});

it('スキーマ 3 の旧キー回収は頼むだけで読み込みを待たせない', async () => {
  data.schemaVersion = 3;
  data['bm:sample_a:1'] = bookmark();
  const send = vi.spyOn(chrome.runtime, 'sendMessage');
  expect(await storage.getBookmarkOf('sample_a', '1')).toEqual(bookmark());
  await storage.getBookmarkOf('sample_a', '1');
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'migrateStorage' });
});

it('裏方は起動・インストール・メッセージで移行を呼び、失敗を記録する', async () => {
  vi.resetModules();
  const module = await import('../src/shared/storage');
  const migrate = vi.spyOn(module, 'runStorageMigration').mockRejectedValue(new Error('架空の失敗'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const installed = vi.spyOn(chrome.runtime.onInstalled, 'addListener');
  const message = vi.spyOn(chrome.runtime.onMessage, 'addListener');
  await import('../src/background/index');
  await Promise.resolve();
  expect(migrate).toHaveBeenCalledTimes(1);
  message.mock.calls[0][0]({ type: 'migrateStorage' }, {}, () => {});
  installed.mock.calls[1][0]({ reason: 'update' } as chrome.runtime.InstalledDetails);
  await Promise.resolve();
  expect(migrate).toHaveBeenCalledTimes(3);
  expect(error).toHaveBeenCalledTimes(3);
});
