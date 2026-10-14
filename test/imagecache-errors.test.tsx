// 版: v68-d
import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { FakeDir } from './fake-fs';
import { App } from '../src/manager/App';
import { IdbStore, prepareDirectory, saveDirHandle, setHandleStorage } from '../src/shared/imagecache';
import { getSettings, updateImageCache } from '../src/shared/settings';
import { createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const flush = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush(60);
};
const btn = (text: string) => $$<HTMLButtonElement>('button').find((b) => b.textContent?.includes(text))!;
const dlgBtn = (text: string) => $$<HTMLButtonElement>('[role=alertdialog] button').find((b) => b.textContent?.trim() === text)!;
const snapshot = {
  text: '架空の本文',
  author: 'Sample',
  handle: '@sample_user',
  media: ['https://pbs.twimg.com/media/sample_a?format=jpg&name=small'],
  url: 'https://x.com/sample_user/status/1',
};

/** 次にポストの保存データを読むときだけ、1 回失敗させる */
function failNextBookmarkRead() {
  const local = (globalThis as any).chrome.storage.local;
  const get = local.get.bind(local);
  let armed = true;
  local.get = async (key: unknown) => {
    if (armed && key === 'bookmarks') {
      armed = false;
      throw new Error('boom');
    }
    return get(key);
  };
}

beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  (globalThis as any).indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  let kept: any = null;
  setHandleStorage({ save: async (h) => void (kept = h), load: async () => kept });
  (globalThis as any).chrome.permissions = { contains: async () => true, request: async () => true };
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  delete (window as any).showDirectoryPicker;
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
  const f = await createFolder({ name: 'F' });
  await setBookmarkFolders('1', [f.id], snapshot);
  await updateImageCache({ enabled: true });
  await act(() => void render(<App surface="tab" />, $('#app')));
  await flush();
  await flush();
  await click($$('.side .fr, .menu-item').find((r) => r.textContent?.includes('設定'))!);
});
afterEach(() => render(null, document.getElementById('app')!));

describe('画像のキャッシュの失敗', () => {
  it('まとめてキャッシュが失敗しても、進捗の表示が消えて失敗の文言が出る', async () => {
    failNextBookmarkRead();
    await click(btn('保存済みのポストの画像をまとめてキャッシュ'));
    expect($$('.image-cache [role=status]').some((e) => /取得しています/.test(e.textContent!))).toBe(false);
    expect($('.image-cache [role=alert]').textContent).toContain('保存または読み込みに失敗しました');
    expect(btn('キャッシュを削除').disabled).toBe(false);
  });

  it('保存先の移動が失敗したら、保存先の設定を変えず、移動の失敗を出す', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await new IdbStore().put('1', '1', new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    await click($('.image-cache input[name=cacheBackend]:not(:checked)'));
    failNextBookmarkRead(); // 移動の中で読むポストの保存データを失敗させる
    await click(dlgBtn('移す'));
    expect((await getSettings()).imageCache.backend).toBe('idb');
    expect($('.image-cache [role=alert]').textContent).toContain('移せませんでした');
    expect($('[role=alertdialog]')).toBeNull();
  });
});
