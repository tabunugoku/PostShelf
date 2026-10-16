// 版: v77
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
  setAccountScope('me');
  const account = { id: 'me', handle: 'me', lastSeenAt: 1 };
  Object.assign(data, {
    schemaVersion: 2,
    folderIdsRepaired: true,
    accounts: { me: account },
    lastSeenAccount: account,
    settings: { ...DEFAULT_SETTINGS, folderTreeCollapsed: [] },
    folders: [
      { id: 'sample_parent', accountId: 'me', name: '親の棚', icon: 'ti-folder', order: 0 },
      { id: 'sample_child', accountId: 'me', name: '子の棚', icon: 'ti-folder', order: 1,
        parentId: 'sample_parent' },
    ],
  });
  history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  render(null, document.getElementById('app')!);
  vi.restoreAllMocks();
});

it('木の初期読み出し中の変更も通知で読み直し、最後は保存済みの開閉状態になる', async () => {
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  const responses: (() => void)[] = [];
  let defer = true;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation((keys: unknown) => {
    const snapshot = get(keys as string);
    if (keys !== 'settings' || !defer) return snapshot;
    return new Promise((resolve) => {
      responses.push(async () => resolve(await snapshot));
    });
  });
  await act(() => void render(<App />, document.getElementById('app')!));
  const initialResponses = responses.splice(0);
  expect(initialResponses.length).toBeGreaterThan(0);
  await act(async () => {
    await chrome.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, folderTreeCollapsed: ['sample_parent'] },
    });
  });
  defer = false;
  await act(async () => initialResponses.forEach((respond) => respond()));
  await flush();
  await flush();
  expect(document.querySelector('[data-folder-id="sample_child"]')).not.toBeNull();
  await act(async () => responses.forEach((respond) => respond()));
  await flush();
  expect(document.querySelector('[data-folder-id="sample_parent"]')).not.toBeNull();
  expect(document.querySelector('[data-folder-id="sample_child"]')).toBeNull();
});
