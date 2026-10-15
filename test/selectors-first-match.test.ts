// 版: v75
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CANDIDATES, queryAllFirst, queryAllInQuote, queryAllOwn,
  queryFirst, queryFirstInQuote, queryOwn, type Found, type FoundAll, type SelKey,
} from '../src/shared/selectors';

const fixtures = readdirSync('test/fixtures').filter((name) => name.endsWith('.html'));
const keys = Object.keys(CANDIDATES) as SelKey[];
afterEach(() => vi.restoreAllMocks());

function expectFirst(first: Found | null, all: FoundAll): void {
  expect(first?.el ?? null).toBe(all.els[0] ?? null);
  expect(first?.index ?? -1).toBe(all.index);
}

it.each(fixtures)('全記事・全キーで全件取得の先頭と候補番号が一致する: %s', (name) => {
  document.body.innerHTML = readFileSync('test/fixtures/' + name, 'utf8');
  for (const article of document.querySelectorAll('article')) {
    const quoteRoots = [article, ...queryAllFirst(article, 'quoteContainer').els];
    for (const key of keys) {
      expectFirst(queryFirst(article, key), queryAllFirst(article, key));
      expectFirst(queryOwn(article, key), queryAllOwn(article, key));
      for (const quote of quoteRoots) {
        expectFirst(queryFirstInQuote(quote, key), queryAllInQuote(quote, key));
      }
    }
  }
});

it.each(['own', 'quote', 'avatar', 'accountAvatar'] as const)('先頭の一致後に closest を呼ばない: %s', (kind) => {
  document.body.innerHTML = readFileSync('test/fixtures/v61-post-identities.html', 'utf8');
  const article = document.getElementById('reply-post')!;
  const key = kind === 'own' || kind === 'quote' ? 'userName' : kind;
  const candidate = queryAllFirst(article, key).els[0];
  const repeated = kind === 'avatar' ? candidate.parentElement! : candidate;
  for (let index = 0; index < 10; index++) article.append(repeated.cloneNode(true));
  const closest = vi.spyOn(Element.prototype, 'closest');
  const readAll = { own: queryAllOwn, quote: queryAllInQuote, avatar: queryAllFirst, accountAvatar: queryAllFirst };
  const readFirst = { own: queryOwn, quote: queryFirstInQuote, avatar: queryFirst, accountAvatar: queryFirst };
  const all = readAll[kind](article, key);
  const allCalls = closest.mock.calls.length;
  closest.mockClear();
  const first = readFirst[kind](article, key);
  expectFirst(first, all);
  expect(closest).toHaveBeenCalledTimes(1);
  expect(allCalls).toBeGreaterThan(closest.mock.calls.length);
});
