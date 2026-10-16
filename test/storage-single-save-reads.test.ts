// 版: v78
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import type { Bookmark, Folder } from '../src/shared/models';
import {
  createFolder, getBookmark, reorderFolders, setAccountScope, setBookmarkFolders, updateFolder,
} from '../src/shared/storage';

const snapshot = {
  text: '架空の本文', author: 'Sample', handle: '@sample_save', media: [],
  url: 'https://x.com/sample_save/status/1',
};
const folder = (id: string, order: number, accountId = 'me', parentId?: string): Folder => ({
  id, name: id, icon: 'ti-folder', order, accountId, ...(parentId ? { parentId } : {}),
});
let data: Record<string, unknown>;

beforeEach(async () => {
  data = installChromeMock();
  Object.assign(data, { schemaVersion: 2, folderIdsRepaired: true, folders: [], bookmarks: {} });
  setAccountScope('me');
  await getBookmark('missing');
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('未分類の保存は受け皿あり = %s でも以前と同じで、読み書きは各 1 回', async (hasInbox) => {
  const mine = folder('parent', 4);
  const other = folder('other', 8, 'sample_other');
  const inbox: Folder = { id: 'inbox', name: '', icon: 'ti-star', order: 5, accountId: 'me' };
  const original = hasInbox ? [mine, inbox, other] : [mine, other];
  const foreign: Bookmark = {
    accountId: 'sample_other', tweetId: '1', folderIds: ['other'], savedAt: 50, snapshot,
  };
  Object.assign(data, { folders: original, bookmarks: { 'sample_other:1': foreign } });
  vi.spyOn(Date, 'now').mockReturnValue(100);
  const get = vi.spyOn(chrome.storage.local, 'get');
  const set = vi.spyOn(chrome.storage.local, 'set');
  const result = await setBookmarkFolders('1', [], snapshot);
  const expected = { accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 100, snapshot };
  expect(result).toEqual(expected);
  expect(data.bookmarks).toEqual({ 'sample_other:1': foreign, 'me:1': expected });
  expect(data.folders).toEqual(hasInbox ? original : [other, mine, inbox]);
  expect(get.mock.calls.filter(([keys]) => String(keys) === 'folders')).toHaveLength(1);
  expect(set).toHaveBeenCalledOnce();
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual(hasInbox ? ['bookmarks'] : ['bookmarks', 'folders']);
});

it('孫を選ぶ保存は祖先・他アカウント・全文・savedAt を保ち、フォルダを書かない', async () => {
  const folders = [folder('parent', 0), folder('other', 2, 'sample_other'),
    folder('child', 0, 'me', 'parent'), folder('grandchild', 0, 'me', 'child')];
  const previous: Bookmark = {
    accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 7,
    snapshot: { ...snapshot, text: '架空の長い本文を取得済み', truncated: false },
  };
  Object.assign(data, { folders, bookmarks: { 'me:1': previous } });
  const get = vi.spyOn(chrome.storage.local, 'get');
  const set = vi.spyOn(chrome.storage.local, 'set');
  const result = await setBookmarkFolders('1', ['grandchild'], { ...snapshot, truncated: true });
  const expected = { ...previous, folderIds: ['grandchild', 'parent', 'child'] };
  expect(result).toEqual(expected);
  expect(data.bookmarks).toEqual({ 'me:1': expected });
  expect(data.folders).toEqual(folders);
  expect(get.mock.calls.filter(([keys]) => String(keys) === 'folders')).toHaveLength(1);
  expect(set).toHaveBeenCalledExactlyOnceWith({ bookmarks: { 'me:1': expected } });
});

it('フォルダ作成は他アカウントを先に保存し、フォルダを 1 回だけ読む', async () => {
  const mine = folder('parent', 3);
  const other = folder('other', 5, 'sample_other');
  data.folders = [mine, other];
  const get = vi.spyOn(chrome.storage.local, 'get');
  const created = await createFolder({ name: '  新しいフォルダ  ', parentId: 'parent' });
  expect(created).toEqual({
    id: expect.any(String), name: '新しいフォルダ', icon: 'ti-folder', order: 0, parentId: 'parent', accountId: 'me',
  });
  expect(data.folders).toEqual([other, mine, created]);
  expect(data.bookmarks).toEqual({});
  expect(get.mock.calls.filter(([keys]) => String(keys) === 'folders')).toHaveLength(1);
});

it.each(['update', 'reparent', 'reorder', 'reorder-reparent'])('%s は以前と同じ順序で保存し、フォルダを 1 回読む', async (operation) => {
  const parent = folder('parent', 0);
  const child = folder('child', 0, 'me', 'parent');
  const other = folder('other', 5, 'sample_other');
  data.folders = [parent, other, child];
  const get = vi.spyOn(chrome.storage.local, 'get');
  if (operation === 'update') {
    expect(await updateFolder('child', { name: '変更後', color: '#E24B4A' })).toEqual({
      ...child, name: '変更後', color: '#E24B4A',
    });
    expect(data.folders).toEqual([other, parent, { ...child, name: '変更後', color: '#E24B4A' }]);
  } else if (operation === 'reparent') {
    const { parentId: _parent, ...rootChild } = child;
    expect(await updateFolder('child', { parentId: null })).toEqual({ ...rootChild, order: 1 });
    expect(data.folders).toEqual([other, parent, { ...rootChild, order: 1 }]);
  } else {
    await reorderFolders(['child', 'parent'], operation === 'reorder-reparent' ? { id: 'child', parentId: null } : undefined);
    const { parentId: _parent, ...rootChild } = child;
    expect(data.folders).toEqual(operation === 'reorder'
      ? [other, child, parent] : [other, rootChild, { ...parent, order: 1 }]);
  }
  expect(data.bookmarks).toEqual({});
  expect(get.mock.calls.filter(([keys]) => String(keys) === 'folders')).toHaveLength(1);
});

it('保存の失敗はそのまま返し、次の保存を妨げない', async () => {
  const error = new Error('保存失敗');
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(error);
  await expect(setBookmarkFolders('1', ['inbox'], snapshot)).rejects.toBe(error);
  await expect(setBookmarkFolders('1', ['inbox'], snapshot)).resolves.toMatchObject({ folderIds: ['inbox'] });
});
