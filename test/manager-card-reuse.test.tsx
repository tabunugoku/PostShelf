// 版: v79
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { App } from '../src/manager/App';
import { Card } from '../src/manager/Cards';
import * as storage from '../src/shared/storage';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock } from './chrome-mock';
import { t } from '../src/shared/strings';
import * as reuse from '../src/manager/reuse';

const bookmark = (tweetId: string, accountId = 'me'): Bookmark => ({
  accountId,
  tweetId,
  savedAt: Number(tweetId),
  folderIds: ['sample_folder'],
  snapshot: {
    text: '架空の本文 ' + tweetId,
    author: 'サンプル',
    handle: '@sample_author',
    media: [],
    url: 'https://x.com/sample_author/status/' + tweetId,
  },
});
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-row]')];
const ids = () => rows().map((row) => row.dataset.row);
let data: Record<string, any>;
let painted: MockInstance<typeof Card.prototype.render>;
const reload = async (items: Record<string, unknown>) => {
  await act(async () => { await chrome.storage.local.set(items); });
  await flush();
};
const mount = async () => {
  await act(() => void render(<App />, document.body));
  await flush();
  await flush();
  painted.mockClear();
};

beforeEach(() => {
  data = installChromeMock();
  const account = { id: 'me', handle: 'me', lastSeenAt: 10 };
  Object.assign(data, {
    accounts: { me: account },
    lastSeenAccount: account,
    settings: { ...DEFAULT_SETTINGS, viewMode: 'list' },
    folders: [
      { accountId: 'me', id: 'sample_folder', name: '架空の棚', icon: 'ti-folder', order: 0 },
      { accountId: 'me', id: 'sample_other', name: '別の棚', icon: 'ti-star', order: 1 },
    ],
  });
  seedBookmarks(data, Object.values(Object.fromEntries(Array.from({ length: 50 }, (_, index) => {
      const b = bookmark(String(index + 1));
      return ['me:' + b.tweetId, b];
    }))));
  storage.setAccountScope('me');
  history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  painted = vi.spyOn(Card.prototype, 'render');
});
afterEach(() => {
  render(null, document.body);
  vi.restoreAllMocks();
});

it('50件のうち所属が変わったカードだけを描き直す', async () => {
  await mount();
  expect(rows()).toHaveLength(50);
  storedBookmarks(data)['me:25'].folderIds = ['sample_other'];
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])) });
  expect(painted.mock.calls.map(([props]) => props.b.tweetId)).toEqual(['25']);
  expect(document.querySelector('[data-row="25"]')!.textContent).toContain('別の棚');
});

it('同じ読み直しは配列と要素の参照を保ち、カードを描き直さない', async () => {
  const bookmarks = vi.spyOn(reuse, 'reuseBookmarks');
  const folders = vi.spyOn(reuse, 'reuseFolders');
  await mount();
  const previousBookmarks = bookmarks.mock.results.at(-1)!.value;
  const previousFolders = folders.mock.results.at(-1)!.value;
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])), folders: data.folders });
  expect(painted.mock.calls.length).toBe(0);
  expect(bookmarks.mock.results.at(-1)!.value).toBe(previousBookmarks);
  expect(folders.mock.results.at(-1)!.value).toBe(previousFolders);
});

it.each(['name', 'color', 'order'] as const)('フォルダの%sの変更を全カードに反映する', async (field) => {
  await mount();
  const folder: Folder = data.folders[0];
  if (field === 'name') folder.name = '変更後の棚';
  if (field === 'color') folder.color = '#E24B4A';
  if (field === 'order') folder.order = 2;
  await reload({ folders: data.folders });
  expect(painted).toHaveBeenCalledTimes(50);
  for (const [props] of painted.mock.calls) {
    expect(props.folders!.find((f) => f.id === folder.id)?.[field]).toBe(folder[field]);
  }
  if (field === 'name') expect(rows().every((row) => row.textContent!.includes('変更後の棚'))).toBe(true);
  if (field === 'order') {
    expect([...document.querySelectorAll('.side .fr-name')].map((node) => node.textContent).slice(-2))
      .toEqual(['別の棚', '架空の棚']);
  }
});

it.each(['text', 'media', 'savedAt'] as const)('%sの更新は該当のカードだけに反映する', async (field) => {
  if (field === 'media') data.settings.viewMode = 'grid';
  await mount();
  const changed: Bookmark = storedBookmarks(data)['me:25'];
  if (field === 'text') changed.snapshot.text = '架空の長い本文を取得した結果';
  if (field === 'media') changed.snapshot.media = ['https://pbs.twimg.com/media/sample_image.jpg'];
  if (field === 'savedAt') changed.savedAt = 25.5;
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])) });
  expect(painted.mock.calls.map(([props]) => props.b)).toEqual([changed]);
  if (field === 'text') expect(document.querySelector('[data-row="25"]')!.textContent).toContain(changed.snapshot.text);
  if (field === 'media') expect(document.querySelector('[data-row="25"] .ph')).toBeTruthy();
});

it('同じ内容の読み直しでも直近7日の一覧と件数の時刻を更新する', async () => {
  const now = Date.parse('2026-10-15T00:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  seedBookmarks(data, Object.values({ 'me:1': { ...bookmark('1'), savedAt: now - 7 * 24 * 60 * 60 * 1000 + 100 } }));
  await mount();
  await act(() => [...document.querySelectorAll<HTMLButtonElement>('.side .fr')]
    .find((button) => button.textContent?.includes(t('recent7')))!.click());
  expect(ids()).toEqual(['1']);
  vi.mocked(Date.now).mockReturnValue(now + 1000);
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])) });
  expect(ids()).toEqual([]);
  expect(document.querySelector('.bar-count')!.textContent).toBe(t('itemCount', 0));
});

it('追加・削除・並べ替えで件数と順序を保ち、消えた選択を外す', async () => {
  await mount();
  await act(() => document.querySelector<HTMLInputElement>('[data-row="25"] .sel')!.click());
  seedBookmarks(data, [...Object.values(storedBookmarks(data)).filter((b) => b.tweetId !== '25'), bookmark('51')]);
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])) });
  expect(ids()).toEqual(Array.from({ length: 51 }, (_, index) => String(51 - index)).filter((id) => id !== '25'));
  expect(document.querySelector('.bulk-btn')).toBeNull();
  expect(document.querySelector('.bar-count')!.textContent).toBe(t('itemCount', 50));
  await act(() => document.querySelector<HTMLButtonElement>('.sort-btn')!.click());
  await act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((button) => button.textContent?.includes(t('sortSavedAsc')))!.click());
  expect(ids()).toEqual(Array.from({ length: 51 }, (_, index) => String(index + 1)).filter((id) => id !== '25'));
});

it('同じポストIDでもアカウントを替えたら前の一覧を残さない', async () => {
  const other = bookmark('25', 'sample_other');
  other.snapshot.text = '別アカウントの架空の本文';
  seedBookmarks(data, [...Object.values(storedBookmarks(data)), other]);
  data.accounts.sample_other = { id: 'sample_other', handle: 'sample_other', lastSeenAt: 20 };
  await mount();
  await act(() => document.querySelector<HTMLButtonElement>('.acct-btn')!.click());
  await act(() => [...document.querySelectorAll<HTMLButtonElement>('.acct-main')]
    .find((button) => button.textContent?.includes('@sample_other'))!.click());
  await flush();
  expect(ids()).toEqual(['25']);
  expect(rows()[0].textContent).toContain(other.snapshot.text);
});

it('重なった読み直しの古い結果があとに届いても最新の一覧を保つ', async () => {
  await mount();
  const read = storage.listBookmarksWithAccounts;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let loaded = false;
  vi.spyOn(storage, 'listBookmarksWithAccounts').mockImplementationOnce(async () => {
    const result = await read();
    loaded = true;
    await gate;
    return result;
  });
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])) });
  expect(loaded).toBe(true);
  storedBookmarks(data)['me:25'].snapshot.text = '新しい架空の本文';
  await reload({ ...Object.fromEntries(Object.entries(storedBookmarks(data)).map(([key, b]) => ['bm:' + key, b])) });
  await act(async () => release());
  await flush();
  expect(document.querySelector('[data-row="25"]')!.textContent).toContain('新しい架空の本文');
});
