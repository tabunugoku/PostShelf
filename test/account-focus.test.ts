// 版: v81
import { seedBookmarks } from './stored-bookmarks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getCurrentAccount,
  initAccount,
  refreshAccount,
  resetAccount,
  scheduleAccountCheck,
} from '../src/content/account';
import * as storage from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

let data: Record<string, unknown>;
let visible: DocumentVisibilityState;
let focused: boolean;
let stop: (() => void) | undefined;
const showAccount = (handle: string) => {
  document.body.innerHTML = `<div data-testid="SideNav_AccountSwitcher_Button"><span>@${handle}</span></div>`;
};
const settleNotes = async () => {
  await Promise.all(vi.mocked(storage.noteAccount).mock.results.map((result) => result.value));
};

beforeEach(() => {
  data = installChromeMock();
  seedBookmarks(data, []);
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  resetAccount();
  visible = 'visible';
  focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(storage, 'noteAccount');
  showAccount('sample_a');
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  resetAccount();
  await settleNotes();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('見えていてフォーカスのあるタブは画面のアカウントを記録する', async () => {
  refreshAccount();
  await settleNotes();
  expect(storage.noteAccount).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ handle: 'sample_a' }));
  expect(await storage.getLastSeenAccount()).toMatchObject({ id: 'sample_a' });
});

it.each(['hidden', 'unfocused'] as const)('%s のタブは DOM が変わっても判定だけを進める', async (state) => {
  visible = state === 'hidden' ? 'hidden' : 'visible';
  focused = state !== 'unfocused';
  stop = initAccount();
  await vi.advanceTimersByTimeAsync(0);
  for (const handle of ['sample_b', 'sample_c', 'sample_b']) {
    showAccount(handle);
    await vi.advanceTimersByTimeAsync(2000);
    expect(getCurrentAccount()?.id).toBe(handle);
    expect(storage.getAccountScope()).toBe(handle);
  }
  expect(storage.noteAccount).not.toHaveBeenCalled();
  expect(await storage.getLastSeenAccount()).toBeNull();
  expect(data.accounts).toBeUndefined();
});

it('フォーカスのない別アカウントのタブは最後に見たアカウントを上書きしない', async () => {
  refreshAccount();
  await settleNotes();
  focused = false;
  showAccount('sample_b');
  stop = initAccount();
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 3; index++) {
    showAccount('sample_b');
    await vi.advanceTimersByTimeAsync(2000);
  }
  expect(storage.noteAccount).toHaveBeenCalledTimes(1);
  expect(getCurrentAccount()?.id).toBe('sample_b');
  expect(await storage.getLastSeenAccount()).toMatchObject({ id: 'sample_a' });
  expect(Object.keys(data.accounts as object)).toEqual(['sample_a']);
});

it.each(['focus', 'visibilitychange'] as const)('%s で 2 秒を待たずに 1 回記録する', async (event) => {
  focused = false;
  visible = event === 'visibilitychange' ? 'hidden' : 'visible';
  stop = initAccount();
  await vi.advanceTimersByTimeAsync(0);
  expect(storage.noteAccount).not.toHaveBeenCalled();
  focused = true;
  visible = 'visible';
  const target = event === 'focus' ? window : document;
  target.dispatchEvent(new Event(event));
  await settleNotes();
  expect(Date.now()).toBe(100_000);
  expect(storage.noteAccount).toHaveBeenCalledTimes(1);
  expect(await storage.getLastSeenAccount()).toMatchObject({ id: 'sample_a' });
  expect(Object.keys(data.accounts as object)).toEqual(['sample_a']);
});

it.each(['hidden', 'unfocused'] as const)('%s のままの復帰イベントでは記録しない', async (state) => {
  visible = state === 'hidden' ? 'hidden' : 'visible';
  focused = state !== 'unfocused';
  stop = initAccount();
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(storage.noteAccount).not.toHaveBeenCalled();
  expect(getCurrentAccount()?.id).toBe('sample_a');
});

it('フォーカス復帰と予約済みの確認が重なっても同じ内容は 1 分以内に書き直さない', async () => {
  focused = false;
  stop = initAccount();
  await vi.advanceTimersByTimeAsync(0);
  scheduleAccountCheck();
  focused = true;
  window.dispatchEvent(new Event('focus'));
  await settleNotes();
  const set = vi.spyOn(chrome.storage.local, 'set');
  await vi.advanceTimersByTimeAsync(2000);
  await settleNotes();
  expect(storage.noteAccount).toHaveBeenCalledTimes(2);
  expect(set).not.toHaveBeenCalled();
  expect(await storage.getLastSeenAccount()).toMatchObject({ id: 'sample_a' });
});

it('フォーカスのあるタブ自身でアカウントを切り替えると次の確認で記録する', async () => {
  refreshAccount();
  await settleNotes();
  showAccount('sample_b');
  refreshAccount();
  await settleNotes();
  expect(getCurrentAccount()?.id).toBe('sample_b');
  expect(await storage.getLastSeenAccount()).toMatchObject({ id: 'sample_b' });
});

it('画面から読めなければ直前の判定と記録を保つ', async () => {
  refreshAccount();
  await settleNotes();
  const previous = getCurrentAccount();
  document.body.innerHTML = '';
  refreshAccount();
  expect(getCurrentAccount()).toBe(previous);
  expect(storage.noteAccount).toHaveBeenCalledTimes(1);
  expect(await storage.getLastSeenAccount()).toMatchObject({ id: 'sample_a' });
});

it('解除後は focus・visibilitychange・DOM の変化と予約済みの確認で判定しない', async () => {
  stop = initAccount();
  await vi.advanceTimersByTimeAsync(0);
  await settleNotes();
  scheduleAccountCheck();
  stop();
  showAccount('sample_b');
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(storage.noteAccount).toHaveBeenCalledTimes(1);
  expect(getCurrentAccount()?.id).toBe('sample_a');
});
