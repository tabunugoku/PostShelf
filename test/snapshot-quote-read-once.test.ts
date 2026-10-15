// 版: v75
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { extractTweet } from '../src/content/snapshot';
import * as selectors from '../src/shared/selectors';

afterEach(() => vi.restoreAllMocks());

it.each(['v46-tweet', 'v42-quote-detail', 'v42-nested-quote'])('引用の探索と結果を保つ: %s', (name) => {
  document.body.innerHTML = readFileSync('test/fixtures/' + name + '.html', 'utf8');
  const findQuote = vi.spyOn(selectors, 'findQuote');
  const result = extractTweet(document.querySelector('article')!);
  expect(result).toMatchSnapshot();
  expect(JSON.stringify(result)).toMatchSnapshot('項目順');
  expect(findQuote).toHaveBeenCalledTimes(1);
});
