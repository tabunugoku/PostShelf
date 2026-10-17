// 版: v78
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';
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
  Object.assign(data, {
    folders: [],
  });
  seedBookmarks(data, Object.values({}));
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
  Object.assign(data, {
    folders: original,
  });
  seedBookmarks(data, Object.values({ 'sample_other:1': foreign }));
  vi.spyOn(Date, 'now').mockReturnValue(100);
  const get = vi.spyOn(chrome.storage.local, 'get');
  const set = vi.spyOn(chrome.storage.local, 'set');
  const result = await setBookmarkFolders('1', [], snapshot);
  const expected = { accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 100, snapshot };
  expect(result).toEqual(expected);
  expect(storedBookmarks(data)).toEqual({ 'sample_other:1': foreign, 'me:1': expected });
  expect(data.folders).toEqual(hasInbox ? original : [other, mine, inbox]);
  expect(get).toHaveBeenCalledExactlyOnceWith(['folders', 'bm:me:1']);
  expect(set).toHaveBeenCalledOnce();
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual(hasInbox ? ['bm:me:1'] : ['bm:me:1', 'folders']);
});

it('孫を選ぶ保存は祖先・他アカウント・全文・savedAt を保ち、フォルダを書かない', async () => {
  const folders = [folder('parent', 0), folder('other', 2, 'sample_other'),
    folder('child', 0, 'me', 'parent'), folder('grandchild', 0, 'me', 'child')];
  const previous: Bookmark = {
    accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 7,
    snapshot: { ...snapshot, text: '架空の長い本文を取得済み', truncated: false },
  };
  Object.assign(data, {
    folders,
  });
  seedBookmarks(data, Object.values({ 'me:1': previous }));
  const get = vi.spyOn(chrome.storage.local, 'get');
  const set = vi.spyOn(chrome.storage.local, 'set');
  const result = await setBookmarkFolders('1', ['grandchild'], { ...snapshot, truncated: true });
  const expected = { ...previous, folderIds: ['grandchild', 'parent', 'child'] };
  expect(result).toEqual(expected);
  expect(storedBookmarks(data)).toEqual({ 'me:1': expected });
  expect(data.folders).toEqual(folders);
  expect(get).toHaveBeenCalledExactlyOnceWith(['folders', 'bm:me:1']);
  expect(set).toHaveBeenCalledExactlyOnceWith({ 'bm:me:1': expected });
});

it.each([
  ['me', 'edit'],
  ['me', 'create'],
  ['sample_other', 'edit'],
  ['sample_other', 'create'],
])('別画面の %s のフォルダの %s を未分類の保存で消さない', async (accountId, operation) => {
  const mine = folder('parent', 4);
  const other = folder('other', 8, 'sample_other');
  data.folders = [mine, other];
  const edited = { ...(accountId === 'me' ? mine : other), name: '架空の編集後フォルダ' };
  const created = folder('sample_created', 9, accountId);
  const read = chrome.storage.local.get.bind(chrome.storage.local);
  let scheduleExternalWrite: () => void;
  const externalWrite = new Promise<void>((resolve, reject) => {
    scheduleExternalWrite = () => {
      setTimeout(() => {
        const current = data.folders as Folder[];
        const folders = operation === 'edit'
          ? current.map((f) => f.id === edited.id && f.accountId === accountId ? edited : f)
          : [...current, created];
        void chrome.storage.local.set({ folders }).then(resolve, reject);
      }, 0);
    };
  });
  let reads = 0;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys) => {
    const result = await read(keys);
    reads++;
    if (reads === 1) {
      // 旧実装では、フォルダを読んだあとポストの読み出しを待つ間に別画面が書き込む。
      scheduleExternalWrite();
    } else {
      await externalWrite;
    }
    return result;
  });

  const result = await setBookmarkFolders('1', [], snapshot);
  await externalWrite;

  const expected = operation === 'edit'
    ? [mine, other].map((f) => f.accountId === accountId ? edited : f)
    : [mine, other, created];
  expect(data.folders).toHaveLength(expected.length + 1);
  expect(data.folders).toEqual(expect.arrayContaining([
    ...expected,
    { id: 'inbox', name: '', icon: 'ti-star', order: 5, accountId: 'me' },
  ]));
  expect(storedBookmarks(data)).toEqual({ 'me:1': result });
});

it.each([undefined, null])('保存データが %s なら空のフォルダとポストとして読む', async (missing) => {
  Object.assign(data, {
    folders: missing,
  });
  seedBookmarks(data, Object.values(missing ?? {}));
  vi.spyOn(Date, 'now').mockReturnValue(100);
  const get = vi.spyOn(chrome.storage.local, 'get');
  const set = vi.spyOn(chrome.storage.local, 'set');

  const result = await setBookmarkFolders('1', [], snapshot);

  expect(result).toEqual({ accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 100, snapshot });
  expect(data.folders).toEqual([{ id: 'inbox', name: '', icon: 'ti-star', order: 0, accountId: 'me' }]);
  expect(storedBookmarks(data)).toEqual({ 'me:1': result });
  expect(get).toHaveBeenCalledExactlyOnceWith(['folders', 'bm:me:1']);
  expect(set).toHaveBeenCalledOnce();
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
  expect(storedBookmarks(data)).toEqual({});
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
  expect(storedBookmarks(data)).toEqual({});
  expect(get.mock.calls.filter(([keys]) => String(keys) === 'folders')).toHaveLength(1);
});

it('保存の失敗はそのまま返し、次の保存を妨げない', async () => {
  const error = new Error('保存失敗');
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(error);
  await expect(setBookmarkFolders('1', ['inbox'], snapshot)).rejects.toBe(error);
  await expect(setBookmarkFolders('1', ['inbox'], snapshot)).resolves.toMatchObject({ folderIds: ['inbox'] });
});
