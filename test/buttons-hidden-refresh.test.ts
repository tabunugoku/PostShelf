// 版: v79
import { seedBookmarks } from './stored-bookmarks';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initButtons, refreshAll } from '../src/content/buttons';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import * as storage from '../src/shared/storage';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock } from './chrome-mock';

const fixture = readFileSync('test/fixtures/v56-visible.html', 'utf8');
const readBookmarks = storage.listBookmarks;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
const bookmark = (tweetId: string, folderIds = ['sample_folder']): Bookmark => ({
  accountId: 'me',
  tweetId,
  folderIds,
  savedAt: 1,
  snapshot: {
    text: '架空の保存済み本文',
    author: 'サンプル',
    handle: '@sample_author',
    media: [],
    url: 'https://x.com/sample_author/status/' + tweetId,
  },
});
const folders: Folder[] = [
  { accountId: 'me', id: 'sample_folder', name: '架空の棚', icon: 'ti-folder', color: '#E24B4A', order: 0 },
  { accountId: 'me', id: 'sample_other', name: '別の棚', icon: 'ti-star', color: '#639922', order: 1 },
];
let data: Record<string, any>;
let stop: (() => void) | undefined;
let visibility: DocumentVisibilityState;
const setVisible = (next: DocumentVisibilityState) => {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
};
const start = async () => {
  stop = initButtons();
  await flush();
};
const save = async (folderIds: string[]) => {
  await chrome.storage.local.set({
    ...Object.fromEntries(['1', '2'].map((id) => ['bm:me:' + id, bookmark(id, folderIds)])),
  });
  await flush();
};
const expectSaved = (id: string, count: string, color?: string) => {
  const article = [...document.querySelectorAll('article')]
    .find((node) => node.querySelector('a')?.getAttribute('href')?.endsWith('/' + id))!;
  const host = article.querySelector<HTMLElement>('[data-postshelf-btn]')
    ?? article.querySelector<HTMLElement>('[data-testid="bookmark"]')!;
  expect(host.querySelector('[data-postshelf-badge]')!.textContent).toBe(count);
  expect(host.hasAttribute('data-saved')).toBe(count !== '');
  if (color) expect(host.style.color).toBe(color);
};
const watchReads = () => ({
  bookmarks: vi.spyOn(storage, 'listBookmarks').mockClear(),
  folders: vi.spyOn(storage, 'listFolders').mockClear(),
});
const expectReads = (reads: ReturnType<typeof watchReads>, count: number) => {
  expect(reads.bookmarks).toHaveBeenCalledTimes(count);
  expect(reads.folders).toHaveBeenCalledTimes(count);
};

beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, {
    folders,
    settings: { ...DEFAULT_SETTINGS, buttonMode: 'separate' },
  });
  seedBookmarks(data, Object.values({ 'me:1': bookmark('1') }));
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = fixture;
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  resetAccount();
  vi.restoreAllMocks();
});

it('保存データを1つだけ購読し、通知を1回だけ無効化処理へ渡す', async () => {
  const subscribe = vi.spyOn(storage, 'onDataChanged');
  await start();
  expect(subscribe.mock.calls.length).toBe(1);
  const listener = subscribe.mock.calls[0][0];
  const reads = watchReads();
  listener();
  await flush();
  expectReads(reads, 1);
});

it.each(['separate', 'replace'] as const)('見えるタブの%sを各1回の読み出しで更新する', async (mode) => {
  data.settings.buttonMode = mode;
  await start();
  const reads = watchReads();
  await chrome.storage.local.set({
    ...Object.fromEntries(Object.entries({ 'me:1': bookmark('1', ['sample_other', 'sample_folder']) }).map(([key, b]) => ['bm:' + key, b])),
    folders: folders.map((f) => ({ ...f, color: '#639922' })),
  });
  await flush();
  expectReads(reads, 1);
  expectSaved('1', '2', mode === 'separate' ? 'rgb(99, 153, 34)' : undefined);
});

it.each(['separate', 'replace'] as const)('見えない%sの3回の通知を可視化時に1回だけ読む', async (mode) => {
  data.settings.buttonMode = mode;
  await start();
  setVisible('hidden');
  const reads = watchReads();
  await save([]);
  await save(['sample_other', 'sample_folder']);
  await save(['sample_other']);
  expectReads(reads, 0);
  expectSaved('1', '1', mode === 'separate' ? 'rgb(226, 75, 74)' : undefined);
  setVisible('visible');
  await flush();
  expectReads(reads, 1);
  expectSaved('1', '1', mode === 'separate' ? 'rgb(99, 153, 34)' : undefined);
  setVisible('visible');
  await flush();
  expectReads(reads, 1);
});

it.each([false, true])('見えない間の新記事と可視化で同じ読み出しを使う (読み出し中: %s)', async (pending) => {
  await start();
  setVisible('hidden');
  await save(['sample_other', 'sample_folder']);
  const reads = watchReads();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  if (pending) {
    reads.bookmarks.mockImplementationOnce(async () => {
      const result = await readBookmarks();
      await gate;
      return result;
    });
  }
  document.body.insertAdjacentHTML('beforeend', fixture.replace('/status/1', '/status/2'));
  await flush();
  if (!pending) expectSaved('2', '2', 'rgb(226, 75, 74)');
  setVisible('visible');
  release();
  await flush();
  expectReads(reads, 1);
  expectSaved('1', '2', 'rgb(226, 75, 74)');
  expectSaved('2', '2', 'rgb(226, 75, 74)');
});

it('見えない間に通知が無ければ可視化しても読み直さない', async () => {
  await start();
  const reads = watchReads();
  setVisible('hidden');
  setVisible('visible');
  await flush();
  expectReads(reads, 0);
});

it('解除後は通知でも保留済みの可視化でも表示を更新しない', async () => {
  await start();
  setVisible('hidden');
  await save([]);
  stop!();
  stop = undefined;
  const reads = watchReads();
  setVisible('visible');
  await save(['sample_other']);
  expectReads(reads, 0);
  expectSaved('1', '1', 'rgb(226, 75, 74)');
});

it('onChangedを差し替えても新しい通知でキャッシュを捨てる', async () => {
  await start();
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
  const events = {
    addListener: (listener: any) => listeners.add(listener),
    removeListener: (listener: any) => listeners.delete(listener),
  };
  chrome.storage.onChanged = events as unknown as typeof chrome.storage.onChanged;
  await refreshAll();
  const reads = watchReads();
  seedBookmarks(data, Object.values({}));
  for (const listener of listeners) listener({ 'bm:me:1': { newValue: undefined } }, 'local');
  await flush();
  expectReads(reads, 1);
  expectSaved('1', '');
});

it('見えない読み出し中の通知で古い結果を捨て、可視化後は最新状態を残す', async () => {
  await start();
  setVisible('hidden');
  await save([]);
  let release!: (bookmarks: Bookmark[]) => void;
  const delayed = new Promise<Bookmark[]>((resolve) => { release = resolve; });
  vi.spyOn(storage, 'listBookmarks').mockImplementationOnce(() => delayed);
  const oldRefresh = refreshAll();
  await save(['sample_other']);
  setVisible('visible');
  await flush();
  release([]);
  await oldRefresh;
  expectSaved('1', '1', 'rgb(99, 153, 34)');
  const reads = watchReads();
  await refreshAll();
  expectReads(reads, 0);
});

it('可視化直後に通知が重なっても最後の状態になる', async () => {
  await start();
  setVisible('hidden');
  await save([]);
  setVisible('visible');
  await save(['sample_other']);
  expectSaved('1', '1', 'rgb(99, 153, 34)');
});

it('アカウント不明のタブは通知と可視化で全件を読まない', async () => {
  resetAccount();
  await start();
  const reads = watchReads();
  setVisible('hidden');
  await save(['sample_other']);
  setVisible('visible');
  await flush();
  expectReads(reads, 0);
  expectSaved('1', '');
});
