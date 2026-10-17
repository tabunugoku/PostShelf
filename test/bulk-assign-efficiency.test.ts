// 版: v56-a
import { storedBookmarks } from './stored-bookmarks';
import { afterEach, expect, it, vi } from 'vitest';
import { addToFolders, deleteBookmarks, moveToFolder, removeFromFolders, restoreBookmarks } from '../src/shared/storage';
import type { Bookmark } from '../src/shared/models';
import { bulkWorld } from './bulk-helpers';

afterEach(() => vi.restoreAllMocks());

it.each(['add', 'move', 'remove', 'delete'])('5000 件から 1000 件を %s して複製せず取り消せる', async (op) => {
  const world = bulkWorld();
  const clone = vi.spyOn(globalThis, 'structuredClone');
  const stringify = vi.spyOn(JSON, 'stringify');
  const undo = await (
    op === 'add' ? addToFolders(world.ids, ['f1']) :
    op === 'move' ? moveToFolder(world.ids, 'f0', 'f1') :
    op === 'remove' ? removeFromFolders(world.ids, ['f0']) : deleteBookmarks(world.ids)
  );
  expect(clone.mock.calls.length).toBe(0);
  expect(stringify.mock.calls.length).toBe(0);
  expect(Object.keys(undo)).toHaveLength(1000);
  const current = storedBookmarks(world.data) as Record<string, Bookmark>;
  expect(Object.keys(current)).toHaveLength(op === 'delete' ? 4000 : 5000);
  for (const id of world.ids) {
    const key = `me:${id}`;
    expect(undo[key]).toBe(world.original[key]);
    if (op === 'delete') expect(current[key]).toBeUndefined();
    else {
      expect(current[key].folderIds).toEqual(op === 'add' ? ['f0', 'f1'] : op === 'move' ? ['f1'] : ['inbox']);
      expect(current[key].snapshot).toBe(world.original[key].snapshot);
      expect(current[key].savedAt).toBe(world.original[key].savedAt);
    }
  }
  expect(current['me:1000']).toBe(world.original['me:1000']);
  await restoreBookmarks(undo);
  expect(storedBookmarks(world.data)).toEqual(world.original);
  await restoreBookmarks(undo);
  expect(storedBookmarks(world.data)).toEqual(world.original);
});

it('所属が変わらないものと二重適用は取り消しに入れず書き込まない', async () => {
  const world = bulkWorld();
  expect(await addToFolders(world.ids, ['f0'])).toEqual({});
  expect(world.write).not.toHaveBeenCalled();
  await addToFolders(world.ids, ['f1']);
  world.write.mockClear();
  expect(await addToFolders([...world.ids, ...world.ids], ['f1'])).toEqual({});
  expect(world.write).not.toHaveBeenCalled();
});

it('アカウントのフォルダ一覧の絞り込みをポストごとには繰り返さない', async () => {
  const world = bulkWorld();
  const filter = vi.spyOn(Array.prototype, 'filter');
  await addToFolders(world.ids, ['f1']);
  expect(filter.mock.contexts.filter((array) => array === world.folders)).toHaveLength(1);
});
