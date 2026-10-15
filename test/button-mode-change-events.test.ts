// 版: v77
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { initButtons } from '../src/content/buttons';
import { updateSettings } from '../src/shared/settings';
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
