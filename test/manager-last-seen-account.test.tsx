// 版: v81
import { seedBookmarks } from './stored-bookmarks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { DEFAULT_SETTINGS, getSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import type { Account, Bookmark } from '../src/shared/models';
import { installChromeMock } from './chrome-mock';

const account = (id: string, lastSeenAt = 10): Account => ({ id, handle: id, lastSeenAt });
const bookmark: Bookmark = {
  accountId: 'me',
  tweetId: '1',
  savedAt: 10,
  folderIds: ['sample_folder'],
  snapshot: {
    text: 'アカウントの切り替えを確かめる架空の本文',
    author: 'サンプル',
    handle: '@sample_author',
    media: [],
    url: 'https://x.com/sample_author/status/1',
  },
};
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
const host = () => document.getElementById('app')!;
const mount = async (surface: 'tab' | 'sidepanel' = 'tab') => {
  await act(() => void render(<App surface={surface} />, host()));
  await flush();
  await flush();
};
const openAccounts = async () => {
  await act(() => document.querySelector<HTMLButtonElement>('.acct-btn')!.click());
  await flush();
};
const names = () => [...document.querySelectorAll('.acct-row .fr-name')].map((row) => row.textContent);
let data: Record<string, unknown>;

beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, {
    accounts: { me: account('me'), sample_empty: account('sample_empty', 20) },
    folders: [{ id: 'sample_folder', accountId: 'me', name: 'サンプルの棚', icon: 'ti-folder', order: 0 }],
    settings: { ...DEFAULT_SETTINGS, viewAccount: 'me' },
  });
  seedBookmarks(data, Object.values({ 'me:1': bookmark }));
  storage.setAccountScope('me');
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  render(null, host());
  vi.restoreAllMocks();
});

it('手動表示で初めての ID だけが届いてもアカウント一覧だけを読み直す', async () => {
  await mount();
  await openAccounts();
  expect(names()).toEqual(['@me']);
  const accounts = vi.spyOn(storage, 'listAccounts');
  const posts = vi.spyOn(storage, 'listBookmarksWithAccounts');
  const folders = vi.spyOn(storage, 'listFolders');
  await act(async () => {
    await chrome.storage.local.set({ lastSeenAccount: account('sample_empty', 30) });
  });
  await flush();
  expect(accounts).toHaveBeenCalledTimes(1);
  expect(posts).not.toHaveBeenCalled();
  expect(folders).not.toHaveBeenCalled();
  expect(names()).toEqual(['@sample_empty', '@me']);
  expect(document.querySelector('.acct-main[aria-checked=true] .fr-name')!.textContent).toBe('@me');
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
  expect((await getSettings()).viewAccount).toBe('me');
});

it('最後のアカウントの削除で保存 0 件の候補を外し、手動表示は保つ', async () => {
  data.lastSeenAccount = account('sample_empty', 30);
  await mount();
  await openAccounts();
  expect(names()).toEqual(['@sample_empty', '@me']);
  const accounts = vi.spyOn(storage, 'listAccounts');
  const posts = vi.spyOn(storage, 'listBookmarksWithAccounts');
  await act(async () => {
    await chrome.storage.local.remove('lastSeenAccount');
  });
  await flush();
  expect(accounts).toHaveBeenCalledTimes(1);
  expect(posts).not.toHaveBeenCalled();
  expect(names()).toEqual(['@me']);
  expect(document.querySelector('.acct-btn')!.textContent).toContain('@me');
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
});

it.each(['tab', 'sidepanel'] as const)('%s は別の ID に追従し、切替の通知と全件読み出しは 1 回だけ', async (surface) => {
  data.lastSeenAccount = account('me');
  await mount(surface);
  const posts = vi.spyOn(storage, 'listBookmarksWithAccounts');
  await act(async () => {
    await chrome.storage.local.set({ lastSeenAccount: account('sample_empty', 30) });
  });
  await flush();
  expect(posts).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.acct-btn')!.textContent).toContain('@sample_empty');
  expect(document.querySelector('[data-row="1"]')).toBeNull();
  expect(document.querySelector('.toast')!.textContent).toBe(t('accountSwitched', '@sample_empty'));
  expect((await getSettings()).viewAccount).toBe('');
});

it('時刻だけの定期通知ではアカウント一覧も保存データも読み直さない', async () => {
  data.lastSeenAccount = account('me');
  await mount();
  const accounts = vi.spyOn(storage, 'listAccounts');
  const posts = vi.spyOn(storage, 'listBookmarksWithAccounts');
  const initial = vi.spyOn(storage, 'loadManagerData');
  const get = vi.spyOn(chrome.storage.local, 'get');
  await act(async () => {
    await chrome.storage.local.set({ lastSeenAccount: account('me', 60_010) });
  });
  await flush();
  expect(accounts).not.toHaveBeenCalled();
  expect(posts).not.toHaveBeenCalled();
  expect(initial).not.toHaveBeenCalled();
  expect(get.mock.calls).toEqual([['lastSeenAccount']]);
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
});

it('自分の保存の読み出し中に初めての ID が届いても、完了後の候補を古い一覧に戻さない', async () => {
  await mount();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = storage.listBookmarksWithAccounts;
  let loaded = false;
  vi.spyOn(storage, 'listBookmarksWithAccounts').mockImplementationOnce(async () => {
    const result = await read();
    loaded = true;
    await gate;
    return result;
  });
  await act(() => document.querySelector<HTMLButtonElement>('[data-row="1"] .folder-chip-remove')!.click());
  await vi.waitFor(() => expect(loaded).toBe(true));
  await act(async () => {
    await chrome.storage.local.set({ lastSeenAccount: account('sample_empty', 30) });
  });
  await flush();
  await act(async () => release());
  await flush();
  await openAccounts();
  expect(names()).toEqual(['@sample_empty', '@me']);
  expect(document.querySelector('.acct-main[aria-checked=true] .fr-name')!.textContent).toBe('@me');
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
  expect((await storage.getBookmark('1'))!.folderIds).toEqual(['inbox']);
});
