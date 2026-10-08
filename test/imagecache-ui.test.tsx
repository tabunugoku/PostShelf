import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { FakeDir } from './fake-fs';
import { App } from '../src/manager/App';
import { DirStore, IdbIndex, IdbStore, prepareDirectory, saveDirHandle, setHandleStorage } from '../src/shared/imagecache';
import { MB, getSettings, updateImageCache } from '../src/shared/settings';
import { addCollected, createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { defaultDeps } from '../src/shared/cacheops';

const flush = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const blob = (n: number, type = 'image/jpeg') => new Blob([new Uint8Array(n)], { type });
const img = (n: string) => `https://pbs.twimg.com/media/${n}?format=jpg&name=small`;
const snap = (id: number, media: string[]) => ({ text: `post ${id}`, author: 'A', handle: `@u${id}`, media, url: `https://x.com/u${id}/status/${id}` });
const btn = (text: string) => $$<HTMLButtonElement>('button').find((b) => b.textContent?.includes(text))!;
const dlgBtn = (text: string) => $$<HTMLButtonElement>('[role=alertdialog] button').find((b) => b.textContent?.trim() === text)!;
const section = () => $('.image-cache');

let perm: { granted: boolean; request: ReturnType<typeof vi.fn> };
let kept: any;
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  (globalThis as any).indexedDB = new (await import('fake-indexeddb')).IDBFactory();
  kept = null;
  setHandleStorage({ save: async (h) => void (kept = h), load: async () => kept });
  perm = { granted: true, request: vi.fn(async () => perm.granted) };
  (globalThis as any).chrome.permissions = { contains: async () => perm.granted, request: perm.request };
  let n = 0;
  (URL as any).createObjectURL = vi.fn(() => `blob:cached-${++n}`);
  (URL as any).revokeObjectURL = vi.fn();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  delete (window as any).showDirectoryPicker;
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
  const f = await createFolder({ name: 'F' });
  await setBookmarkFolders('1', [f.id], snap(1, [img('A')]));
  await setBookmarkFolders('2', [f.id], snap(2, [img('B')]));
});
afterEach(() => {
  const app = document.getElementById('app');
  if (app) render(null, app);
});

const mount = async (surface: 'tab' | 'sidepanel' = 'tab') => {
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush();
  await flush();
};
const openSettings = async () => {
  await click($$('.side .fr, .menu-item').find((r) => r.textContent?.includes('設定'))!);
};
const enableSwitch = () => $<HTMLInputElement>('.image-cache input[role=switch]');

describe('permission: the switch goes back off when it is refused', () => {
  it('asks Chrome for the image server in the click; refused → switch off, reason shown, setting unchanged', async () => {
    perm.granted = false;
    await mount();
    await openSettings();
    expect(enableSwitch().checked).toBe(false);
    await click(enableSwitch());
    expect(perm.request).toHaveBeenCalledWith({ origins: ['https://pbs.twimg.com/*'] });
    expect(enableSwitch().checked).toBe(false);
    expect($('.image-cache [role=alert]').textContent).toContain('許可されなかった');
    expect((await getSettings()).imageCache.enabled).toBe(false);
  });

  it('granted → on, saved, usage shown', async () => {
    await mount();
    await openSettings();
    await click(enableSwitch());
    expect(enableSwitch().checked).toBe(true);
    expect((await getSettings()).imageCache.enabled).toBe(true);
    expect(section().textContent).toContain('使用中 0 KB / 1 GB（画像 0 枚）');
  });

  it('turning it off does not ask again and keeps the images', async () => {
    await updateImageCache({ enabled: true });
    await new IdbStore().put('1', '1', blob(10));
    await mount();
    await openSettings();
    perm.request.mockClear();
    await click(enableSwitch());
    expect(perm.request).not.toHaveBeenCalled();
    expect((await getSettings()).imageCache.enabled).toBe(false);
    expect((await new IdbStore().list()).length).toBe(1);
  });

  it('shows a way to allow again when it is on but the permission is gone', async () => {
    await updateImageCache({ enabled: true });
    perm.granted = false;
    await mount();
    await openSettings();
    expect(section().textContent).toContain('アクセス許可がありません');
    perm.granted = true;
    await click(btn('許可する'));
    expect(section().textContent).not.toContain('アクセス許可がありません');
  });
});

describe('display uses the cache when it exists, and the X URL otherwise', () => {
  it('cache off: images load from the saved URL right away', async () => {
    await mount();
    expect($<HTMLImageElement>('[data-row="1"] .ph img').getAttribute('src')).toBe(img('A'));
  });

  it('cache on: a cached image is shown from a Blob URL (released on unmount); an uncached one falls back to the X URL', async () => {
    await updateImageCache({ enabled: true });
    await new IdbStore().put('1', '1', blob(10));
    await mount();
    expect($<HTMLImageElement>('[data-row="1"] .ph img').getAttribute('src')).toMatch(/^blob:cached-/);
    expect($<HTMLImageElement>('[data-row="2"] .ph img').getAttribute('src')).toBe(img('B'));
    await act(() => void render(null, $('#app')));
    expect((URL as any).revokeObjectURL).toHaveBeenCalled();
  });

  it('the viewer also prefers the cache', async () => {
    await updateImageCache({ enabled: true });
    await new IdbStore().put('1', '1', blob(10));
    await mount();
    await click($('[data-row="1"] .ph'));
    expect($<HTMLImageElement>('.viewer-img img').getAttribute('src')).toMatch(/^blob:cached-/);
  });

  it('a folder without permission is skipped: images come from the X URL, nothing breaks', async () => {
    const root = new FakeDir();
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await updateImageCache({ enabled: true, backend: 'dir' });
    await new DirStore(root, new IdbIndex()).put('1', '1', blob(10));
    root.permission = 'prompt';
    await mount();
    expect($<HTMLImageElement>('[data-row="1"] .ph img').getAttribute('src')).toBe(img('A'));
  });
});

describe('settings UI: usage, capacity, quality', () => {
  it('shows usage with a bar, and the options of the mockup', async () => {
    await updateImageCache({ enabled: true });
    const s = new IdbStore();
    await s.put('1', '1', blob(300 * 1024));
    await s.put('2', '1', blob(200 * 1024));
    await mount();
    await openSettings();
    expect(section().textContent).toContain('使用中 500 KB / 1 GB（画像 2 枚）');
    const meter = $('.image-cache [role=progressbar]');
    expect(meter.getAttribute('aria-valuenow')).toBe('0');
    expect($$('.image-cache select option').map((o) => o.textContent)).toEqual(['500 MB', '1 GB', '2 GB', '5 GB', '10 GB', '指定…']);
    expect($$('.image-cache input[name=cacheQuality]').length).toBe(2);
    expect($$('.image-cache input[name=cacheFull]').length).toBe(2);
    expect(section().textContent).toContain('拡張機能を削除すると、ブラウザの中のキャッシュも消えます');
    expect(section().textContent).toContain('JSON のエクスポート');
    expect(section().textContent).toContain('許可は、この機能をオンにしたときだけ求めます');
  });

  it('changing quality / full policy / capacity is saved', async () => {
    await updateImageCache({ enabled: true });
    await mount();
    await openSettings();
    await click($$('.image-cache input[name=cacheQuality]')[1]);
    await click($$('.image-cache input[name=cacheFull]')[1]);
    const sel = $<HTMLSelectElement>('.image-cache select');
    await act(() => {
      sel.value = String(2 * 1024 * MB);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect((await getSettings()).imageCache).toMatchObject({ quality: 'orig', onFull: 'stop', maxBytes: 2 * 1024 * MB });
  });

  it('custom size: minimum 100 MB', async () => {
    await updateImageCache({ enabled: true });
    await mount();
    await openSettings();
    const sel = $<HTMLSelectElement>('.image-cache select');
    await act(() => {
      sel.value = 'custom';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const type = async (v: string) => {
      const i = $<HTMLInputElement>('.image-cache input[type=number]');
      await act(() => {
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();
      await act(() => void i.dispatchEvent(new Event('blur')));
      await flush();
    };
    await type('50');
    expect((await getSettings()).imageCache.maxBytes).toBe(1024 * MB); // 受け付けない
    expect($('.image-cache [role=alert]').textContent).toContain('100 MB 以上');
    await type('300');
    expect((await getSettings()).imageCache.maxBytes).toBe(300 * MB);
  });

  it('lowering the maximum without losing anything saves it without a dialog', async () => {
    await updateImageCache({ enabled: true, maxBytes: 1024 * MB });
    const s = new IdbStore();
    await s.put('1', '1', blob(1024), { postSavedAt: 1 });
    await mount();
    await openSettings();
    // 500 MB に下げても入り切る (消えるものがない) ので、確認なしで保存される
    const sel = $<HTMLSelectElement>('.image-cache select');
    await act(() => {
      sel.value = String(500 * MB);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect($$('[role=alertdialog]').length).toBe(0);
    expect((await getSettings()).imageCache.maxBytes).toBe(500 * MB);
  });

  it('lowering below the usage: the dialog shows the count; cancel changes nothing; OK removes the oldest posts immediately', async () => {
    // 100 MB 未満は設定できないので、容量の確認は直接 cacheops のテストで行い、ここでは画面の流れだけを確かめる
    await updateImageCache({ enabled: true, maxBytes: 1024 * MB });
    const store = new IdbStore();
    vi.spyOn(store, 'list');
    const real = IdbStore.prototype.list;
    // 使用量を大きく見せる: list がサイズ 300 MB のメタを返すようにする
    vi.spyOn(IdbStore.prototype, 'list').mockImplementation(async function (this: IdbStore) {
      const base = await real.call(this);
      return base.map((m) => ({ ...m, size: 300 * MB }));
    });
    const removed: string[] = [];
    vi.spyOn(IdbStore.prototype, 'removePost').mockImplementation(async (id: string) => void removed.push(id));
    const s = new IdbStore();
    await s.put('1', '1', blob(10), { postSavedAt: 1 });
    await s.put('2', '1', blob(10), { postSavedAt: 2 });
    await mount();
    await openSettings();
    const sel = $<HTMLSelectElement>('.image-cache select');
    const change = async (v: string) => {
      await act(() => {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();
    };
    await change(String(500 * MB)); // 600 MB 使用中 → 500 MB: 古い 1 件が消える
    expect($('[role=alertdialog] p').textContent).toContain('1 件のポスト');
    await click(dlgBtn('キャンセル'));
    expect((await getSettings()).imageCache.maxBytes).toBe(1024 * MB);
    expect(removed).toEqual([]);
    await change(String(500 * MB));
    await click(dlgBtn('下げて整理する'));
    expect((await getSettings()).imageCache.maxBytes).toBe(500 * MB);
    expect(removed).toEqual(['1']); // 保存日が古いポストから
    vi.restoreAllMocks();
  });
});

describe('folder back end in the UI', () => {
  it('tab: choosing the folder radio opens the picker, prepares the folder and saves the handle', async () => {
    const root = new FakeDir('chosen');
    (window as any).showDirectoryPicker = vi.fn(async () => root);
    await updateImageCache({ enabled: true });
    await mount();
    await openSettings();
    await click($$('.image-cache input[name=cacheBackend]')[1]);
    expect((window as any).showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(root.paths()).toEqual(['.postshelf', 'README.txt']);
    expect((await getSettings()).imageCache.backend).toBe('dir');
    expect($('.dirbox code').textContent).toBe('chosen');
  });

  it('a non-empty folder without a marker asks first; declining keeps the old back end and leaves the folder untouched', async () => {
    const root = new FakeDir('foreign');
    root.put('a.txt');
    (window as any).showDirectoryPicker = vi.fn(async () => root);
    await updateImageCache({ enabled: true });
    await mount();
    await openSettings();
    await click($$('.image-cache input[name=cacheBackend]')[1]);
    expect($('[role=alertdialog]').textContent).toContain('PostShelf が作ったものではなく');
    await click(dlgBtn('キャンセル'));
    expect(root.paths()).toEqual(['a.txt']);
    expect((await getSettings()).imageCache.backend).toBe('idb');
  });

  it('shows "許可が必要です" with a button when the permission was lost, and allowing it fixes the state', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await updateImageCache({ enabled: true, backend: 'dir' });
    root.permission = 'prompt';
    await mount();
    await openSettings();
    expect($('.dirbox [role=alert]').textContent).toContain('許可が必要です');
    await click($$<HTMLButtonElement>('.dirbox button').find((b) => b.textContent === '許可する')!);
    expect($$('.dirbox [role=alert]').length).toBe(0);
    expect($$('.dirbox button').some((b) => b.textContent === '再スキャン')).toBe(true);
  });

  it('side panel: no folder picking; it says to use the tab version', async () => {
    (window as any).innerWidth = 400;
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    (window as any).showDirectoryPicker = vi.fn(async () => root);
    await updateImageCache({ enabled: true, backend: 'dir' });
    await mount('sidepanel');
    await click($$('.menu-item').find((r) => r.textContent?.includes('設定')) ?? $$('.folder-btn')[0]);
    if (!$$('.image-cache').length) await click($$('.menu-item').find((r) => r.textContent?.includes('設定'))!);
    expect($('.dirbox').textContent).toContain('タブ版で選んでください');
    expect($$('.dirbox button').some((b) => b.textContent?.includes('フォルダを選'))).toBe(false);
    (window as any).innerWidth = 1200;
  });

  it('where the picker is unavailable it shows a substitute: use "inside the browser"', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await updateImageCache({ enabled: true, backend: 'dir' });
    await mount();
    await openSettings();
    expect($('.dirbox').textContent).toContain('ブラウザの中');
    // 選べない環境でラジオを押しても落ちない
    delete (window as any).showDirectoryPicker;
    await click($$('.image-cache input[name=cacheBackend]')[0]);
    expect((await getSettings()).imageCache.backend).toBe('idb');
  });

  it('switching the back end with images asks: move / don\'t move / cancel — move copies with progress and empties the old one', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await updateImageCache({ enabled: true });
    const idb = new IdbStore();
    await idb.put('1', '1', blob(10), { postSavedAt: 1 });
    await idb.put('2', '1', blob(10), { postSavedAt: 2 });
    await mount();
    await openSettings();
    await click($$('.image-cache input[name=cacheBackend]')[1]);
    expect($('[role=alertdialog]').textContent).toContain('2 枚');
    expect($$('[role=alertdialog] button').map((b) => b.textContent)).toEqual(['キャンセル', '移さない', '移す']);
    await click(dlgBtn('キャンセル'));
    expect((await getSettings()).imageCache.backend).toBe('idb');
    await click($$('.image-cache input[name=cacheBackend]')[1]);
    await click(dlgBtn('移す'));
    await flush(60);
    expect((await getSettings()).imageCache.backend).toBe('dir');
    expect(root.paths().filter((p) => p.startsWith('images/')).length).toBeGreaterThanOrEqual(2);
    expect(await idb.list()).toEqual([]);
  });

  it('"don\'t move" only switches', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    await saveDirHandle(root);
    await updateImageCache({ enabled: true });
    const idb = new IdbStore();
    await idb.put('1', '1', blob(10));
    await mount();
    await openSettings();
    await click($$('.image-cache input[name=cacheBackend]')[1]);
    await click(dlgBtn('移さない'));
    await flush(40);
    expect((await getSettings()).imageCache.backend).toBe('dir');
    expect((await idb.list()).length).toBe(1);
    expect(root.paths().some((p) => p.startsWith('images/'))).toBe(false);
  });
});

describe('bulk caching and deleting the cache in the UI', () => {
  beforeEach(async () => {
    await updateImageCache({ enabled: true });
  });
  it('caches saved posts one by one with progress, and can be run again for what is missing', async () => {
    const spy = vi.spyOn(defaultDeps, 'fetch').mockImplementation((async () => ({ ok: true, status: 200, blob: async () => blob(10) })) as never);
    vi.spyOn(defaultDeps, 'delay').mockImplementation(async () => {});
    await mount();
    await openSettings();
    await click(btn('保存済みのポストの画像をまとめてキャッシュ'));
    await flush(60);
    expect(section().textContent).toContain('2 枚をキャッシュしました（失敗 0 枚）');
    expect((await new IdbStore().list()).map((m) => m.tweetId).sort()).toEqual(['1', '2']);
    await click(btn('保存済みのポストの画像をまとめてキャッシュ'));
    await flush(40);
    expect(section().textContent).toContain('キャッシュする画像はありません');
    spy.mockRestore();
    vi.restoreAllMocks();
  });

  it('shows progress and a stop button while running; stopping keeps what was cached', async () => {
    let release: () => void = () => {};
    let calls = 0;
    vi.spyOn(defaultDeps, 'fetch').mockImplementation((async () => {
      calls++;
      if (calls === 2) await new Promise<void>((r) => (release = r));
      return { ok: true, status: 200, blob: async () => blob(10) };
    }) as never);
    vi.spyOn(defaultDeps, 'delay').mockImplementation(async () => {});
    await mount();
    await openSettings();
    await click(btn('保存済みのポストの画像をまとめてキャッシュ'));
    expect($('.image-cache [role=status]').textContent).toMatch(/取得しています/);
    await click(btn('中止'));
    await act(() => void release());
    await flush(60);
    expect((await new IdbStore().list()).length).toBe(2); // 2 枚目の取得中に中止 → その 1 枚は完了、次へは進まない
    vi.restoreAllMocks();
  });

  it('"キャッシュを削除" asks first, then empties the cache but not the posts', async () => {
    await new IdbStore().put('1', '1', blob(10));
    await mount();
    await openSettings();
    await click(btn('キャッシュを削除'));
    expect($('[role=alertdialog] p').textContent).toContain('1 枚');
    await click(dlgBtn('キャンセル'));
    expect((await new IdbStore().list()).length).toBe(1);
    await click(btn('キャッシュを削除'));
    await click(dlgBtn('削除'));
    await flush(40);
    expect(await new IdbStore().list()).toEqual([]);
    expect(section().textContent).toContain('キャッシュを削除しました');
  });
});

describe('reset and delete-all in the UI include the cache', () => {
  it('"設定を初期の値に戻す" turns the cache off and back to defaults; images stay', async () => {
    await updateImageCache({ enabled: true, quality: 'orig', backend: 'idb' });
    await new IdbStore().put('1', '1', blob(10));
    await mount();
    await openSettings();
    await click(btn('設定を初期の値に戻す'));
    await click(dlgBtn('初期の値に戻す'));
    await flush(40);
    expect((await getSettings()).imageCache).toMatchObject({ enabled: false, quality: 'large' });
    expect(enableSwitch().checked).toBe(false);
    expect((await new IdbStore().list()).length).toBe(1);
  });

  it('"すべてのデータを削除" also deletes the cached images', async () => {
    await updateImageCache({ enabled: true });
    await new IdbStore().put('1', '1', blob(10));
    await mount();
    await openSettings();
    await click(btn('すべてのデータを削除'));
    const input = $<HTMLInputElement>('[role=alertdialog] input');
    await act(() => {
      input.value = '削除';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    await click(dlgBtn('削除'));
    await flush(60);
    expect(await new IdbStore().list()).toEqual([]);
  });
});
