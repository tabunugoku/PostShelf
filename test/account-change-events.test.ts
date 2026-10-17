// 版: v81
// 版: v77
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { noteAccount, onAccountsTouched, onDataChanged, onLastSeenAccountChanged } from '../src/shared/storage';
import { App } from '../src/manager/App';
import { DEFAULT_SETTINGS, getSettings } from '../src/shared/settings';
import type { Account } from '../src/shared/models';

const account = (id = 'me', lastSeenAt = 10): Account => ({ id, handle: id, lastSeenAt });
let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
  data.schemaVersion = 2;
  data.folderIdsRepaired = true;
});

it('同じアカウントの定期記録は保存を続け、データ変更だけを通知しない', async () => {
  await noteAccount({ handle: '@me' }, 10);
  const changed = vi.fn();
  const lastSeen = vi.fn();
  const unwatch = onDataChanged(changed);
  const unlast = onLastSeenAccountChanged(lastSeen);
  const set = vi.spyOn(chrome.storage.local, 'set');
  await noteAccount({ handle: '@me' }, 60_010);
  await noteAccount({ handle: '@me' }, 120_010);
  expect(set).toHaveBeenCalledTimes(2);
  expect(changed).not.toHaveBeenCalled();
  expect(lastSeen).toHaveBeenCalledTimes(2);
  expect(data.lastSeenAccount).toMatchObject({ id: 'me', lastSeenAt: 120_010 });
  unwatch();
  unlast();
});

it('accounts の時刻だけの変更も読み出しなしで通知し、解除できる', async () => {
  data.accounts = { me: account() };
  const touched = vi.fn();
  const changed = vi.fn();
  const lastSeen = vi.fn();
  const untouch = onAccountsTouched(touched);
  const unwatch = onDataChanged(changed);
  const unlast = onLastSeenAccountChanged(lastSeen);
  const get = vi.spyOn(chrome.storage.local, 'get');
  try {
    await chrome.storage.local.set({ accounts: { me: account('me', 20) } });
    expect(touched).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    expect(lastSeen).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    untouch();
    await chrome.storage.local.set({ accounts: { me: account('me', 30) } });
    expect(touched).toHaveBeenCalledTimes(1);
  } finally {
    untouch();
    unwatch();
    unlast();
  }
});

it('accounts の追加・情報変更・削除を通知し、別のキーと保存領域は無視する', async () => {
  const touched = vi.fn();
  const add = vi.spyOn(chrome.storage.onChanged, 'addListener');
  const untouch = onAccountsTouched(touched);
  const listener = add.mock.calls[0][0];
  try {
    listener({ accounts: { newValue: { me: account() } } }, 'sync');
    await chrome.storage.local.set({ lastSeenAccount: account() });
    expect(touched).not.toHaveBeenCalled();
    await chrome.storage.local.set({ accounts: { me: account() } });
    await chrome.storage.local.set({ accounts: { me: { ...account(), displayName: 'サンプル名' } } });
    await chrome.storage.local.remove('accounts');
    expect(touched).toHaveBeenCalledTimes(3);
  } finally {
    untouch();
  }
});

it('集合と順位が同じなら時刻だけの変化を通知しない', async () => {
  data.accounts = { me: account(), sample_other: account('sample_other', 5) };
  const changed = vi.fn();
  const unwatch = onDataChanged(changed);
  await chrome.storage.local.set({
    accounts: { sample_other: account('sample_other', 6), me: account('me', 20) },
  });
  expect(changed).not.toHaveBeenCalled();
  unwatch();
});

it.each([
  { me: { ...account(), displayName: 'サンプル名' } },
  { me: { ...account(), avatar: 'https://pbs.twimg.com/profile_images/sample/avatar.jpg' } },
  { me: { ...account(), handle: 'Me' } },
  { me: { ...account(), id: 'sample_changed' } },
  { me: account(), sample_other: account('sample_other') },
  {},
])('アカウント情報や集合が変われば通知する: %j', async (accounts) => {
  data.accounts = { me: account() };
  const changed = vi.fn();
  const unwatch = onDataChanged(changed);
  await chrome.storage.local.set({ accounts });
  expect(changed).toHaveBeenCalledTimes(1);
  unwatch();
});

it.each([[10, 5], [10, 8], [8, 10]])('順位または同順位が変われば通知する: %i → %i', async (before, after) => {
  data.accounts = { me: account('me', before), sample_other: account('sample_other', 8) };
  const changed = vi.fn();
  const unwatch = onDataChanged(changed);
  await chrome.storage.local.set({
    accounts: { me: account('me', after), sample_other: account('sample_other', 8) },
  });
  expect(changed).toHaveBeenCalledTimes(1);
  unwatch();
});

it('旧値または新値が無い通知も届ける', async () => {
  const changed = vi.fn();
  const unwatch = onDataChanged(changed);
  await chrome.storage.local.set({ accounts: { me: account() } });
  await chrome.storage.local.remove('accounts');
  expect(changed).toHaveBeenCalledTimes(2);
  unwatch();
});

it.each(['folders', 'bm:me:1'])('%s があれば時刻だけの変化と同時でも通知する', async (key) => {
  data.accounts = { me: account() };
  const changed = vi.fn();
  const unwatch = onDataChanged(changed);
  await chrome.storage.local.set({ [key]: key === 'folders' ? [] : {}, accounts: { me: account('me', 20) } });
  expect(changed).toHaveBeenCalledTimes(1);
  await chrome.storage.local.set({ [key]: key === 'folders' ? [] : {} });
  expect(changed).toHaveBeenCalledTimes(2);
  unwatch();
});

it('最後のアカウントが未記録でも、順位が同じ既存アカウントの読み取りは専用の通知だけを出す', async () => {
  data.accounts = { me: account(), sample_other: account('sample_other', 20) };
  const changed = vi.fn();
  const lastSeen = vi.fn();
  const unwatch = onDataChanged(changed);
  const unlast = onLastSeenAccountChanged(lastSeen);
  await noteAccount({ handle: '@sample_other' }, 30);
  expect(changed).not.toHaveBeenCalled();
  expect(lastSeen).toHaveBeenCalledTimes(1);
  unwatch();
  unlast();
});

it.each([
  [account(), account('sample_other')],
  [account(), undefined],
  [undefined, account()],
])('最後のアカウントの ID の変更・削除・追加は専用の通知だけを出す: %j → %j', async (before, after) => {
  data.lastSeenAccount = before;
  const changed = vi.fn();
  const lastSeen = vi.fn();
  const unwatch = onDataChanged(changed);
  const unlast = onLastSeenAccountChanged(lastSeen);
  if (after) await chrome.storage.local.set({ lastSeenAccount: after });
  else await chrome.storage.local.remove('lastSeenAccount');
  expect(changed).not.toHaveBeenCalled();
  expect(lastSeen).toHaveBeenCalledTimes(1);
  unwatch();
  unlast();
});

it('新しいアカウントと最後のアカウントの同時記録はデータ変更を 1 回だけ通知する', async () => {
  const changed = vi.fn();
  const lastSeen = vi.fn();
  const unwatch = onDataChanged(changed);
  const unlast = onLastSeenAccountChanged(lastSeen);
  await noteAccount({ handle: '@sample_new' }, 30);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(lastSeen).toHaveBeenCalledTimes(1);
  unwatch();
  unlast();
});

it('手動で選んだアカウントを保ち、初めて読み取った保存 0 件のアカウントもメニューに出す', async () => {
  data.accounts = { me: account(), sample_other: account('sample_other', 20) };
  data.folders = [{ accountId: 'me', id: 'sample_folder', name: 'サンプルの棚', icon: 'ti-folder', order: 0 }];
  data.settings = { ...DEFAULT_SETTINGS, viewAccount: 'me' };
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
  await act(() => void render(h(App, { surface: 'tab' }), document.getElementById('app')!));
  await flush();
  await flush();
  await act(() => void document.querySelector<HTMLButtonElement>('.acct-btn')!.click());
  const names = () => [...document.querySelectorAll('.acct-row .fr-name')].map((row) => row.textContent);
  expect(names()).toEqual(['@me']);
  await act(async () => {
    await noteAccount({ handle: '@sample_other' }, 30);
  });
  await flush();
  expect(names()).toEqual(['@sample_other', '@me']);
  expect(document.querySelector('.acct-main[aria-checked=true] .fr-name')!.textContent).toBe('@me');
  expect(document.querySelector('.acct-row .n')!.textContent).toBe('0');
  expect((await getSettings()).viewAccount).toBe('me');
});

afterEach(() => {
  const host = document.getElementById('app');
  if (host) render(null, host);
  vi.restoreAllMocks();
});
