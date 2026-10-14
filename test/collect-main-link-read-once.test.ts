// 版: v61-e
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as snapshot from '../src/content/snapshot';
import * as selectors from '../src/shared/selectors';
import { defaultDeps } from '../src/content/autocollect';
import { loadFixture } from './collector-helpers';
import { installChromeMock } from './chrome-mock';
import { setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v61-post-identities.html');
});

afterEach(() => vi.restoreAllMocks());

it.each([
  ['quoted-post', '6101'],
  ['reply-post', '6102'],
  ['reposted-post', '6103'],
])('%s は本体の ID と解析結果が一致する', (articleId, expectedId) => {
  const article = document.getElementById(articleId)!;
  expect(snapshot.tweetIdOf(article)).toBe(expectedId);
  expect(snapshot.extractTweet(article)?.tweetId).toBe(expectedId);
});

it.each(['excluded', 'only'])('%s で解析を省く記事の本体リンクは 1 回だけ読む', (filter) => {
  const ids = ['6101', '6102', '6103'];
  const articleIds = ['quoted-post', 'reply-post', 'reposted-post'];
  const link = vi.spyOn(selectors, 'ownPostLink');
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const deps = defaultDeps();
  const items = filter === 'excluded'
    ? deps.visible(new Set(ids))
    : deps.visible(undefined, new Set());
  expect(items).toEqual([]);
  expect(extract).not.toHaveBeenCalled();
  expect(link).toHaveBeenCalledTimes(articleIds.length);
  for (const articleId of articleIds) {
    expect(link.mock.calls.filter(([article]) => article.id === articleId)).toHaveLength(1);
  }
  expect(ids.map((id) => deps.visiblePosition!(id))).toEqual([1, 2, 3]);
});
