import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as storage from '../src/shared/storage';
import * as snapshot from '../src/content/snapshot';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons, refreshAll } from '../src/content/buttons';
import { dropSavedCache, refreshCollectButton, collectVisible } from '../src/content/collect';
import { VisibleMediaBackfill } from '../src/content/media';
import { App } from '../src/manager/App';
import { updateSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
const click = async (element: HTMLElement) => {
  expect(element).not.toBeNull();
  await act(() => void element.click());
  await flush();
};
const body = { text: '架空の保存済み本文。', author: 'Sample User', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };
let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, {
    schemaVersion: 2, folderIdsRepaired: true,
    folders: [{ id: 'sample_folder', accountId: 'me', name: 'Sample Folder', icon: 'ti-folder', order: 0 }],
    bookmarks: { 'me:1': { accountId: 'me', tweetId: '1', savedAt: 1, folderIds: ['sample_folder'], snapshot: body } },
  });
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  storage.setAccountScope('me');
  document.body.innerHTML = readFileSync('test/fixtures/v56-visible.html', 'utf8');
});
afterEach(async () => {
  const app = document.getElementById('app');
  if (app) await act(() => void render(null, app));
  resetAccount();
  dropSavedCache();
  vi.restoreAllMocks();
});

it('ボタンの並行更新と同じ変更内の再表示で全件を 1 回だけ読む', async () => {
  const get = vi.spyOn(chrome.storage.local, 'get');
  injectButtons();
  await Promise.all([refreshAll(), refreshAll()]);
  await refreshAll();
  expect((get.mock.calls as unknown as [string][]).filter(([key]) => key === 'bookmarks')).toHaveLength(1);
  expect(document.querySelector('[data-postshelf-badge]')!.textContent).toBe('1');
  await chrome.storage.local.set({ bookmarks: {} });
  get.mockClear();
  await Promise.all([refreshAll(), refreshAll()]);
  expect((get.mock.calls as unknown as [string][]).filter(([key]) => key === 'bookmarks')).toHaveLength(1);
  expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(false);
});

it('ボタンの再表示で ID 取得だけのために本文や画像を抽出しない', async () => {
  const extract = vi.spyOn(snapshot, 'extractTweet');
  injectButtons();
  await refreshAll();
  expect(extract.mock.calls.length).toBe(0);
  expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(true);
});

it('取り込みボタンの並行更新で保存済み ID を 1 回だけ読む', async () => {
  document.body.insertAdjacentHTML('beforeend', '<button class="postshelf-collect"></button>');
  dropSavedCache();
  const get = vi.spyOn(chrome.storage.local, 'get');
  await Promise.all([refreshCollectButton(), refreshCollectButton(), refreshCollectButton()]);
  expect((get.mock.calls as unknown as [string][]).filter(([key]) => key === 'bookmarks')).toHaveLength(1);
  expect(document.querySelector<HTMLButtonElement>('.postshelf-collect')!.dataset.pending).toBe('0');
});

it('確認済みのポストしか無ければ無効化後も画像補完用の全件を読み直さない', async () => {
  const fillViews = vi.fn(storage.getFillViews);
  const visible = vi.fn(collectVisible);
  const media = new VisibleMediaBackfill({
    now: () => 0, accountId: () => 'me', path: () => '/home', visible,
    fillViews, backfill: storage.fillMissing,
  });
  const img = document.querySelector('img')!;
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48 });
  expect(await media.update()).toBe(1);
  media.invalidate();
  await media.update();
  expect(fillViews.mock.calls.length).toBe(1);
});

it('画面にポストが無ければ画像補完用の保存データを読まない', async () => {
  document.body.innerHTML = '';
  const fillViews = vi.fn(storage.getFillViews);
  const media = new VisibleMediaBackfill({
    now: () => 0, accountId: () => 'me', path: () => '/home', visible: collectVisible,
    fillViews, backfill: storage.fillMissing,
  });
  await media.update();
  expect(fillViews.mock.calls.length).toBe(0);
});

it('既定の画像補完は確認済みの画面を ID だけで判定する', async () => {
  const img = document.querySelector('img')!;
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48 });
  const media = new VisibleMediaBackfill();
  await media.update();
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const get = vi.spyOn(chrome.storage.local, 'get');
  media.invalidate();
  await media.update();
  expect(extract.mock.calls.length).toBe(0);
  expect((get.mock.calls as unknown as [string][]).filter(([key]) => key === 'bookmarks')).toHaveLength(0);
});

it('キャッシュ無効化前の遅い読み込みで新しい表示を上書きしない', async () => {
  injectButtons();
  await refreshAll();
  await chrome.storage.local.set({ bookmarks: {} });
  let resolve!: (bookmarks: Awaited<ReturnType<typeof storage.listBookmarks>>) => void;
  const delayed = new Promise<Awaited<ReturnType<typeof storage.listBookmarks>>>((done) => { resolve = done; });
  vi.spyOn(storage, 'listBookmarks').mockImplementationOnce(() => delayed);
  const oldRefresh = refreshAll();
  await chrome.storage.local.set({
    bookmarks: { 'me:1': { accountId: 'me', tweetId: '1', savedAt: 1, folderIds: ['sample_folder'], snapshot: body } },
  });
  await refreshAll();
  resolve([]);
  await oldRefresh;
  expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(true);
});

it('アカウントを切り替えたらボタンの所属キャッシュを使い回さない', async () => {
  injectButtons();
  await refreshAll();
  setCurrentAccount({ id: 'sample_other', handle: 'sample_other', lastSeenAt: 0 });
  await refreshAll();
  expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(false);
});

it('管理画面の一括変更と取り消しは書き込み後に全件を各 1 回だけ読む', async () => {
  await updateSettings({ viewAccount: 'me' });
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await act(() => void render(<App />, document.getElementById('app')!));
  await flush();
  await flush();
  let afterWrite = false;
  let reads = 0;
  const get = chrome.storage.local.get;
  const set = chrome.storage.local.set;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async (key: any) => {
    if (afterWrite && key === 'bookmarks') reads++;
    return get(key);
  });
  vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
    if ('bookmarks' in items) afterWrite = true;
    return set(items);
  });
  await click(document.querySelector<HTMLInputElement>('.sel')!);
  await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.menu-bulk button')]
    .find((b) => b.textContent?.trim() === text)!;
  await click(button(t('changeFolder')));
  await click(document.querySelector<HTMLInputElement>('.menu-bulk label input')!);
  await click(button(t('triageConfirm')));
  expect(reads).toBe(1);
  expect(data.bookmarks['me:1'].folderIds).toEqual(['inbox']);
  reads = 0;
  afterWrite = false;
  await click(document.querySelector<HTMLButtonElement>('.toast button')!);
  expect(reads).toBe(1);
  expect(data.bookmarks['me:1'].folderIds).toEqual(['sample_folder']);
  expect(document.querySelector('[data-row="1"]')).not.toBeNull();
});
