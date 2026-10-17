// 版: v77
import { seedBookmarks } from './stored-bookmarks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import type { Bookmark } from '../src/shared/models';
import { t } from '../src/shared/strings';
import { clearStorageError } from '../src/manager/errorBus';
import { installChromeMock } from './chrome-mock';

const bookmark = (tweetId: string): Bookmark => ({
  accountId: 'me',
  tweetId,
  folderIds: ['sample_folder'],
  savedAt: Number(tweetId),
  snapshot: {
    text: '架空の本文 ' + tweetId,
    author: 'サンプル',
    handle: '@sample_author',
    media: [],
    url: 'https://x.com/sample_author/status/' + tweetId,
  },
});
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const click = async (target: HTMLElement) => {
  expect(target).toBeTruthy();
  await act(() => void target.click());
  await flush();
};
const button = (selector: string, text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(selector)].find((item) => item.textContent?.trim() === text)!;
const folderBox = (selector: string, name: string) =>
  [...document.querySelectorAll(selector)].find((label) => label.textContent === name)!
    .querySelector<HTMLInputElement>('input')!;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const readBookmarks = storage.listBookmarksWithAccounts;
const holdReload = () => {
  const gate = deferred();
  let loaded = false;
  const read = vi.spyOn(storage, 'listBookmarksWithAccounts').mockImplementationOnce(async () => {
    const result = await readBookmarks();
    loaded = true;
    await gate.promise;
    return result;
  });
  return { read, release: gate.resolve, loaded: () => loaded };
};
const saveExternally = async () => {
  // 別タブでの保存を模し、共有ストレージの変更通知を実際の購読者へ送る。
  await act(async () => {
    await chrome.storage.local.set({ 'bm:me:3': bookmark('3') });
  });
  await flush();
};
const expectPosts = (ids: string[]) => {
  expect([...document.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row')).sort())
    .toEqual(ids);
  expect(element('.bar-count').textContent).toBe(t('itemCount', ids.length));
  const allRow = [...document.querySelectorAll('.side .fr')]
    .find((row) => row.querySelector('.fr-name')?.textContent === t('allFolderName'))!;
  expect(allRow.querySelector('.n')!.textContent).toBe(String(ids.length));
};
const prepareBulk = async () => {
  await click(element('[data-row="1"] .sel'));
  await click(element('.bulk-btn'));
  await click(button('.menu-bulk button', t('changeFolder')));
  await click(folderBox('.menu-bulk label', '別の棚'));
  return () => click(element('.menu-bulk .triage-confirm'));
};
type Operation = 'run' | 'doUndo' | 'dropdown';
const prepareOperation = async (operation: Operation) => {
  if (operation === 'run') return prepareBulk();
  if (operation === 'doUndo') {
    const confirm = await prepareBulk();
    await confirm();
    return () => click(element('.toast button'));
  }
  await click(element('[data-row="1"] [aria-label="' + t('changeFolder') + '"]'));
  return () => click(folderBox('.menu-wide label', '別の棚'));
};

let data: Record<string, any>;
beforeEach(async () => {
  data = installChromeMock();
  const account = { id: 'me', handle: 'me', lastSeenAt: 10 };
  Object.assign(data, {
    accounts: { me: account },
    lastSeenAccount: account,
    folders: [
      { id: 'sample_folder', accountId: 'me', name: '元の棚', icon: 'ti-folder', order: 0 },
      { id: 'sample_other', accountId: 'me', name: '別の棚', icon: 'ti-star', order: 1 },
    ],
  });
  seedBookmarks(data, Object.values({ 'me:1': bookmark('1'), 'me:2': bookmark('2') }));
  storage.setAccountScope('me');
  clearStorageError();
  history.replaceState({}, '', '/');
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await act(() => void render(<App />, element('#app')));
  await flush();
  await flush();
});
afterEach(() => {
  render(null, element('#app'));
  vi.restoreAllMocks();
});

it.each<Operation>(['run', 'doUndo', 'dropdown'])(
  '%s の全件読み出し後の通知を操作終了後に回収し、一覧と件数を揃える',
  async (operation) => {
    const execute = await prepareOperation(operation);
    const pending = holdReload();
    await execute();
    await vi.waitFor(() => expect(pending.loaded()).toBe(true));
    await saveExternally();
    expect(pending.read).toHaveBeenCalledTimes(1);
    expectPosts(['1', '2']);

    await act(async () => pending.release());
    await flush();
    expect(pending.read).toHaveBeenCalledTimes(2);
    expectPosts(['1', '2', '3']);
    await click(element('.acct-btn'));
    const account = [...document.querySelectorAll('.acct-row')]
      .find((row) => row.querySelector('.fr-name')?.textContent === '@me')!;
    expect(account.querySelector('.n')!.textContent).toBe('3');
  },
);

it.each<Operation>(['run', 'doUndo', 'dropdown'])(
  '%s 中に外部通知がなければ、自分の保存通知があっても読み直しは1回だけ',
  async (operation) => {
    const execute = await prepareOperation(operation);
    const read = vi.spyOn(storage, 'listBookmarksWithAccounts');
    await execute();
    expect(read).toHaveBeenCalledTimes(1);
    expectPosts(['1', '2']);
  },
);

it.each([false, true])('2つの操作が重なると、最後に1回だけ通知を回収する (逆順終了: %s)', async (reverse) => {
  const first = holdReload();
  await click(element('[data-row="1"] .folder-chip-remove'));
  await vi.waitFor(() => expect(first.loaded()).toBe(true));
  const secondGate = deferred();
  let secondLoaded = false;
  first.read.mockImplementationOnce(async () => {
    const result = await readBookmarks();
    secondLoaded = true;
    await secondGate.promise;
    return result;
  });
  await click(element('[data-row="2"] .folder-chip-remove'));
  await vi.waitFor(() => expect(secondLoaded).toBe(true));
  await saveExternally();

  await act(async () => reverse ? secondGate.resolve() : first.release());
  await flush();
  expect(first.read).toHaveBeenCalledTimes(2);
  await act(async () => reverse ? first.release() : secondGate.resolve());
  await flush();
  expect(first.read).toHaveBeenCalledTimes(3);
  expectPosts(['1', '2', '3']);
});

it.each<Operation>(['run', 'doUndo', 'dropdown'])(
  '%s の読み直しより前に届いた外部通知は、その1回の読み直しで拾う',
  async (operation) => {
    const execute = await prepareOperation(operation);
    const gate = deferred();
    let written = false;
    if (operation === 'doUndo') {
      const restore = storage.restoreBookmarks;
      vi.spyOn(storage, 'restoreBookmarks').mockImplementationOnce(async (undo) => {
        await restore(undo);
        written = true;
        await gate.promise;
      });
    } else {
      const change = storage.changeBookmarkFolders;
      vi.spyOn(storage, 'changeBookmarkFolders').mockImplementationOnce(async (...args) => {
        const undo = await change(...args);
        written = true;
        await gate.promise;
        return undo;
      });
    }
    const read = vi.spyOn(storage, 'listBookmarksWithAccounts');
    await execute();
    await vi.waitFor(() => expect(written).toBe(true));
    await saveExternally();
    expect(read).not.toHaveBeenCalled();
    await act(async () => gate.resolve());
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expectPosts(['1', '2', '3']);
  },
);

it('一括保存に失敗した後の読み出し中の通知も、終了後に回収する', async () => {
  const execute = await prepareOperation('run');
  vi.spyOn(storage, 'changeBookmarkFolders').mockRejectedValueOnce(new Error('quota'));
  const pending = holdReload();
  await execute();
  await vi.waitFor(() => expect(pending.loaded()).toBe(true));
  await saveExternally();
  await act(async () => pending.release());
  await flush();
  expect(pending.read).toHaveBeenCalledTimes(2);
  expectPosts(['1', '2', '3']);
  expect(element('.toast').textContent).toBe(t('errorStorage'));
});
