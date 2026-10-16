// 版: v78
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { applyButtonMode, injectButtons, refreshAll } from '../src/content/buttons';
import * as selectors from '../src/shared/selectors';
import { setAccountScope } from '../src/shared/storage';

const fixture = readFileSync('test/fixtures/v56-visible.html', 'utf8');
let articles: Element[];

function sampleArticle(id: string): Element {
  const template = document.createElement('template');
  template.innerHTML = fixture;
  const article = template.content.querySelector('article')!;
  selectors.ownPostLink(article).link!.setAttribute('href', '/sample_user/status/' + id);
  return article;
}

beforeEach(() => {
  const data = installChromeMock();
  const snapshot = {
    text: '架空の保存済み本文', author: 'Sample User', handle: '@sample_user', media: [], url: '',
  };
  Object.assign(data, {
    schemaVersion: 2, folderIdsRepaired: true,
    folders: [{ id: 'sample_folder', name: 'Sample Folder', icon: 'ti-folder', order: 0, accountId: 'me' }],
    bookmarks: Object.fromEntries(['1', '22', '5'].map(tweetId => ['me:' + tweetId, {
      accountId: 'me', tweetId, folderIds: ['sample_folder'], savedAt: 1, snapshot,
    }])),
  });
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  setAccountScope('me');
  articles = ['1', '2', '3', '4'].map(sampleArticle);
  selectors.queryFirst(articles[2], 'bookmarkButton')!.el.remove();
  document.body.replaceChildren(...articles);
});
afterEach(() => {
  document.body.replaceChildren();
  applyButtonMode('separate');
  resetAccount();
  vi.restoreAllMocks();
});

it.each(['separate', 'replace'] as const)('%s のボタン・バッジと更新対象の順番を保つ', async (mode) => {
  applyButtonMode(mode);
  await refreshAll();
  const markerSelector = mode === 'separate' ? '[data-postshelf-btn]' : '[data-postshelf-badge]';
  const markers = articles.map(article => article.querySelector(markerSelector));
  expect(markers[2]).toBeNull();
  expect(markers[0]!.getAttribute('data-postshelf-tweet')).toBe('1');
  selectors.ownPostLink(articles[1]).link!.setAttribute('href', '/sample_user/status/22');
  const added = sampleArticle('5');
  document.body.append(added);
  const query = vi.spyOn(selectors, 'queryFirst');
  const geometry = vi.spyOn(selectors, 'bookmarkButtonGeometry');
  const paint = vi.spyOn(HTMLElement.prototype, 'toggleAttribute');
  injectButtons();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const searched = query.mock.calls.filter(([, name]) => name === 'bookmarkButton').map(([article]) => article);
  expect(searched).toEqual(mode === 'separate' ? [articles[2], added] : [...articles, added]);
  const painted = paint.mock.calls.flatMap(([name], index) => name === 'data-saved'
    ? [(paint.mock.contexts[index] as HTMLElement).closest('article')] : []);
  expect(painted).toEqual([articles[1], added]);
  expect(geometry).toHaveBeenCalledTimes(mode === 'separate' ? 1 : 0);
  expect(articles.map(article => article.querySelector(markerSelector))).toEqual(markers);
  expect(markers[1]!.getAttribute('data-postshelf-tweet')).toBe('22');
  expect(added.querySelector(markerSelector)!.getAttribute('data-postshelf-tweet')).toBe('5');
  expect([...document.querySelectorAll('article')].map(article =>
    article.querySelector('[data-saved]') !== null)).toEqual([true, true, false, false, true]);
  expect([...document.querySelectorAll('article')].map(article =>
    article.querySelector('[data-postshelf-badge]')?.textContent ?? null)).toEqual(['1', '1', null, '', '1']);
  expect(document.querySelectorAll('[data-postshelf-btn]')).toHaveLength(mode === 'separate' ? 4 : 0);
  expect(document.querySelectorAll('[data-postshelf-badge]')).toHaveLength(4);
});

it('separate の再注入ではボタンの無い記事だけを検索し、既存の記事を更新しない', async () => {
  applyButtonMode('separate');
  await refreshAll();
  const query = vi.spyOn(selectors, 'queryFirst');
  const geometry = vi.spyOn(selectors, 'bookmarkButtonGeometry');
  const paint = vi.spyOn(HTMLElement.prototype, 'toggleAttribute');
  injectButtons();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(query.mock.calls.filter(([, name]) => name === 'bookmarkButton').map(([article]) => article))
    .toEqual([articles[2]]);
  expect(geometry).not.toHaveBeenCalled();
  expect(paint).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-postshelf-btn]')).toHaveLength(3);
});
