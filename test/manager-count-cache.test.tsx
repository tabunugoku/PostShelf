// 版: v76
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as query from '../src/shared/query';
import { setAccountScope } from '../src/shared/storage';
import { updateSettings } from '../src/shared/settings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));

afterEach(() => {
  render(null, document.body);
  vi.restoreAllMocks();
});

it('再描画では件数と七日の境界を保ち、保存データと祖先表示の変更で作り直す', async () => {
  const data = installChromeMock();
  setAccountScope('me');
  let now = Date.parse('2026-10-15T00:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const bookmark = {
    accountId: 'me', tweetId: '1', folderIds: ['sample'], savedAt: now - query.RECENT_MS + 100,
    snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_cache', media: [], url: '' },
  };
  Object.assign(data, {
    schemaVersion: 2, folderIdsRepaired: true, bookmarks: { 'me:1': bookmark },
    folders: [{ id: 'sample', accountId: 'me', name: 'Sample', icon: 'ti-folder', order: 0 }],
  });
  const count = vi.spyOn(query, 'countFolders');
  await act(() => void render(<App />, document.body));
  await flush();
  await flush();
  const recentCount = () => [...document.querySelectorAll('.fr')]
    .find((row) => row.querySelector('.fr-name')?.textContent === '直近 7 日')!.querySelector('.n')!.textContent;
  expect(recentCount()).toBe('1');
  count.mockClear();
  now += 1000;
  await act(() => {
    const search = document.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = '架空';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(count).not.toHaveBeenCalled();
  expect(recentCount()).toBe('1');
  await act(async () => { await chrome.storage.local.set({ bookmarks: { 'me:1': bookmark } }); });
  await flush();
  expect(count).toHaveBeenCalled();
  expect(recentCount()).toBe('0');
  count.mockClear();
  await act(async () => { await updateSettings({ showInAncestors: false }); });
  await flush();
  expect(count).toHaveBeenCalledTimes(1);
});

it('サイドパネルで七日の境界を越えて初めてメニューを開くと、その時刻で件数を数える', async () => {
  const data = installChromeMock();
  setAccountScope('me');
  let now = Date.parse('2026-10-15T00:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.assign(data, {
    schemaVersion: 2,
    folderIdsRepaired: true,
    bookmarks: {
      'me:1': {
        accountId: 'me',
        tweetId: '1',
        folderIds: ['inbox'],
        savedAt: now - query.RECENT_MS + 100,
        snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_cache', media: [], url: '' },
      },
    },
  });
  const counts = vi.spyOn(query, 'countFolders');
  const recent = vi.spyOn(query, 'countFolder');
  await act(() => void render(<App surface="sidepanel" />, document.body));
  await flush();
  await flush();
  expect(document.querySelector('.folder-btn')?.getAttribute('aria-expanded')).toBe('false');
  expect(recent).not.toHaveBeenCalled();
  counts.mockClear();

  now += 1000;
  await act(() => document.querySelector<HTMLButtonElement>('.folder-btn')!.click());
  const recentRow = () => [...document.querySelectorAll<HTMLButtonElement>('.menu-item')]
    .find((row) => row.querySelector('.fr-name')?.textContent === '直近 7 日')!;
  expect(recentRow().querySelector('.n')?.textContent).toBe('0');
  expect(counts).not.toHaveBeenCalled();
  expect(recent).toHaveBeenCalledTimes(1);
  expect(recent).toHaveBeenCalledWith(expect.any(Array), query.RECENT_ID, now);

  await act(() => recentRow().click());
  expect(document.querySelector('.folder-btn .muted')?.textContent).toBe('0');
  now += 1000;
  await act(() => document.querySelector<HTMLButtonElement>('.folder-btn')!.click());
  expect(recentRow().querySelector('.n')?.textContent).toBe('0');
  expect(recent).toHaveBeenCalledTimes(1);
});
