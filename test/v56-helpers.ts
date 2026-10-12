import { vi } from 'vitest';
import type { Bookmark, Folder } from '../src/shared/models';
import { setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

/** 大量データを読む境界だけを模擬し、保存層内の余分な複製とフォルダ走査を計測する。 */
export function bulkWorld(size = 5000) {
  const data = installChromeMock();
  setAccountScope('me');
  const folders: Folder[] = Array.from({ length: 20 }, (_, i) => ({
    id: `f${i}`, accountId: 'me', name: `Sample Folder ${i}`, icon: 'ti-folder', order: i,
  }));
  const original: Record<string, Bookmark> = Object.fromEntries(Array.from({ length: size }, (_, i) => {
    const tweetId = `${i}`;
    const bookmark: Bookmark = {
      accountId: 'me', tweetId, savedAt: i, folderIds: ['f0'],
      snapshot: { text: `架空の本文 ${i}`, author: 'Sample User', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${i}` },
    };
    Object.freeze(bookmark.folderIds);
    Object.freeze(bookmark.snapshot.media);
    Object.freeze(bookmark.snapshot);
    Object.freeze(bookmark);
    return [`me:${tweetId}`, bookmark];
  }));
  Object.assign(data, { schemaVersion: 2, folderIdsRepaired: true, folders, bookmarks: { ...original } });
  // ブラウザ側の複製は測定対象外。get ごとに map だけを新しくし、項目の不変性も検証する。
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (key: any) => ({
    [key]: key === 'bookmarks' ? { ...(data.bookmarks as Record<string, Bookmark>) } : data[key],
  }));
  const write = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => { Object.assign(data, items); });
  return { data, folders, original, write, ids: Array.from({ length: 1000 }, (_, i) => `${i}`) };
}
