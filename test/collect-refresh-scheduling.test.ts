// 版: v78
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { dropSavedCache, ensureCollectButton, scheduleCollectRefresh } from '../src/content/collect';
import * as storage from '../src/shared/storage';
import * as settings from '../src/shared/settings';
import * as dialog from '../src/content/autocollectDialog';

const fixture = readFileSync('test/fixtures/content-read-ids.html', 'utf8');
const button = () => document.querySelector<HTMLButtonElement>('.postshelf-collect')!;

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  dropSavedCache();
  document.body.innerHTML = fixture;
  history.replaceState({}, '', '/home');
  vi.useFakeTimers();
  vi.spyOn(storage, 'getSavedIds').mockResolvedValue(new Set(['7502']));
  vi.spyOn(settings, 'getSettings').mockResolvedValue(settings.DEFAULT_SETTINGS);
  vi.spyOn(settings, 'recordPending').mockResolvedValue();
});
afterEach(() => {
  history.replaceState({}, '', '/home');
  scheduleCollectRefresh();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['/home', '/sample_user/status/1', '/search'])('%s で DOM が変化してもタイマーを張らない', async (path) => {
  history.replaceState({}, '', path);
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  for (let index = 0; index < 4; index++) {
    document.body.append(document.createElement('span'));
    scheduleCollectRefresh();
  }
  expect(timeout).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(storage.getSavedIds).not.toHaveBeenCalled();
  expect(settings.recordPending).not.toHaveBeenCalled();
  expect(button()).toBeNull();
});

it('一覧では連続する変化を最後の予約から 300ms 後の更新 1 回にまとめる', async () => {
  history.replaceState({}, '', '/i/history');
  ensureCollectButton();
  await vi.advanceTimersByTimeAsync(0);
  expect(button().dataset.pending).toBe('1');
  vi.mocked(settings.recordPending).mockClear();
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  const buttonBefore = button();
  scheduleCollectRefresh();
  await vi.advanceTimersByTimeAsync(200);
  scheduleCollectRefresh();
  scheduleCollectRefresh();
  expect(timeout).toHaveBeenCalledTimes(3);
  expect(timeout.mock.calls.every(([, delay]) => delay === 300)).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(299);
  expect(settings.recordPending).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(settings.recordPending).toHaveBeenCalledExactlyOnceWith('me', 1);
  expect(button()).toBe(buttonBefore);
  expect(button().textContent).toBe(chrome.i18n.getMessage('collectPending', ['1']));
  expect(button().disabled).toBe(false);
});

it('一覧を離れると予約を解除し、既存のボタンと確認ダイアログを片付ける', async () => {
  history.replaceState({}, '', '/i/history');
  ensureCollectButton();
  await vi.advanceTimersByTimeAsync(0);
  scheduleCollectRefresh();
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  const close = vi.spyOn(dialog, 'closeAutoCollectDialog');
  vi.mocked(settings.recordPending).mockClear();
  history.replaceState({}, '', '/home');
  scheduleCollectRefresh();
  expect(clear).toHaveBeenCalledOnce();
  expect(timeout).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(button()).toBeNull();
  expect(document.querySelector('.postshelf-autocollect')).toBeNull();
  expect(close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(300);
  expect(settings.recordPending).not.toHaveBeenCalled();
  // 再び一覧に戻る場合は、初回の即時表示と 300ms の予約の両方を保つ。
  history.replaceState({}, '', '/i/history');
  scheduleCollectRefresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(button().dataset.pending).toBe('1');
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(settings.recordPending).toHaveBeenCalledTimes(2);
});
