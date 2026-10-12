import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CANDIDATES, hasTweetStatusLink } from '../src/shared/selectors';

const original = CANDIDATES.statusLink;

beforeEach(() => {
  // 現在は候補が 1 つ。将来の追加候補を試すため、テストの間だけ候補を差し替える。
  Object.defineProperty(CANDIDATES, 'statusLink', {
    value: ['a[data-testid="sample-primary"][href*="/status/"]', 'a[href*="/status/"]'],
    configurable: true,
  });
  document.body.innerHTML = readFileSync('test/fixtures/v62-status-link.html', 'utf8');
});

afterEach(() => Object.defineProperty(CANDIDATES, 'statusLink', { value: original }));

it('先頭の候補に要素がなくても、2 番目の候補の status リンクを検出する', () => {
  expect(document.querySelector(CANDIDATES.statusLink[0])).toBeNull();
  expect(hasTweetStatusLink(document, '6201')).toBe(true);
});

it('どの候補にも対象 ID のリンクがなければ false を返す', () => {
  expect(hasTweetStatusLink(document, '6202')).toBe(false);
  document.body.replaceChildren();
  expect(hasTweetStatusLink(document, '6201')).toBe(false);
});

it('一致した候補で早期終了する', () => {
  document.querySelector('a')!.setAttribute('data-testid', 'sample-primary');
  const originalQuery = document.querySelectorAll.bind(document);
  const queries: string[] = [];
  document.querySelectorAll = ((selector: string) => {
    queries.push(selector);
    return originalQuery(selector);
  }) as typeof document.querySelectorAll;
  try {
    expect(hasTweetStatusLink(document, '6201')).toBe(true);
    expect(queries).toEqual([CANDIDATES.statusLink[0]]);
  } finally {
    document.querySelectorAll = originalQuery;
  }
});
