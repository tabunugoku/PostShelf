import { afterEach, expect, it, vi } from 'vitest';
import { importData, restoreBookmarks } from '../src/shared/storage';
import type { Bookmark, Folder } from '../src/shared/models';
import { bulkWorld } from './v56-helpers';

afterEach(() => vi.restoreAllMocks());

const folderScans = (contexts: unknown[]) => contexts.filter((array: any) =>
  Array.isArray(array) && array.length >= 20 && typeof array[0] === 'object' && 'icon' in array[0],
).length;

it('複数アカウントの取り込みでフォルダをポストごとに絞り直さない', async () => {
  const world = bulkWorld();
  const folders: Folder[] = [
    ...world.folders,
    ...world.folders.map((f) => ({ ...f, accountId: 'sample_other' })),
  ];
  // 同じフォルダ ID でもアカウントごとに別の親を持つ。
  folders.find((f) => f.id === 'f1' && f.accountId === 'me')!.parentId = 'f0';
  folders.find((f) => f.id === 'f1' && f.accountId === 'sample_other')!.parentId = 'f2';
  world.data.folders = folders;
  const source = world.original['me:0'];
  const bookmarks = Array.from({ length: 1000 }, (_, i) => ({
    ...source, tweetId: `${6000 + i}`, accountId: i % 2 ? 'me' : 'sample_other', folderIds: ['f1'],
  }));
  const filter = vi.spyOn(Array.prototype, 'filter');
  expect(await importData({ app: 'PostShelf', version: 2, folders: [], bookmarks })).toBe(1000);
  const scans = folderScans(filter.mock.contexts);
  filter.mockRestore();
  expect(scans).toBeLessThanOrEqual(4);
  const saved = world.data.bookmarks as Record<string, Bookmark>;
  expect(Object.keys(saved)).toHaveLength(6000);
  expect(saved['me:6001'].folderIds).toEqual(['f1', 'f0']);
  expect(saved['sample_other:6000'].folderIds).toEqual(['f1', 'f2']);
  expect(saved['me:0']).toEqual(source);
});

it('複数アカウントの取り消しで所属の祖先を保ちフォルダ走査を繰り返さない', async () => {
  const world = bulkWorld();
  const folders: Folder[] = [
    ...world.folders,
    ...world.folders.map((f) => ({ ...f, accountId: 'sample_other' })),
  ];
  folders.find((f) => f.id === 'f1' && f.accountId === 'me')!.parentId = 'f0';
  folders.find((f) => f.id === 'f1' && f.accountId === 'sample_other')!.parentId = 'f2';
  world.data.folders = folders;
  const undo = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => {
    const accountId = i % 2 ? 'me' : 'sample_other';
    const tweetId = `${6000 + i}`;
    return [`${accountId}:${tweetId}`, { ...world.original['me:0'], accountId, tweetId, folderIds: ['f1'] }];
  }));
  const filter = vi.spyOn(Array.prototype, 'filter');
  await restoreBookmarks({ ...undo, 'me:0': null });
  const scans = folderScans(filter.mock.contexts);
  filter.mockRestore();
  expect(scans).toBe(0);
  const saved = world.data.bookmarks as Record<string, Bookmark>;
  expect(saved['me:0']).toBeUndefined();
  expect(saved['me:6001'].folderIds).toEqual(['f1', 'f0']);
  expect(saved['sample_other:6000'].folderIds).toEqual(['f1', 'f2']);
  expect(undo['sample_other:6000'].folderIds).toEqual(['f1']);
});
