// 版: v77
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { noteAccount, onDataChanged, onLastSeenAccountChanged } from '../src/shared/storage';
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
  expect(set).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
  expect(lastSeen).toHaveBeenCalledTimes(1);
  expect(data.lastSeenAccount).toMatchObject({ id: 'me', lastSeenAt: 60_010 });
  unwatch();
  unlast();
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

it.each(['folders', 'bookmarks'])('%s があれば時刻だけの変化と同時でも通知する', async (key) => {
  data.accounts = { me: account() };
  const changed = vi.fn();
  const unwatch = onDataChanged(changed);
  await chrome.storage.local.set({ [key]: key === 'folders' ? [] : {}, accounts: { me: account('me', 20) } });
  expect(changed).toHaveBeenCalledTimes(1);
  await chrome.storage.local.set({ [key]: key === 'folders' ? [] : {} });
  expect(changed).toHaveBeenCalledTimes(2);
  unwatch();
});
