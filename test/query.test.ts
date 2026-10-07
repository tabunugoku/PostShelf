import { describe, expect, it } from 'vitest';
import { countFolder, queryBookmarks } from '../src/shared/query';
import type { Bookmark } from '../src/shared/models';

const mk = (id: string, folderIds: string[], savedAt: number, text: string, createdAt?: string): Bookmark => ({
  tweetId: id, folderIds, savedAt,
  snapshot: { text, author: 'Ann', handle: '@ann', media: [], url: '', createdAt },
});
const all = [
  mk('1', ['a'], 10, 'Hello world', '2026-01-01T00:00:00Z'),
  mk('2', ['a', 'b'], 30, 'Rust tips', '2025-01-01T00:00:00Z'),
  mk('3', ['b'], 20, 'cooking'),
];

describe('queryBookmarks', () => {
  it('filters by folder, "all" shows everything', () => {
    expect(queryBookmarks(all, { folderId: 'a', search: '', sort: 'savedDesc' }).map((b) => b.tweetId)).toEqual(['2', '1']);
    expect(queryBookmarks(all, { folderId: 'all', search: '', sort: 'savedAsc' }).map((b) => b.tweetId)).toEqual(['1', '3', '2']);
  });
  it('searches case-insensitively', () => {
    expect(queryBookmarks(all, { folderId: 'all', search: 'RUST', sort: 'savedDesc' }).map((b) => b.tweetId)).toEqual(['2']);
  });
  it('sorts by posted date, missing dates last when desc', () => {
    expect(queryBookmarks(all, { folderId: 'all', search: '', sort: 'postedDesc' }).map((b) => b.tweetId)).toEqual(['1', '2', '3']);
  });
  it('counts', () => {
    expect(countFolder(all, 'b')).toBe(2);
    expect(countFolder(all, 'all')).toBe(3);
  });
});
