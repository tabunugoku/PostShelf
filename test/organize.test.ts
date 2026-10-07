import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { INBOX_ID } from '../src/shared/models';
import {
  addCollected, addToFolders, createFolder, deleteBookmarks, getBookmark, listBookmarks, listFolders,
  moveToFolder, removeFromFolders, reorderFolders, restoreBookmarks, setBookmarkFolders,
} from '../src/shared/storage';

const snap = { text: 't', author: 'a', handle: '@a', media: [], url: 'u' };
let a: string, b: string, c: string;
let writes = 0;

beforeEach(async () => {
  const data = installChromeMock();
  a = (await createFolder({ name: 'a' })).id;
  b = (await createFolder({ name: 'b' })).id;
  c = (await createFolder({ name: 'c' })).id;
  await setBookmarkFolders('1', [a], snap);
  await setBookmarkFolders('2', [a, b], snap);
  await setBookmarkFolders('3', [b], snap);
  writes = 0;
  const set = (globalThis as any).chrome.storage.local.set;
  (globalThis as any).chrome.storage.local.set = async (x: any) => {
    writes++;
    return set(x);
  };
  void data;
});

const ids = async (folder: string) => (await listBookmarks()).filter((x) => x.folderIds.includes(folder)).map((x) => x.tweetId).sort();

describe('bulk operations', () => {
  it('addToFolders adds to many folders at once, no duplicates, ignores "all", one write', async () => {
    await addToFolders(['1', '2', '3'], [c, c, 'all']);
    expect(await ids(c)).toEqual(['1', '2', '3']);
    expect((await getBookmark('2'))!.folderIds).toEqual([a, b, c]);
    expect(writes).toBe(1);
  });

  it('removeFromFolders removes; posts left without a folder go to the inbox, not deleted', async () => {
    await removeFromFolders(['1', '2'], [a]);
    expect((await getBookmark('1'))!.folderIds).toEqual([INBOX_ID]);
    expect((await getBookmark('2'))!.folderIds).toEqual([b]);
    const folders = await listFolders();
    expect(folders[1].id).toBe(INBOX_ID); // 「すべて」の次
    expect(writes).toBe(2); // 受け皿フォルダ作成 + ブックマーク 1 回
  });

  it('moveToFolder moves from one folder to another (from=all just adds)', async () => {
    await moveToFolder(['1', '2'], a, c);
    expect(await ids(a)).toEqual([]);
    expect(await ids(c)).toEqual(['1', '2']);
    await moveToFolder(['3'], 'all', c);
    expect((await getBookmark('3'))!.folderIds).toEqual([b, c]);
  });

  it('deleteBookmarks deletes only the selected posts, in one write', async () => {
    await deleteBookmarks(['1', '3', 'nope']);
    expect((await listBookmarks()).map((x) => x.tweetId)).toEqual(['2']);
    expect(writes).toBe(1);
  });

  it('does not write when nothing changes', async () => {
    await addToFolders(['1'], [a]);
    await deleteBookmarks(['nope']);
    expect(writes).toBe(0);
  });

  it('undo restores deleted, moved and removed posts exactly', async () => {
    const before = JSON.stringify((await listBookmarks()).sort((x, y) => x.tweetId.localeCompare(y.tweetId)));
    for (const op of [
      () => deleteBookmarks(['1', '2']),
      () => moveToFolder(['1', '2'], a, c),
      () => removeFromFolders(['1', '3'], [a, b]),
    ]) {
      const undo = await op();
      expect(JSON.stringify((await listBookmarks()).sort((x, y) => x.tweetId.localeCompare(y.tweetId)))).not.toBe(before);
      await restoreBookmarks(undo);
      expect(JSON.stringify((await listBookmarks()).sort((x, y) => x.tweetId.localeCompare(y.tweetId)))).toBe(before);
    }
  });
});

describe('folder order', () => {
  it('reorderFolders updates order, "all" is ignored, the inbox stays right after "all"', async () => {
    await addCollected([{ tweetId: '9', snapshot: snap }]);
    await reorderFolders([c, 'all', a, INBOX_ID, b]);
    const names = (await listFolders()).map((f) => f.id);
    expect(names).toEqual(['all', INBOX_ID, c, a, b]);
    expect((await listFolders()).slice(2).map((f) => f.order)).toEqual([...(await listFolders()).slice(2).map((f) => f.order)].sort((x, y) => x - y));
  });
  it('folders missing from the list keep their relative order at the end', async () => {
    await reorderFolders([c]);
    expect((await listFolders()).map((f) => f.id)).toEqual(['all', c, a, b]);
  });
});
