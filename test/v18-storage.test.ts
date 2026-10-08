import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { INBOX_ID } from '../src/shared/models';
import {
  addCollected, addToFolders, createFolder, deleteFolder, getBookmark, importData, listBookmarks, listFolders,
  moveToFolder, normalizeFolderIds, removeFromFolders, repairFolderIds, setAccountScope, setBookmarkFolders,
} from '../src/shared/storage';

let data: Record<string, any>;
const snap = (id: string) => ({ text: id, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${id}` });

beforeEach(() => {
  data = installChromeMock() as Record<string, any>;
  setAccountScope('me');
});

describe('v18-A-1: 「未分類」と他のフォルダは同時に付かない', () => {
  it('normalizeFolderIds', () => {
    expect(normalizeFolderIds([])).toEqual([INBOX_ID]);
    expect(normalizeFolderIds(['all'])).toEqual([INBOX_ID]);
    expect(normalizeFolderIds([INBOX_ID, 'a', 'a', 'all'])).toEqual(['a']);
    expect(normalizeFolderIds(['b', 'a', 'b'])).toEqual(['b', 'a']);
  });

  it('addToFolders / moveToFolder on a 未分類 post drop 未分類; moving to 未分類 drops the others', async () => {
    const a = await createFolder({ name: 'A' });
    const b = await createFolder({ name: 'B' });
    await setBookmarkFolders('1', [INBOX_ID], snap('1'));
    await setBookmarkFolders('2', [INBOX_ID], snap('2'));
    await addToFolders(['1', '2'], [a.id]); // まとめて追加
    expect((await getBookmark('1'))!.folderIds).toEqual([a.id]);
    expect((await getBookmark('2'))!.folderIds).toEqual([a.id]);
    await setBookmarkFolders('3', [INBOX_ID], snap('3'));
    await moveToFolder(['3'], INBOX_ID, b.id);
    expect((await getBookmark('3'))!.folderIds).toEqual([b.id]);
    await setBookmarkFolders('4', [a.id, b.id], snap('4'));
    await moveToFolder(['4'], a.id, INBOX_ID);
    expect((await getBookmark('4'))!.folderIds).toEqual([INBOX_ID]);
    await removeFromFolders(['2'], [a.id]);
    expect((await getBookmark('2'))!.folderIds).toEqual([INBOX_ID]);
  });

  it('importData restores a backup as it is (no rewriting)', async () => {
    const bk = { accountId: 'me', tweetId: '5', folderIds: [INBOX_ID, 'f_x'], savedAt: 1, snapshot: snap('5') };
    await importData({ app: 'PostShelf', version: 2, accounts: [], folders: [], bookmarks: [bk] });
    expect(data.bookmarks['me:5'].folderIds).toEqual([INBOX_ID, 'f_x']);
  });
});

describe('v18-A-2: フォルダの削除と修復', () => {
  it('deleting the last folder of a post moves it to 未分類 (and creates the inbox folder)', async () => {
    const a = await createFolder({ name: 'A' });
    const b = await createFolder({ name: 'B' });
    await setBookmarkFolders('1', [a.id], snap('1'));
    await setBookmarkFolders('2', [a.id, b.id], snap('2'));
    await deleteFolder(a.id);
    expect((await getBookmark('1'))!.folderIds).toEqual([INBOX_ID]);
    expect((await getBookmark('2'))!.folderIds).toEqual([b.id]);
    expect((await listFolders()).some((f) => f.id === INBOX_ID)).toBe(true);
  });

  const broken = () => {
    data.schemaVersion = 2;
    data.folders = [{ id: 'f_a', name: 'A', icon: 'ti-code', order: 0, accountId: 'me' }];
    data.bookmarks = {
      'me:1': { accountId: 'me', tweetId: '1', folderIds: [], savedAt: 1, snapshot: snap('1') },
      'me:2': { accountId: 'me', tweetId: '2', folderIds: [INBOX_ID, 'f_a'], savedAt: 2, snapshot: snap('2') },
      'me:3': { accountId: 'me', tweetId: '3', folderIds: ['f_a'], savedAt: 3, snapshot: snap('3') },
    };
  };

  it('repairs empty / mixed folderIds once, keeps everything else, and does not write the second time', async () => {
    broken();
    const before = structuredClone(data.bookmarks);
    expect((await listBookmarks()).length).toBe(3); // 最初の公開関数で直る
    expect(data.folderIdsRepaired).toBe(true);
    expect(data.schemaVersion).toBe(2);
    expect(data.bookmarks['me:1'].folderIds).toEqual([INBOX_ID]);
    expect(data.bookmarks['me:2'].folderIds).toEqual(['f_a']);
    expect(data.bookmarks['me:3']).toEqual(before['me:3']);
    expect(data.bookmarks['me:2'].savedAt).toBe(2);
    expect(data.bookmarks['me:2'].snapshot).toEqual(before['me:2'].snapshot);
    expect(data.folders.some((f: any) => f.id === INBOX_ID && f.accountId === 'me')).toBe(true);
    // 2 回目: 何も書かない
    const snapshot = structuredClone(data);
    await repairFolderIds();
    await listBookmarks();
    expect(data).toEqual(snapshot);
  });

  it('with nothing to repair it only sets the mark, without touching bookmarks', async () => {
    data.schemaVersion = 2;
    data.bookmarks = { 'me:3': { accountId: 'me', tweetId: '3', folderIds: ['f_a'], savedAt: 3, snapshot: snap('3') } };
    const writes: string[] = [];
    const set = (globalThis as any).chrome.storage.local.set;
    (globalThis as any).chrome.storage.local.set = async (i: any) => { writes.push(...Object.keys(i)); return set(i); };
    await listBookmarks();
    expect(writes).toEqual(['folderIdsRepaired']);
  });
});

describe('v18-A-3: 同じ実行環境の中の同時書き込み', () => {
  it('addCollected and setBookmarkFolders called at the same time keep both changes', async () => {
    const f = await createFolder({ name: 'F' });
    await Promise.all([
      addCollected([{ tweetId: '10', snapshot: snap('10') }, { tweetId: '11', snapshot: snap('11') }]),
      setBookmarkFolders('20', [f.id], snap('20')),
      setBookmarkFolders('21', [INBOX_ID], snap('21')),
      addToFolders(['20'], [f.id]),
    ]);
    expect((await listBookmarks()).map((b) => b.tweetId).sort()).toEqual(['10', '11', '20', '21']);
  });
});
