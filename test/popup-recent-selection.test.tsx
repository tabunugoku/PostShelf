// 版: v78
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import type { Bookmark } from '../src/shared/models';

const bookmarksOf = (times: number[]): Bookmark[] => times.map((savedAt, index) => ({
  accountId: 'me', tweetId: String(index), folderIds: index % 2 ? ['sample_folder'] : ['inbox'], savedAt,
  snapshot: {
    text: '架空の本文 ' + index, author: 'Sample', handle: '@sample_' + index,
    media: [], url: 'https://x.com/sample_' + index + '/status/' + index,
  },
}));

afterEach(() => {
  render(null, document.getElementById('app')!);
  vi.restoreAllMocks();
});

it.each([
  { label: '同時刻の境界', times: [2, 9, 9, 4, 9, 9, 1] },
  { label: 'すべて同時刻', times: [7, 7, 7, 7] },
  { label: '2 件', times: [1, 3] },
  { label: '1 件', times: [4] },
  { label: '空', times: [] },
  { label: '多数', times: Array.from({ length: 1000 }, (_, index) => (index * 37) % 101) },
])('$label も安定な並べ替えと同じ 3 件を全件の sort なしで選ぶ', async ({ times }) => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  const storage = await import('../src/shared/storage');
  const bookmarks = bookmarksOf(times);
  const before = structuredClone(bookmarks);
  const expected = [...bookmarks].sort((a, b) => b.savedAt - a.savedAt).slice(0, 3);
  vi.spyOn(storage, 'getLastSeenAccount').mockResolvedValue({ id: 'me', handle: 'me', lastSeenAt: 0 });
  vi.spyOn(storage, 'listBookmarks').mockResolvedValue(bookmarks);
  vi.spyOn(storage, 'listFolders').mockResolvedValue([
    { id: 'sample_folder', name: 'Sample Folder', icon: 'ti-folder', color: '#E24B4A', order: 0, accountId: 'me' },
  ]);
  Object.freeze(bookmarks);
  const iterate = vi.spyOn(Array.prototype, Symbol.iterator);
  const sort = vi.spyOn(Array.prototype, 'sort');
  await act(async () => { await import('../src/popup/index'); });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
  const bookmarkSorts = sort.mock.contexts.filter(context => Array.isArray(context) &&
    context.some(item => item && typeof item === 'object' && 'savedAt' in item));
  const scans = iterate.mock.contexts.filter(context => context === bookmarks).length;
  sort.mockRestore();
  iterate.mockRestore();
  expect(bookmarkSorts).toHaveLength(0);
  expect(scans).toBe(1);
  expect([...document.querySelectorAll('.rec-row')].map(row => row.querySelector('.rec-handle')!.textContent))
    .toEqual(expected.map(bookmark => bookmark.snapshot.handle));
  expect([...document.querySelectorAll('.rec-row')].map(row => row.getAttribute('title')))
    .toEqual(expected.map(bookmark => bookmark.snapshot.text));
  expect([...document.querySelectorAll('.tiles b')].map(tile => tile.textContent))
    .toEqual([String(bookmarks.length), String(bookmarks.filter(b => b.folderIds.includes('inbox')).length)]);
  expect(document.querySelectorAll('.rec-dot.hollow')).toHaveLength(
    expected.filter(b => b.folderIds.includes('inbox')).length,
  );
  expect([...document.querySelectorAll('.rec-dot[title]')].map(dot => dot.getAttribute('title')))
    .toEqual(expected.filter(b => !b.folderIds.includes('inbox')).map(() => 'Sample Folder'));
  expect(bookmarks).toEqual(before);
});
