// 版: v77
import { seedBookmarks } from './stored-bookmarks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import type { Bookmark } from '../src/shared/models';

const bookmark = (accountId: string, tweetId: string): Bookmark => ({
  accountId, tweetId, savedAt: Number(tweetId), folderIds: ['sample_folder'],
  snapshot: { text: '架空の本文 ' + tweetId, author: 'サンプル', handle: '@sample_author',
    media: [], url: 'https://x.com/sample_author/status/' + tweetId },
});
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock();
  seedBookmarks(data, []);
  data.accounts = {
    me: { id: 'me', handle: 'me', lastSeenAt: 10 },
    sample_other: { id: 'sample_other', handle: 'sample_other', lastSeenAt: 20 },
    sample_unused: { id: 'sample_unused', handle: 'sample_unused', lastSeenAt: 100 },
  };
  data.lastSeenAccount = data.accounts.me;
  data.folders = ['me', 'sample_other', 'unknown'].map((accountId) => ({
    accountId, id: 'sample_folder', name: accountId + 'の棚', icon: 'ti-folder', order: 0,
  }));
  seedBookmarks(data, Object.values(Object.fromEntries([
    bookmark('me', '1'), bookmark('me', '2'), bookmark('sample_other', '3'), bookmark('unknown', '4'),
  ].map((b) => [b.accountId + ':' + b.tweetId, b]))));
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  render(null, document.getElementById('app')!);
  vi.restoreAllMocks();
});

it.each([
  ['tab', '', 'me', 'me', ['1', '2']],
  ['sidepanel', 'sample_other', 'me', 'sample_other', ['3']],
  ['tab', 'sample_missing', 'me', 'me', ['1', '2']],
  ['tab', '', null, 'sample_other', ['3']],
  ['sidepanel', '', 'sample_empty', 'sample_empty', []],
] as const)('初期表示で全件を各1回読み、選択と件数を保つ: %s / %s / %s', async (
  surface, manual, last, expectedAccount, expectedIds,
) => {
  if (surface === 'sidepanel') installPanelMock();
  if (last === null) delete data.lastSeenAccount;
  else data.lastSeenAccount = { id: last, handle: last, lastSeenAt: 30 };
  data.settings = { ...DEFAULT_SETTINGS, viewAccount: manual };
  const get = vi.spyOn(chrome.storage.local, 'get');
  await act(() => void render(<App surface={surface} />, document.getElementById('app')!));
  await flush();
  await flush();
  const calls = get.mock.calls as unknown as [string | string[] | null][];
  const reads = (key: string) => calls.filter(([keys]) => keys === null
    || keys === key || (Array.isArray(keys) && keys.includes(key))).length;
  expect(document.querySelector('.acct-btn')!.textContent).toContain('@' + expectedAccount);
  expect([...document.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row')).sort())
    .toEqual(expectedIds);
  expect(document.querySelector('.bar-count')!.textContent).toBe(t('itemCount', expectedIds.length));
  const names = [...document.querySelectorAll('.side .fr-name')].map((el) => el.textContent);
  if (expectedAccount !== 'sample_empty') expect(names).toContain(expectedAccount + 'の棚');
  expect(names).not.toContain((expectedAccount === 'me' ? 'sample_other' : 'me') + 'の棚');
  expect(reads('bm:me:1')).toBe(1);
  expect(reads('folders')).toBe(2);
  await act(() => void document.querySelector<HTMLButtonElement>('.acct-btn')!.click());
  await flush();
  const accounts = [...document.querySelectorAll('.acct-row')].map((row) => [
    row.querySelector('.fr-name')!.textContent, row.querySelector('.n')!.textContent,
  ]);
  expect(accounts).toEqual([
    ...(last === 'sample_empty' ? [['@sample_empty', '0']] : []),
    ['@sample_other', '1'], ['@me', '2'], [t('accountUnknownName'), '1'],
  ]);
});

it('共有した初期データは各アカウントの従来の一覧・木の順序・件数と一致する', async () => {
  data.folders.push(
    { accountId: 'me', id: 'sample_child', parentId: 'sample_folder', name: '子の棚', icon: 'ti-folder', order: 2 },
    { accountId: 'me', id: 'inbox', name: '', icon: 'ti-star', order: 9 },
  );
  const initial = await storage.loadManagerData();
  for (const id of ['me', 'sample_other', 'unknown', 'sample_empty']) {
    storage.setAccountScope(id);
    const expected = await storage.listBookmarksWithAccounts();
    expect(initial.accounts).toEqual(expected.accounts);
    expect(initial.forAccount(id)).toEqual({ bookmarks: expected.bookmarks, folders: await storage.listFolders() });
  }
  const get = vi.spyOn(chrome.storage.local, 'get');
  initial.forAccount('me');
  initial.forAccount('sample_other');
  expect(get).not.toHaveBeenCalled();
});

it('初期読み込み中の変更通知があれば最新データで最初の一覧を表示する', async () => {
  const load = storage.loadManagerData;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let loaded = false;
  vi.spyOn(storage, 'loadManagerData').mockImplementationOnce(async () => {
    const result = await load();
    loaded = true;
    await gate;
    return result;
  });
  await act(() => void render(<App />, document.getElementById('app')!));
  await vi.waitFor(() => expect(loaded).toBe(true));
  await act(async () => {
    await chrome.storage.local.set({ 'bm:me:5': bookmark('me', '5') });
  });
  await flush();
  await act(async () => release());
  await flush();
  expect([...document.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row')).sort())
    .toEqual(['1', '2', '5']);
  expect(document.querySelector('.bar-count')!.textContent).toBe(t('itemCount', 3));
});
