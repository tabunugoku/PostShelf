// 版: v77
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { applyButtonMode, initButtons } from '../src/content/buttons';
import { updateSettings } from '../src/shared/settings';
import * as settings from '../src/shared/settings';
import * as selectors from '../src/shared/selectors';
import * as popover from '../src/content/popover';

const health = vi.hoisted(() => ({ broken: false, notify: () => {} }));
vi.mock('../src/content/domwatch', () => ({ watchBody: () => () => {} }));
vi.mock('../src/content/health', () => ({
  isBroken: () => health.broken,
  subscribeHealth: (cb: () => void) => {
    health.notify = cb;
    return () => {};
  },
}));

let stop: (() => void) | undefined;
beforeEach(() => {
  installChromeMock();
  health.broken = false;
  document.body.innerHTML = '<article data-testid="tweet"><div><button data-testid="bookmark"></button></div></article>';
});
afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
});

it('ボタン以外の設定変更は走査せず、モード切替は両方向とも反映する', async () => {
  await updateSettings({ buttonMode: 'separate' });
  stop = initButtons();
  await vi.waitFor(() => expect(document.querySelector('[data-postshelf-btn]')).not.toBeNull());
  const scan = vi.spyOn(selectors, 'queryAllFirst');
  const apply = vi.spyOn(popover, 'setPopoverMode');
  await updateSettings({ sidebarWidth: 320, folderTreeCollapsed: ['sample_folder'] });
  expect(apply).not.toHaveBeenCalled();
  expect(scan).not.toHaveBeenCalled();
  await updateSettings({ buttonMode: 'replace' });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-postshelf-btn]')).toBeNull();
  expect(document.querySelector('[data-testid=bookmark] [data-postshelf-badge]')).not.toBeNull();
  await updateSettings({ buttonMode: 'separate' });
  expect(apply).toHaveBeenCalledTimes(2);
  expect(scan).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-postshelf-btn]')).not.toBeNull();
});

it('起動時と診断からの復帰は同じモードでも反映する', async () => {
  await updateSettings({ buttonMode: 'separate' });
  const apply = vi.spyOn(popover, 'setPopoverMode');
  stop = initButtons();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  health.broken = true;
  health.notify();
  expect(document.querySelector('[data-postshelf-btn]')).toBeNull();
  health.broken = false;
  health.notify();
  expect(apply).toHaveBeenCalledTimes(3);
  expect(document.querySelector('[data-postshelf-btn]')).not.toBeNull();
});

it.each([
  ['separate', 'replace'],
  ['replace', 'separate'],
] as const)('初期読み込みを待つ間の通知を古い値で上書きしない: %s → %s', async (initialMode, notifiedMode) => {
  applyButtonMode(initialMode);
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  const responses: (() => void)[] = [];
  vi.spyOn(chrome.storage.local, 'get').mockImplementation((keys: unknown) => {
    const snapshot = get(keys as string);
    if (keys !== 'settings') return snapshot;
    return new Promise((resolve) => {
      responses.push(async () => resolve(await snapshot));
    });
  });
  await chrome.storage.local.set({ settings: { ...settings.DEFAULT_SETTINGS, buttonMode: initialMode } });
  const apply = vi.spyOn(popover, 'setPopoverMode');
  stop = initButtons();
  await chrome.storage.local.set({ settings: { ...settings.DEFAULT_SETTINGS, buttonMode: notifiedMode } });
  expect(responses).toHaveLength(2);
  expect(apply).not.toHaveBeenCalled();
  responses[0]();
  await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(initialMode));
  responses[1]();
  await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(notifiedMode));
  expect(apply).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-postshelf-btn]') !== null).toBe(notifiedMode === 'separate');
  expect(document.querySelector('[data-testid=bookmark] [data-postshelf-badge]') !== null)
    .toBe(notifiedMode === 'replace');
});

it.each(['separate', 'replace'] as const)('通知が無ければ遅れた初期読み込みを反映する: %s', async (buttonMode) => {
  let finish!: (value: settings.Settings) => void;
  const initialRead = new Promise<settings.Settings>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(settings, 'getSettings').mockReturnValueOnce(initialRead);
  const apply = vi.spyOn(popover, 'setPopoverMode');
  stop = initButtons();
  expect(apply).not.toHaveBeenCalled();
  finish({ ...settings.DEFAULT_SETTINGS, buttonMode });
  await initialRead;
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenLastCalledWith(buttonMode);
});
