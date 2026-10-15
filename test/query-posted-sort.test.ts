// 版: v76
import { describe, expect, it, vi } from 'vitest';
import { queryBookmarks, type SortKey } from '../src/shared/query';
import type { Bookmark } from '../src/shared/models';

const bookmarks: Bookmark[] = [
  '2026-10-01T00:00:00Z', undefined, 'invalid', '2026-10-01T00:00:00Z',
  '2025-01-01T00:00:00Z', '', '1970-01-01T00:00:00Z',
].map((createdAt, index) => ({
  accountId: 'me',
  tweetId: String(index),
  folderIds: ['sample'],
  savedAt: index % 3,
  snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_sort', media: [], url: '', createdAt },
}));

// 変更前の比較関数。日時の欠損・不正値と同値の順番も比較する。
function previousSort(all: Bookmark[], sort: SortKey): Bookmark[] {
  const posted = (b: Bookmark) => (b.snapshot.createdAt ? Date.parse(b.snapshot.createdAt) : 0) || 0;
  const compare = {
    savedDesc: (a: Bookmark, b: Bookmark) => b.savedAt - a.savedAt,
    savedAsc: (a: Bookmark, b: Bookmark) => a.savedAt - b.savedAt,
    postedDesc: (a: Bookmark, b: Bookmark) => posted(b) - posted(a),
    postedAsc: (a: Bookmark, b: Bookmark) => posted(a) - posted(b),
  };
  return [...all].sort(compare[sort]);
}

describe('日時の並べ替え', () => {
  it.each<SortKey>(['savedDesc', 'savedAsc', 'postedDesc', 'postedAsc'])('%s は変更前と同じ順番', (sort) => {
    expect(queryBookmarks(bookmarks, { folderId: 'all', search: '', sort })).toEqual(previousSort(bookmarks, sort));
  });

  it('絞り込んだ日時だけを一度ずつ解析する', () => {
    const all = [...bookmarks, { ...bookmarks[0], folderIds: ['other'] }];
    const parse = vi.spyOn(Date, 'parse');
    try {
      queryBookmarks(all, { folderId: 'sample', search: '', sort: 'postedDesc' });
      expect(parse).toHaveBeenCalledTimes(bookmarks.filter((b) => b.snapshot.createdAt).length);
      parse.mockClear();
      queryBookmarks(all, { folderId: 'sample', search: '', sort: 'savedDesc' });
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});
