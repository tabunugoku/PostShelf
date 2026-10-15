// 版: v77
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { updateSettings } from '../src/shared/settings';

vi.mock('../src/background/fulltext', () => ({
  FullTextQueue: class {},
  cleanupAtStartup: async () => {},
}));

beforeEach(() => {
  installChromeMock();
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it('無関係な設定変更ではAPIを呼ばず、両方向の切替は反映する', async () => {
  installPanelMock();
  const behavior = vi.spyOn(chrome.sidePanel, 'setPanelBehavior');
  const popup = vi.spyOn(chrome.action, 'setPopup');
  await import('../src/background/index');
  await flush();
  expect(behavior).toHaveBeenCalledTimes(1);
  expect(popup).toHaveBeenCalledTimes(1);
  behavior.mockClear();
  popup.mockClear();
  await updateSettings({ sidebarWidth: 320, buttonMode: 'replace' });
  await flush();
  expect(behavior).not.toHaveBeenCalled();
  expect(popup).not.toHaveBeenCalled();
  await updateSettings({ actionMode: 'sidepanel' });
  await flush();
  expect(behavior).toHaveBeenCalledTimes(1);
  expect(popup).toHaveBeenCalledTimes(1);
  expect(popup).toHaveBeenLastCalledWith({ popup: '' });
  await updateSettings({ actionMode: 'popup' });
  await flush();
  expect(behavior).toHaveBeenCalledTimes(2);
  expect(popup).toHaveBeenCalledTimes(2);
  expect(popup).toHaveBeenLastCalledWith({ popup: 'popup.html' });
});

it.each(['onInstalled', 'onStartup'] as const)('%sは同じ値も再適用して記憶する', async (event) => {
  installPanelMock();
  Object.assign(chrome.runtime, { onStartup: { addListener: vi.fn() } });
  const add = vi.spyOn(chrome.runtime[event], 'addListener');
  const popup = vi.spyOn(chrome.action, 'setPopup');
  await import('../src/background/index');
  await flush();
  popup.mockClear();
  // 通知を経ずに変わった保存値も、起動イベントでは必ず反映する。
  const settings = await import('../src/shared/settings');
  vi.spyOn(settings, 'getSettings').mockResolvedValue({ ...settings.DEFAULT_SETTINGS, actionMode: 'sidepanel' });
  const apply = add.mock.calls[0][0] as () => void;
  apply();
  await flush();
  apply();
  await flush();
  expect(popup).toHaveBeenCalledTimes(2);
  expect(popup).toHaveBeenLastCalledWith({ popup: '' });
  await chrome.storage.local.set({ settings: { actionMode: 'sidepanel', sidebarWidth: 320 } });
  await flush();
  expect(popup).toHaveBeenCalledTimes(2);
});

it('起動時の読み込みより先の通知は未反映として適用する', async () => {
  installPanelMock();
  const settings = await import('../src/shared/settings');
  let finish!: (value: typeof settings.DEFAULT_SETTINGS) => void;
  vi.spyOn(settings, 'getSettings').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const popup = vi.spyOn(chrome.action, 'setPopup');
  await import('../src/background/index');
  await chrome.storage.local.set({ settings: { actionMode: 'popup' } });
  await flush();
  expect(popup).toHaveBeenCalledTimes(1);
  finish(settings.DEFAULT_SETTINGS);
  await flush();
  expect(popup).toHaveBeenCalledTimes(2);
});

it('起動時のAPI失敗後は次の通知で同じモードも再試行する', async () => {
  installPanelMock();
  const behavior = vi.spyOn(chrome.sidePanel, 'setPanelBehavior')
    .mockRejectedValueOnce(new Error('テスト用の失敗'));
  const popup = vi.spyOn(chrome.action, 'setPopup');
  await import('../src/background/index');
  await flush();
  expect(behavior).toHaveBeenCalledTimes(1);
  expect(popup).not.toHaveBeenCalled();
  await updateSettings({ sidebarWidth: 320 });
  await flush();
  expect(behavior).toHaveBeenCalledTimes(2);
  expect(popup).toHaveBeenCalledWith({ popup: 'popup.html' });
});
