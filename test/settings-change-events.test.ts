// 版: v77
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged } from '../src/shared/settings';

let data: Record<string, unknown>;
beforeEach(() => { data = installChromeMock(); });

it('設定の通知は購読者が複数いても保存領域を読み直さない', async () => {
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  const unwatch = callbacks.map((cb) => onSettingsChanged(cb));
  const get = vi.spyOn(chrome.storage.local, 'get');
  await chrome.storage.local.set({ settings: { buttonMode: 'replace', sidebarWidth: 300 } });
  await Promise.resolve();
  expect(get).not.toHaveBeenCalled();
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
])('通知の新しい値をgetSettingsと同じ規則で補正する: %j', async (stored) => {
  data.settings = stored;
  const expected = await getSettings();
  const add = vi.spyOn(chrome.storage.onChanged, 'addListener');
  const cb = vi.fn();
  const unwatch = onSettingsChanged(cb);
  const listener = add.mock.calls[0][0];
  // 通知後に別の保存があっても、通知が持つ値を渡す。
  data.settings = { sidebarWidth: 350 };
  const get = vi.spyOn(chrome.storage.local, 'get');
  listener({ settings: { newValue: stored } }, 'local');
  await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  expect(cb).toHaveBeenCalledWith(expected);
  expect(get).not.toHaveBeenCalled();
  unwatch();
});

it('設定を消した通知は既定値を渡す', async () => {
  data.settings = { buttonMode: 'replace' };
  const cb = vi.fn();
  const unwatch = onSettingsChanged(cb);
  const get = vi.spyOn(chrome.storage.local, 'get');
  await chrome.storage.local.remove('settings');
  await Promise.resolve();
  expect(cb).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  expect(get).not.toHaveBeenCalled();
  unwatch();
});
