import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { INBOX_ID } from '../src/shared/models';
import { t } from '../src/shared/strings';
import { clearStorageError } from '../src/manager/errorBus';

const snap = { text: 'post 1', author: 'A', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const box = (name: string) =>
  [...document.querySelectorAll('.menu-wide label')].find((l) => l.textContent === name)!.querySelector('input')!;
const folderIdsOf = async () => (await storage.getBookmark('1'))!.folderIds;
let parent: string, child: string, other: string;

const openPicker = async () => {
  await act(() => void render(<App surface="tab" />, $('#app')));
  await flush();
  await flush();
  await click($(`[aria-label="${t('changeFolder')}"]`));
};

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  storage.setAccountScope('unknown');
  clearStorageError();
  parent = (await storage.createFolder({ name: 'Sample P' })).id;
  child = (await storage.createFolder({ name: 'Sample C', parentId: parent })).id;
  other = (await storage.createFolder({ name: 'Sample O' })).id;
});
afterEach(() => {
  render(null, $('#app'));
  vi.restoreAllMocks();
});

describe('v66-C: カードの「フォルダを変更」は 1 回で保存する', () => {
  it('子フォルダから別のフォルダへ付け替えると、保存の呼び出しは 1 回で、祖先は残る', async () => {
    await storage.setBookmarkFolders('1', [child], snap);
    await openPicker();
    const change = vi.spyOn(storage, 'changeBookmarkFolders');
    const add = vi.spyOn(storage, 'addToFolders');
    const remove = vi.spyOn(storage, 'removeFromFolders');
    await click(box('Sample C'));
    await click(box('Sample O'));
    expect(change).toHaveBeenCalledTimes(2); // 1 回の操作ごとに 1 回 (追加と解除を分けない)
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect((await folderIdsOf()).sort()).toEqual([parent, other].sort()); // 親は残る
  });

  it('1 回の操作で追加と解除を両方するときも、書き込みは 1 回', async () => {
    await storage.setBookmarkFolders('1', [other], snap);
    await openPicker();
    const writes = vi.spyOn(chrome.storage.local, 'set');
    await click(box(t('inboxName'))); // 未分類を選ぶと、追加 (未分類) と解除 (Sample O) が同時に起きる
    expect(writes.mock.calls.filter(([items]) => 'bookmarks' in items)).toHaveLength(1);
    expect(await folderIdsOf()).toEqual([INBOX_ID]);
  });

  it('保存が失敗すると、エラーの帯が出る', async () => {
    await storage.setBookmarkFolders('1', [other], snap);
    await openPicker();
    vi.spyOn(storage, 'changeBookmarkFolders').mockRejectedValue(new Error('quota'));
    await click(box('Sample C'));
    expect(document.querySelector('.banner-error')).toBeTruthy();
  });

  it('未分類を選ぶと未分類だけになり、フォルダを選び直すと未分類が外れる', async () => {
    await storage.setBookmarkFolders('1', [other], snap);
    await openPicker();
    await click(box(t('inboxName')));
    expect(await folderIdsOf()).toEqual([INBOX_ID]);
    await click(box('Sample O'));
    expect(await folderIdsOf()).toEqual([other]);
  });

  it('最後のフォルダを外すと未分類に戻る', async () => {
    await storage.setBookmarkFolders('1', [other], snap);
    await openPicker();
    await click(box('Sample O'));
    expect(await folderIdsOf()).toEqual([INBOX_ID]);
  });
});
