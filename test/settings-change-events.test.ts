// 版: v77
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged } from '../src/shared/settings';

let data: Record<string, unknown>;
beforeEach(() => { data = installChromeMock(); });
afterEach(() => vi.restoreAllMocks());

it('設定の通知は購読者ごとに保存領域を読み直す', async () => {
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  const unwatch = callbacks.map((cb) => onSettingsChanged(cb));
  const get = vi.spyOn(chrome.storage.local, 'get');
  await chrome.storage.local.set({ settings: { buttonMode: 'replace', sidebarWidth: 300 } });
  await vi.waitFor(() => expect(callbacks[0]).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledTimes(3);
  for (const cb of callbacks) {
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, buttonMode: 'replace', sidebarWidth: 300 });
  }
  unwatch.forEach((stop) => stop());
});

it.each([
  { buttonMode: 'invalid', actionMode: false, viewMode: null, lastFolderId: 9,
    imageCache: { maxBytes: -1 }, autoCollect: { cap: -5, speed: 'invalid' },
    triageKeyFolders: ['sample_folder', 'sample_folder', 9], folderTreeCollapsed: [9, 'sample_folder'],
    recentFolderIds: ['all', 'sample_folder', 'sample_folder'], fullTextTabs: 7, sidebarWidth: -1 },
  { buttonMode: 'replace', fullText: false, imageCache: { enabled: true },
    autoCollect: { enabled: false, offers: { me: 'done', sample_other: 'invalid' } } },
])('通知の値ではなく読み直した保存値を補正する: %j', async (stored) => {
  data.settings = stored;
  const expected = await getSettings();
  const add = vi.spyOn(chrome.storage.onChanged, 'addListener');
  const cb = vi.fn();
  const unwatch = onSettingsChanged(cb);
  const listener = add.mock.calls[0][0];
  const get = vi.spyOn(chrome.storage.local, 'get');
  listener({ settings: { newValue: { sidebarWidth: 350 } } }, 'local');
  await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  expect(cb).toHaveBeenCalledWith(expected);
  expect(get).toHaveBeenCalledExactlyOnceWith('settings');
  unwatch();
});

it('設定を消した通知は読み直して既定値を渡す', async () => {
  data.settings = { buttonMode: 'replace' };
  const cb = vi.fn();
  const unwatch = onSettingsChanged(cb);
  const get = vi.spyOn(chrome.storage.local, 'get');
  await chrome.storage.local.remove('settings');
  await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(DEFAULT_SETTINGS));
  expect(get).toHaveBeenCalledExactlyOnceWith('settings');
  unwatch();
});

it('設定以外のキーと別の保存領域の通知では読まない', () => {
  const add = vi.spyOn(chrome.storage.onChanged, 'addListener');
  const cb = vi.fn();
  const unwatch = onSettingsChanged(cb);
  const listener = add.mock.calls[0][0];
  const get = vi.spyOn(chrome.storage.local, 'get');
  listener({ bookmarks: {} }, 'local');
  listener({ settings: {} }, 'session');
  expect(get).not.toHaveBeenCalled();
  expect(cb).not.toHaveBeenCalled();
  unwatch();
});
