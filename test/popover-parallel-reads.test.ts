// 版: v78
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { openPopover } from '../src/content/popover';
import * as storage from '../src/shared/storage';
import * as settings from '../src/shared/settings';
import { ALL_FOLDER, type Bookmark } from '../src/shared/models';

const fixture = readFileSync('test/fixtures/save-menu.html', 'utf8');
const folders = [ALL_FOLDER, ...Array.from({ length: 8 }, (_, index) => ({
  id: 'f' + index, name: 'Sample ' + index, icon: 'ti-folder', order: index, accountId: 'me',
}))];
const bookmark: Bookmark = {
  accountId: 'me', tweetId: '1234567890', folderIds: ['f2', 'f5'], savedAt: 1,
  snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_menu', media: [], url: '' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function open() {
  const article = document.querySelector('article')!;
  return openPopover(article, article.querySelector('button')!);
}

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = fixture;
  vi.spyOn(storage, 'getCollapsedFolders').mockResolvedValue([]);
});
afterEach(() => {
  document.body.click();
  vi.restoreAllMocks();
});

it('最初の読み出しが未解決でも 3 つとも 1 回ずつ始まり、同時には 1 つしか開かない', async () => {
  const folderRead = deferred<typeof folders>();
  const bookmarkRead = deferred<Bookmark | undefined>();
  const settingsRead = deferred<settings.Settings>();
  const readFolders = vi.spyOn(storage, 'listFolders').mockReturnValue(folderRead.promise);
  const readBookmark = vi.spyOn(storage, 'getBookmark').mockReturnValue(bookmarkRead.promise);
  const readSettings = vi.spyOn(settings, 'getSettings').mockReturnValue(settingsRead.promise);
  const opening = open();
  const concurrent = open();
  expect(readFolders).toHaveBeenCalledOnce();
  expect(readBookmark).toHaveBeenCalledOnce();
  expect(readSettings).toHaveBeenCalledOnce();
  expect(document.querySelector('.postshelf-popover')).toBeNull();
  folderRead.resolve(folders);
  bookmarkRead.resolve(bookmark);
  settingsRead.resolve({ ...settings.DEFAULT_SETTINGS, recentFolderIds: ['f5', 'missing', 'f2', 'f7'] });
  const pop = (await opening)!;
  expect(await concurrent).toBeNull();
  expect(document.querySelectorAll('.postshelf-popover')).toHaveLength(1);
  const rows = [...pop.querySelectorAll<HTMLElement>('[data-picker-folder]')];
  expect(rows.map(row => row.dataset.pickerFolder)).toEqual(['inbox', 'f5', 'f2', 'f7', 'f0', 'f1', 'f3', 'f4', 'f6']);
  expect(rows.map(row => row.querySelector<HTMLInputElement>('input')!.checked))
    .toEqual([false, true, true, false, false, false, false, false, false]);
  expect(rows.map(row => row.querySelector('label')!.textContent)).toEqual([
    '未分類', 'Sample 5', 'Sample 2', 'Sample 7', 'Sample 0', 'Sample 1', 'Sample 3', 'Sample 4', 'Sample 6',
  ]);
});

it('最近使った ID が無い場合も組み込みを除く同じ一覧を表示する', async () => {
  vi.spyOn(storage, 'listFolders').mockResolvedValue(folders);
  vi.spyOn(storage, 'getBookmark').mockResolvedValue(undefined);
  vi.spyOn(settings, 'getSettings').mockResolvedValue({ ...settings.DEFAULT_SETTINGS, recentFolderIds: undefined });
  const pop = (await open())!;
  expect([...pop.querySelectorAll<HTMLElement>('[data-picker-folder]')].map(row => row.dataset.pickerFolder))
    .toEqual(['inbox', ...folders.slice(1).map(folder => folder.id)]);
  expect(pop.querySelectorAll('input:checked')).toHaveLength(0);
});

it.each(['folders', 'bookmark', 'settings'])('%s の読み出し失敗も以前と同じエラー表示になり、再度開ける', async (failed) => {
  const readFolders = vi.spyOn(storage, 'listFolders').mockResolvedValue(folders);
  const readBookmark = vi.spyOn(storage, 'getBookmark').mockResolvedValue(undefined);
  const readSettings = vi.spyOn(settings, 'getSettings').mockResolvedValue(settings.DEFAULT_SETTINGS);
  const error = new Error('読み出し失敗');
  if (failed === 'folders') readFolders.mockRejectedValueOnce(error);
  if (failed === 'bookmark') readBookmark.mockRejectedValueOnce(error);
  if (failed === 'settings') readSettings.mockRejectedValueOnce(error);
  const pop = (await open())!;
  expect(pop.getAttribute('role')).toBe('alert');
  expect(pop.textContent).toBe(chrome.i18n.getMessage('errorStorage'));
  expect((await open())!.getAttribute('role')).toBe('dialog');
});
