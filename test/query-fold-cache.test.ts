// 版: v76
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Bookmark } from '../src/shared/models';

const bookmark = (tweetId = '1', accountId = 'me'): Bookmark => ({
  accountId, tweetId, folderIds: ['sample'], savedAt: 1,
  snapshot: { text: '架空の Needle ＡＢＣ', author: 'Sample Author', handle: '@sample_search', media: [], url: '' },
});
const options = { folderId: 'all', search: 'needle', sort: 'savedDesc' as const };

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

it('同じ値の新しい snapshot は正規化し直さず、各欄の変更で作り直す', async () => {
  const folding = await import('../src/shared/fold');
  const fold = vi.spyOn(folding, 'foldText');
  const { queryBookmarks } = await import('../src/shared/query');
  let current = bookmark();
  queryBookmarks([current], options);
  expect(fold).toHaveBeenCalledTimes(4);
  fold.mockClear();
  current = { ...current, snapshot: { ...current.snapshot } };
  queryBookmarks([current], options);
  expect(fold).toHaveBeenCalledTimes(1); // 検索語だけ
  for (const field of ['text', 'author', 'handle'] as const) {
    fold.mockClear();
    current = { ...current, snapshot: { ...current.snapshot, [field]: current.snapshot[field] + ' changed' } };
    queryBookmarks([current], options);
    expect(fold).toHaveBeenCalledTimes(4);
  }
});

it('検索結果は変更前の区切りと正規化による検索と一致する', async () => {
  const { foldText, queryBookmarks } = await import('../src/shared/query');
  const all = [bookmark(), bookmark('2'), bookmark('1', 'sample_other')];
  all[1].snapshot = { ...all[1].snapshot, text: '別の架空の本文', author: 'Another Sample' };
  for (const search of ['needle', 'abc', 'AUTHOR', '@SAMPLE', '本文', 'missing', '']) {
    // 変更前の foldedOf と同じ検索対象。欄をまたぐ一致も比較する。
    const query = foldText(search.trim());
    const previous = all.filter((b) => [b.snapshot.text, b.snapshot.author, b.snapshot.handle]
      .map(foldText).join('\u0000').includes(query));
    expect(queryBookmarks(all, { ...options, search })).toEqual(previous);
  }
  all[0].snapshot.text = '更新後の架空の本文';
  expect(queryBookmarks(all, options)).toEqual([all[2]]);
});

it('上限で既存項目は更新でき、新しい項目が来たら全体を捨てる', async () => {
  const folding = await import('../src/shared/fold');
  const fold = vi.spyOn(folding, 'foldText');
  const { queryBookmarks } = await import('../src/shared/query');
  const all = Array.from({ length: 20000 }, (_, index) => bookmark(String(index)));
  queryBookmarks(all, options);
  all[0].snapshot.text += ' changed';
  queryBookmarks([all[0]], options);
  fold.mockClear();
  queryBookmarks([all[1]], options);
  expect(fold).toHaveBeenCalledTimes(1);
  queryBookmarks([bookmark('new')], options);
  fold.mockClear();
  queryBookmarks([all[1]], options);
  expect(fold).toHaveBeenCalledTimes(4);
});
