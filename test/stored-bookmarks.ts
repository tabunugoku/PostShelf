// 版: v83
import { bookmarkKey, type Bookmark } from '../src/shared/models';
import { SCHEMA_VERSION } from '../src/shared/storage';

/** 前のポストをすべて消してから、指定したポストと移行済みの印を入れる。 */
export function seedBookmarks(data: Record<string, unknown>, list: Bookmark[]): void {
  delete data.bookmarks;
  for (const key of Object.keys(data)) {
    if (key.startsWith('bm:')) delete data[key];
  }
  const map = Object.fromEntries(list.map((b) => [bookmarkKey(b.accountId, b.tweetId), b]));
  if (SCHEMA_VERSION < 3) data.bookmarks = map;
  else {
    for (const [key, b] of Object.entries(map)) data['bm:' + key] = b;
  }
  data.schemaVersion = SCHEMA_VERSION;
  data.folderIdsRepaired = true;
}

/** 両方の保存形式をまとめ、同じポストは新しいキーの値を返す。 */
export function storedBookmarks(data: Record<string, unknown>): Record<string, Bookmark> {
  const map = { ...(data.bookmarks as Record<string, Bookmark> | undefined) };
  for (const [key, b] of Object.entries(data)) {
    if (key.startsWith('bm:')) map[key.slice(3)] = b as Bookmark;
  }
  return map;
}
