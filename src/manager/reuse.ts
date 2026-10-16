import type { Bookmark, Folder } from '../shared/models';

function reuseItems<T>(previous: T[], incoming: T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map(previous.map((item) => [keyOf(item), item]));
  const reused = incoming.map((item) => {
    const old = byKey.get(keyOf(item));
    return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
  });
  return previous.length === reused.length && reused.every((item, index) => item === previous[index])
    ? previous
    : reused;
}

/** 同じアカウント・ポスト ID の中身が同じ要素と、順序も同じ配列を使い回す。 */
export function reuseBookmarks(previous: Bookmark[], incoming: Bookmark[]): Bookmark[] {
  return reuseItems(previous, incoming, (b) => JSON.stringify([b.accountId, b.tweetId]));
}

/** 同じアカウント・フォルダ ID の中身が同じ要素と、順序も同じ配列を使い回す。 */
export function reuseFolders(previous: Folder[], incoming: Folder[]): Folder[] {
  return reuseItems(previous, incoming, (f) => JSON.stringify([f.accountId, f.id]));
}
