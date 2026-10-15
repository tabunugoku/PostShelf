// 版: v77
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { applyButtonMode, injectButtons, refreshAll } from '../src/content/buttons';
import * as snapshot from '../src/content/snapshot';
import { ownPostLink, queryAllFirst } from '../src/shared/selectors';
import { setAccountScope } from '../src/shared/storage';

const html = readFileSync('test/fixtures/v56-visible.html', 'utf8');

beforeEach(() => {
  const data = installChromeMock();
  Object.assign(data, {
    schemaVersion: 2,
    folderIdsRepaired: true,
    folders: [{
      id: 'sample_folder', accountId: 'me', name: 'Sample Folder', icon: 'ti-folder',
      color: '#E24B4A', order: 0,
    }],
    bookmarks: {
      'me:1': {
        accountId: 'me', tweetId: '1', savedAt: 1, folderIds: ['sample_folder'],
        snapshot: {
          text: '架空の保存済み本文。', author: 'Sample User', handle: '@sample_user',
          media: [], url: 'https://x.com/sample_user/status/1',
        },
      },
    },
  });
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  setAccountScope('me');
  document.body.innerHTML = html;
});

afterEach(() => {
  document.body.innerHTML = '';
  applyButtonMode('separate');
  resetAccount();
  vi.restoreAllMocks();
});

describe.each(['separate', 'replace'] as const)('記事の使い回し: %s', (buttonMode) => {
  const hostOf = () => document.querySelector<HTMLElement>(
    buttonMode === 'separate' ? '[data-postshelf-btn]' : '[data-postshelf-badge]',
  )!;
  const savedHostOf = () => buttonMode === 'separate' ? hostOf() : hostOf().parentElement!;

  // 実機未確認の前提: 同じ article と操作ボタンを残して、ポストへのリンクだけを別 ID に差し替える。
  it.each([
    ['1', '2'],
    ['2', '1'],
  ])('保存変更の通知なしで表示を更新する: %s → %s', async (initialId, nextId) => {
    const article = queryAllFirst(document, 'tweet').els[0];
    const link = ownPostLink(article).link!;
    link.setAttribute('href', '/sample_user/status/' + initialId);
    applyButtonMode(buttonMode);
    await refreshAll();
    const marker = hostOf();
    const host = savedHostOf();
    const badge = article.querySelector<HTMLElement>('[data-postshelf-badge]')!;
    expect(host.hasAttribute('data-saved')).toBe(initialId === '1');
    const get = vi.spyOn(chrome.storage.local, 'get');
    const set = vi.spyOn(chrome.storage.local, 'set');
    const extract = vi.spyOn(snapshot, 'extractTweet');

    link.setAttribute('href', '/sample_user/status/' + nextId);
    injectButtons();
    await vi.waitFor(() => {
      expect(host.hasAttribute('data-saved')).toBe(nextId === '1');
      expect(badge.textContent).toBe(nextId === '1' ? '1' : '');
      expect(badge.style.display).toBe(nextId === '1' ? 'block' : 'none');
      if (buttonMode === 'separate') {
        expect(host.style.color).toBe(nextId === '1' ? 'rgb(226, 75, 74)' : 'rgb(113, 118, 123)');
        expect(host.querySelector('i')!.className).toBe(
          nextId === '1' ? 'ti ti-folder-check' : 'ti ti-folder-plus',
        );
      }
    });
    expect(hostOf()).toBe(marker);
    expect(article.querySelectorAll('[data-postshelf-btn]')).toHaveLength(buttonMode === 'separate' ? 1 : 0);
    expect(article.querySelectorAll('[data-postshelf-badge]')).toHaveLength(1);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('同じ ID の記事は表示を作り直さない', async () => {
    applyButtonMode(buttonMode);
    await refreshAll();
    const render = vi.spyOn(savedHostOf(), 'toggleAttribute');
    injectButtons();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render).not.toHaveBeenCalled();
  });

  it('表示した ID の記録が無ければ既存の表示を作り直す', async () => {
    applyButtonMode(buttonMode);
    await refreshAll();
    const marker = hostOf();
    marker.removeAttribute('data-postshelf-tweet');
    const render = vi.spyOn(savedHostOf(), 'toggleAttribute');
    injectButtons();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(marker.getAttribute('data-postshelf-tweet')).toBe('1');
    expect(hostOf()).toBe(marker);
  });

  it('アカウント不明でも未保存表示の ID を記録して同じ記事は更新しない', async () => {
    resetAccount();
    applyButtonMode(buttonMode);
    await refreshAll();
    const marker = hostOf();
    expect(savedHostOf().hasAttribute('data-saved')).toBe(false);
    expect(marker.getAttribute('data-postshelf-tweet')).toBe('1');
    const render = vi.spyOn(savedHostOf(), 'toggleAttribute');
    injectButtons();
    await Promise.resolve();
    expect(render).not.toHaveBeenCalled();

    const article = queryAllFirst(document, 'tweet').els[0];
    ownPostLink(article).link!.setAttribute('href', '/sample_user/status/2');
    injectButtons();
    expect(marker.getAttribute('data-postshelf-tweet')).toBe('2');
    expect(savedHostOf().hasAttribute('data-saved')).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
