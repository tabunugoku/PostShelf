// 版: v75
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findArticle, handleMessage } from '../src/content/messages';
import { queryAllFirst } from '../src/shared/selectors';
import * as snapshot from '../src/content/snapshot';

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  document.body.innerHTML = readFileSync('test/fixtures/content-read-ids.html', 'utf8');
});

it.each(['7501', '7502', '7503', '7599', 'missing'])('従来と同じ記事を ID だけで探す: %s', (tweetId) => {
  const expected = queryAllFirst(document, 'tweet').els.find((article) =>
    snapshot.extractTweet(article)?.tweetId === tweetId) ?? null;
  const extract = vi.spyOn(snapshot, 'extractTweet');
  expect(findArticle(tweetId)).toBe(expected);
  expect(extract).not.toHaveBeenCalled();
});

it('重複 ID では先頭の記事を返す', () => {
  const extract = vi.spyOn(snapshot, 'extractTweet');
  expect(findArticle('7501')).toBe(document.getElementById('first-duplicate'));
  expect(extract).not.toHaveBeenCalled();
});

it('応答用の snapshot は一致した記事だけから作り、内容を保つ', () => {
  const article = document.getElementById('first-duplicate')!;
  const expected = snapshot.extractTweet(article)!;
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const respond = vi.fn();
  expect(handleMessage({ type: 'getPostSnapshot', tweetId: '7501' }, respond)).toBe(false);
  expect(respond).toHaveBeenCalledWith({ ok: true, tweetId: expected.tweetId, snapshot: expected.snapshot });
  expect(extract).toHaveBeenCalledExactlyOnceWith(article);
});
