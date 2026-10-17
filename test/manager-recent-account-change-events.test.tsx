// 版: v77
import { seedBookmarks } from './stored-bookmarks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import * as query from '../src/shared/query';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
let data: Record<string, unknown>;
let now: number;
const row = (id: string) => document.querySelector<HTMLElement>('[data-folder-id="' + id + '"]')!;
const recentCount = () => [...document.querySelectorAll('.fr')]
  .find((el) => el.querySelector('.fr-name')?.textContent === t('recent7'))!.querySelector('.n')!.textContent;

beforeEach(() => {
  data = installChromeMock();
  storage.setAccountScope('me');
  now = Date.parse('2026-10-15T00:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const account = { id: 'me', handle: 'me', lastSeenAt: now };
  Object.assign(data, {
    accounts: { me: account },
    lastSeenAccount: account,
    folders: [{ id: 'sample_folder', accountId: 'me', name: 'サンプルの棚', icon: 'ti-folder', order: 0 }],
  });
  seedBookmarks(data, Object.values({
      'me:1': {
        accountId: 'me',
        tweetId: '1',
        folderIds: ['sample_folder'],
        savedAt: now - query.RECENT_MS + 30_000,
        snapshot: { text: '七日の境目を確かめる架空の本文', author: 'サンプル', handle: '@sample_author',
          media: [], url: 'https://x.com/sample_author/status/1' },
      },
    }));
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', '/');
});
afterEach(() => {
  render(null, document.getElementById('app')!);
  vi.restoreAllMocks();
});

it.each([
  ['tab', query.RECENT_ID, 'noteAccount'],
  ['tab', 'sample_folder', 'noteAccount'],
  ['sidepanel', query.RECENT_ID, 'noteAccount'],
  ['sidepanel', 'sample_folder', 'noteAccount'],
  ['tab', query.RECENT_ID, 'accounts'],
  ['tab', 'sample_folder', 'accounts'],
  ['sidepanel', query.RECENT_ID, 'accounts'],
  ['sidepanel', 'sample_folder', 'accounts'],
] as const)('同じアカウントの通知で七日の一覧と件数だけを数え直す: %s / %s / %s', async (surface, folderId, source) => {
  data.settings = { ...DEFAULT_SETTINGS, lastFolderId: folderId };
  const get = vi.spyOn(chrome.storage.local, 'get');
  const lists = vi.spyOn(storage, 'listBookmarks');
  const summaries = vi.spyOn(storage, 'listBookmarksWithAccounts');
  const loads = vi.spyOn(storage, 'loadManagerData');
  const counts = vi.spyOn(query, 'countFolders');
  const recent = vi.spyOn(query, 'countFolder');
  const shown = vi.spyOn(query, 'queryBookmarks');
  await act(() => void render(<App surface={surface} />, document.getElementById('app')!));
  await flush();
  await flush();
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
  expect(recentCount()).toBe('1');
  expect(row('sample_folder').querySelector('.n')!.textContent).toBe('1');
  const reads = () => (get.mock.calls as unknown as [unknown][]).filter(([keys]) => keys === null
    || (Array.isArray(keys) && keys.some((key) => key.startsWith('bm:')))).length;
  const initialReads = reads();
  expect(initialReads).toBe(1);
  lists.mockClear();
  summaries.mockClear();
  loads.mockClear();
  counts.mockClear();
  recent.mockClear();
  shown.mockClear();

  now += 61_000;
  await act(async () => {
    if (source === 'accounts') {
      // 同じ投稿・フォルダの取り込みで、accounts の時刻だけが変わる場合。
      await chrome.storage.local.set({
        accounts: { me: { id: 'me', handle: 'me', lastSeenAt: now } },
      });
    } else {
      await storage.noteAccount({ handle: '@me' });
    }
  });
  await flush();
  expect(recentCount()).toBe('0');
  expect(document.querySelector('[data-row="1"]') === null).toBe(folderId === query.RECENT_ID);
  expect(document.querySelector('.bar-count')!.textContent)
    .toBe(t('itemCount', folderId === query.RECENT_ID ? 0 : 1));
  expect(row('sample_folder').querySelector('.n')!.textContent).toBe('1');
  expect(counts).not.toHaveBeenCalled();
  expect(recent).toHaveBeenCalledExactlyOnceWith(expect.any(Array), query.RECENT_ID, now);
  expect(shown).toHaveBeenCalledTimes(folderId === query.RECENT_ID ? 1 : 0);
  expect(lists).not.toHaveBeenCalled();
  expect(summaries).not.toHaveBeenCalled();
  expect(loads).not.toHaveBeenCalled();
  expect(reads()).toBe(initialReads);
});

it('x.com の通知がない間は時刻だけで七日の一覧と件数を作り直さない', async () => {
  data.settings = { ...DEFAULT_SETTINGS, lastFolderId: query.RECENT_ID };
  const shown = vi.spyOn(query, 'queryBookmarks');
  const recent = vi.spyOn(query, 'countFolder');
  await act(() => void render(<App />, document.getElementById('app')!));
  await flush();
  await flush();
  expect(recentCount()).toBe('1');
  shown.mockClear();
  recent.mockClear();
  now += 61_000;
  // 時刻の経過後に別の表示操作で再描画しても、通知なしでは境目を進めない。
  await act(() => document.querySelector<HTMLButtonElement>('.acct-btn')!.click());
  await flush();
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
  expect(recentCount()).toBe('1');
  expect(shown).not.toHaveBeenCalled();
  expect(recent).not.toHaveBeenCalled();
});
