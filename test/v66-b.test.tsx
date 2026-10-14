import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import * as cacheops from '../src/shared/cacheops';
import { clearStorageError } from '../src/manager/errorBus';

const snap = (n: number) => ({ text: `post ${n}`, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const mount = async () => {
  await act(() => void render(<App surface="tab" />, $('#app')));
  await flush();
  await flush();
};
const errorBanner = () => document.querySelector('.banner-error');
/** 失敗を投げる前に、未処理の reject が出ていないかも見る */
const rejections: unknown[] = [];
const onRejection = (e: PromiseRejectionEvent) => void rejections.push(e.reason);

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  rejections.length = 0;
  window.addEventListener('unhandledrejection', onRejection);
  clearStorageError();
});
afterEach(() => {
  render(null, $('#app'));
  window.removeEventListener('unhandledrejection', onRejection);
  vi.restoreAllMocks();
});

describe('v66-B: 削除・割り当ての失敗が画面に出る', () => {
  it('フォルダの削除が失敗すると、エラーの帯が出て、一覧を読み直す', async () => {
    const f = await storage.createFolder({ name: 'Alpha' });
    await storage.setBookmarkFolders('1', [f.id], snap(1));
    await mount();
    const list = vi.spyOn(storage, 'listFolders');
    vi.spyOn(storage, 'deleteFolder').mockRejectedValue(new Error('quota'));
    await click($('[aria-label="名前・アイコン・色を変更: Alpha"]'));
    await click($('.folder-editor-host [data-folder-actions] button:first-child'));
    const before = list.mock.calls.length;
    await click($$('.dialog-actions button')[1]);
    expect(errorBanner()).toBeTruthy();
    expect(list.mock.calls.length).toBeGreaterThan(before);
    expect(rejections).toEqual([]);
  });

  it('アカウントのデータ削除が失敗すると、エラーの帯が出る', async () => {
    await storage.noteAccount({ handle: 'you' }, 1);
    await storage.noteAccount({ handle: 'me' }, 2);
    storage.setAccountScope('you');
    await storage.setBookmarkFolders('1', [], snap(1));
    await storage.noteAccount({ handle: 'me' }, 99);
    await mount();
    vi.spyOn(cacheops, 'deleteAccountDataAndCache').mockRejectedValue(new Error('quota'));
    await click($('.acct-btn'));
    const row = $$('.acct-row').find((r) => r.querySelector('.fr-name')!.textContent === '@you')!;
    await click(row.querySelector('[aria-haspopup=menu]')!);
    await click($('.acct-more [role=menuitem]'));
    await click($$('.dialog-actions button')[1]);
    expect(errorBanner()).toBeTruthy();
    expect(rejections).toEqual([]);
  });

  it('割り当てが失敗すると、エラーの帯が出る', async () => {
    await storage.noteAccount({ handle: 'me' }, 2);
    storage.setAccountScope('unknown');
    await storage.addCollected([{ tweetId: '9', snapshot: snap(9) }]);
    await storage.noteAccount({ handle: 'me' }, 99);
    await mount();
    vi.spyOn(storage, 'assignAccount').mockRejectedValue(new Error('quota'));
    await click($('.banner[aria-label="アカウント未設定"] button'));
    await click($$('[role=dialog] button').find((x) => x.textContent === '割り当て…')!);
    expect(errorBanner()).toBeTruthy();
    expect(rejections).toEqual([]);
  });
});
