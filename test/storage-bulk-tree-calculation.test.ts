// 版: v76
import { afterEach, expect, it, vi } from 'vitest';
import * as storage from '../src/shared/storage';
import * as tree from '../src/shared/folderTree';
import { isBuiltinFolder, type Bookmark, type Folder } from '../src/shared/models';
import { installChromeMock } from './chrome-mock';
import {
  previousReparentedFolderIds, previousWithAncestors, previousWithoutDescendants, sampleFolderTree,
} from './folder-membership-reference';

const memberships = [
  ['grandchild', 'child', 'parent'], ['child', 'parent', 'other'], ['parent', 'sibling'],
  ['other'], ['inbox'], ['parent'], ['grandchild', 'other', 'child', 'parent'],
];
const unique = (ids: string[]) => [...new Set(ids)];
const real = (ids: string[]) => ids.filter((id) => !isBuiltinFolder(id));

function world(size = 28, hasInbox = true) {
  const data = installChromeMock();
  storage.setAccountScope('me');
  const folders = sampleFolderTree().filter((f) => hasInbox || f.id !== 'inbox');
  const original: Record<string, Bookmark> = {};
  for (let index = 0; index < size; index++) {
    const bookmark: Bookmark = {
      accountId: 'me', tweetId: String(index), folderIds: [...memberships[index % memberships.length]], savedAt: index,
      snapshot: { text: '架空の本文 ' + index, author: 'Sample', handle: '@sample_bulk', media: [], url: '' },
    };
    Object.freeze(bookmark.folderIds);
    Object.freeze(bookmark.snapshot);
    Object.freeze(bookmark);
    original['me:' + index] = bookmark;
  }
  original['sample_other:0'] = { ...original['me:0'], accountId: 'sample_other' };
  Object.assign(data, { schemaVersion: 2, folderIdsRepaired: true, folders, bookmarks: { ...original } });
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (keys: any) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map((key) => [
      key, key === 'bookmarks' ? { ...(data.bookmarks as Record<string, Bookmark>) } : data[key],
    ]),
  ));
  const write = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    Object.assign(data, items);
  });
  return {
    data, folders, original, write,
    ids: [...Array.from({ length: size - 1 }, (_, index) => String(index)), '0', 'missing'],
  };
}

// 変更前の mutateBookmarks が返す map と undo。今回の操作は所属だけを変えるため、その同値判定を使う。
function previousMutation(
  original: Record<string, Bookmark>,
  tweetIds: string[],
  folders: Folder[],
  change: (ids: string[]) => string[] | null,
) {
  const map = { ...original };
  const undo: storage.BookmarkUndo = {};
  for (const tweetId of new Set(tweetIds)) {
    const key = 'me:' + tweetId;
    const previous = map[key];
    if (!previous) continue;
    const changed = change(previous.folderIds);
    const nextIds = changed && previousWithAncestors(changed, folders);
    if (nextIds && nextIds.length === previous.folderIds.length &&
      nextIds.every((id, index) => id === previous.folderIds[index])) continue;
    undo[key] = previous;
    if (nextIds) map[key] = { ...previous, folderIds: nextIds };
    else delete map[key];
  }
  return { map, undo };
}

afterEach(() => vi.restoreAllMocks());

it.each([
  ['remove', ['parent'], []], ['remove', ['child'], []], ['remove', ['grandchild'], []],
  ['move', ['child'], ['other']], ['move', ['child'], ['child']], ['move', ['all'], ['other']],
  ['move', ['parent'], ['inbox']], ['change', ['child'], ['sibling', 'other']],
  ['change', ['parent'], ['inbox']], ['change', [], ['grandchild']],
  ['add', [], ['grandchild']], ['delete', [], []],
] as const)('%s (%j → %j) の保存と取り消しが変更前と一致する', async (operation, removed, added) => {
  const current = world();
  const removeIds = [...removed];
  const addIds = [...added];
  const expected = previousMutation(current.original, current.ids, current.folders, (ids) => {
    if (operation === 'delete') return null;
    if (operation === 'add') return unique([...ids, ...real(addIds)]);
    if (operation === 'change') return addIds.includes('inbox') ? ['inbox']
      : unique([...previousWithoutDescendants(ids, removeIds, current.folders), ...real(addIds)]);
    if (operation === 'remove') {
      const rest = previousWithoutDescendants(ids, removeIds, current.folders);
      return rest.length ? rest : ['inbox'];
    }
    const fromId = removeIds[0];
    const toId = addIds[0];
    const rest = fromId && !isBuiltinFolder(fromId) && fromId !== toId
      ? previousWithoutDescendants(ids, [fromId], current.folders) : ids;
    return toId === 'inbox' ? ['inbox'] : unique([...rest, ...real([toId])]);
  });
  let undo: storage.BookmarkUndo;
  switch (operation) {
    case 'remove':
      undo = await storage.removeFromFolders(current.ids, removeIds);
      break;
    case 'move':
      undo = await storage.moveToFolder(current.ids, removeIds[0], addIds[0]);
      break;
    case 'change':
      undo = await storage.changeBookmarkFolders(current.ids, addIds, removeIds);
      break;
    case 'add':
      undo = await storage.addToFolders(current.ids, addIds);
      break;
    case 'delete':
      undo = await storage.deleteBookmarks(current.ids);
      break;
  }
  expect(current.data.bookmarks).toEqual(expected.map);
  expect(undo).toEqual(expected.undo);
  for (const key of Object.keys(undo)) {
    expect(undo[key]).toBe(current.original[key]);
  }
  expect(current.write).toHaveBeenCalledTimes(Object.keys(undo).length ? 1 : 0);
  const saved = current.data.bookmarks as Record<string, Bookmark>;
  expect(saved['sample_other:0']).toBe(current.original['sample_other:0']);
  await storage.restoreBookmarks(undo);
  expect(current.data.bookmarks).toEqual(current.original);
});

it.each(['update', 'reorder'])('%s による付け替えの保存結果が変更前と一致する', async (operation) => {
  const current = world();
  const resolver = vi.spyOn(tree, 'reparentedFolderResolver');
  if (operation === 'update') await storage.updateFolder('child', { parentId: 'other' });
  else await storage.reorderFolders(['child'], { id: 'child', parentId: 'other' });
  expect(resolver).toHaveBeenCalledOnce();
  const folders = current.data.folders as Folder[];
  for (const [key, bookmark] of Object.entries(current.original)) {
    const expected = bookmark.accountId === 'me'
      ? previousReparentedFolderIds(bookmark.folderIds, folders, 'child', ['parent']) : bookmark.folderIds;
    expect((current.data.bookmarks as Record<string, Bookmark>)[key]).toEqual({ ...bookmark, folderIds: expected });
  }
  expect(current.write).toHaveBeenCalledOnce();
});

it.each([false, true])('未分類の受け皿を作る場合も確定式 = %s の undo は変更前と一致する', async (atomic) => {
  const current = world(14, false);
  const expected = previousMutation(current.original, current.ids, current.folders, () => []);
  const undo = atomic ? await storage.changeBookmarkFolders(current.ids, ['inbox'], ['parent', 'other'])
    : await storage.removeFromFolders(current.ids, ['parent', 'other']);
  expect(current.data.bookmarks).toEqual(expected.map);
  expect(undo).toEqual(expected.undo);
  expect((current.data.folders as Folder[]).some((f) => f.id === 'inbox')).toBe(true);
});

it.each(['remove', 'move', 'change', 'reparent'])('%s の木の走査はポスト数に比例しない', async (operation) => {
  const measurements: number[] = [];
  for (const size of [7, 700]) {
    const current = world(size);
    const filter = vi.spyOn(Array.prototype, 'filter');
    const find = vi.spyOn(Array.prototype, 'find');
    if (operation === 'remove') await storage.removeFromFolders(current.ids, ['child']);
    else if (operation === 'move') await storage.moveToFolder(current.ids, 'child', 'other');
    else if (operation === 'change') await storage.changeBookmarkFolders(current.ids, ['other'], ['child']);
    else await storage.updateFolder('child', { parentId: 'other' });
    // 木の filter / find だけを数える。所属 ID の配列と保存領域のモックは測定対象外。
    const isTree = (array: unknown) => Array.isArray(array) && array.length === current.folders.length &&
      array.every((item) => item && typeof item === 'object' && 'icon' in item);
    const scans = [...filter.mock.contexts, ...find.mock.contexts].filter(isTree).length;
    expect(scans).toBeGreaterThan(0);
    measurements.push(scans);
    vi.restoreAllMocks();
  }
  expect(measurements[1]).toBe(measurements[0]);
});
