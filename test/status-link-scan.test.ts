// 版: v58-c
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CANDIDATES, hasTweetStatusLink } from '../src/shared/selectors';
import { loadFixture } from './collector-helpers';

beforeEach(() => loadFixture('v58-autocollect.html'));
afterEach(() => vi.restoreAllMocks());

it('最初に一致したリンクで走査を止め全リンクを配列へ展開しない', () => {
  const links = document.querySelectorAll(CANDIDATES.statusLink[0]);
  let visited = 0;
  Object.defineProperty(links, Symbol.iterator, {
    value: function* () {
      for (let index = 0; index < links.length; index++) {
        visited++;
        yield links[index];
      }
    },
  });
  vi.spyOn(document, 'querySelectorAll').mockReturnValue(links);
  expect(hasTweetStatusLink(document, '1201')).toBe(true);
  expect(visited).toBe(1);
});

it.each([['1201', true], ['1202', true], ['1203', true], ['120', false], ['9999', false]])
('ID %s の完全一致の意味を保つ', (id, found) => {
  expect(hasTweetStatusLink(document, id as string)).toBe(found);
});

it('絶対 URL と写真リンクを残存とみなしリンクがなければ false にする', () => {
  document.getElementById('main-status')!.setAttribute('href', 'https://x.com/sample_slow/status/1202?sample=1');
  expect(hasTweetStatusLink(document, '1202')).toBe(true);
  document.getElementById('main-post')!.remove();
  expect(hasTweetStatusLink(document, '1202')).toBe(false);
  const template = document.getElementById('late-photo') as HTMLTemplateElement;
  document.body.append(template.content.cloneNode(true));
  expect(hasTweetStatusLink(document, '1202')).toBe(true);
  document.body.replaceChildren();
  expect(hasTweetStatusLink(document, '1202')).toBe(false);
});
