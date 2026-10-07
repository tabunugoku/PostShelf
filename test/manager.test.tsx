import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { MIME_FOLDER, MIME_POSTS } from '../src/manager/selection';
import { createFolder, getBookmark, listBookmarks, listFolders, setBookmarkFolders } from '../src/shared/storage';
import { getImportHint, getSettings, recordPending } from '../src/shared/settings';

const snap = (n: number) => ({ text: `post ${n}`, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element, init: MouseEventInit = {}) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })));
  await flush();
};
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  await act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));
  await flush();
};
const dnd = async (el: Element, type: string, data: Record<string, string>, init: object = {}) => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { dataTransfer: { types: Object.keys(data), getData: (m: string) => data[m] ?? '', setData() {}, dropEffect: '', effectAllowed: '' }, ...init });
  await act(() => void el.dispatchEvent(ev));
  await flush();
};
const folderRow = (name: string) => $$('.fr').find((r) => r.textContent?.includes(name))!;

let a: string, b: string;
beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  a = (await createFolder({ name: 'Alpha' })).id;
  b = (await createFolder({ name: 'Beta' })).id;
  for (let i = 1; i <= 4; i++) await setBookmarkFolders(String(i), [i <= 2 ? a : b], snap(i));
  // 保存日時を固定 (新しい順に 4,3,2,1)
  const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
  for (const k of Object.keys(data)) data[k].savedAt = Number(k);
  await chrome.storage.local.set({ bookmarks: data });
  await act(() => void render(<App />, $('#app')));
  await flush();
});
afterEach(() => render(null, $('#app')));

const rowIds = () => $$('[data-row]').map((r) => r.getAttribute('data-row'));

describe('manager organizing', () => {
  it('renders rows with checkboxes and counts', () => {
    expect(rowIds()).toEqual(['4', '3', '2', '1']);
    expect(folderRow('Alpha').querySelector('.n')!.textContent).toBe('2');
  });

  it('selects with click and Shift+click range, shows the bulk bar, clears', async () => {
    const boxes = () => $$<HTMLInputElement>('.sel');
    await click(boxes()[0]);
    await click(boxes()[2], { shiftKey: true });
    expect($$('.selected').length).toBe(3);
    expect($('.bulk strong').textContent).toBe('3 件選択中');
    await click($('.bulk-clear'));
    expect($$('.bulk').length).toBe(0);
  });

  it('Ctrl+A selects everything shown (within search results)', async () => {
    await key($('[data-row="4"]'), 'a', { ctrlKey: true });
    expect($$('.selected').length).toBe(4);
    await key($('[data-row="4"]'), 'Escape');
    expect($$('.selected').length).toBe(0);
    const search = $<HTMLInputElement>('input[type=search]');
    await act(() => {
      search.value = 'post 3';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await key($('[data-row="3"]'), 'a', { ctrlKey: true });
    expect($$('.selected').length).toBe(1);
  });

  it('bulk delete asks in-app (no window.confirm), deletes once, and Undo restores', async () => {
    const before = await listBookmarks();
    await click($$('.sel')[0]);
    await click($$('.sel')[1]);
    await click($$('.bulk button').find((x) => x.textContent?.includes('削除'))!);
    expect($('[role=alertdialog]').textContent).toContain('2 件');
    await click($$('.dialog-actions button')[0]); // キャンセル
    expect((await listBookmarks()).length).toBe(4);
    await click($$('.bulk button').find((x) => x.textContent?.includes('削除'))!);
    await click($$('.dialog-actions button')[1]);
    expect((await listBookmarks()).length).toBe(2);
    expect(rowIds()).toEqual(['2', '1']);
    expect($('.toast').textContent).toContain('2 件を削除しました');
    await click($('.toast button'));
    expect(JSON.stringify((await listBookmarks()).sort((x, y) => x.tweetId.localeCompare(y.tweetId)))).toBe(
      JSON.stringify(before.sort((x, y) => x.tweetId.localeCompare(y.tweetId))),
    );
    expect(rowIds()).toEqual(['4', '3', '2', '1']);
    expect($$('.toast').length).toBe(0);
  });

  it('Delete key opens the confirm for the focused row', async () => {
    const row = $('[data-row="4"]');
    await act(() => void (row as HTMLElement).focus());
    await key(row, 'Delete');
    expect($('[role=alertdialog]')).toBeTruthy();
    await key(document.body, 'Escape');
    expect($$('[role=alertdialog]').length).toBe(0);
  });

  it('ArrowDown moves the focus and Space toggles selection', async () => {
    await key($('[data-row="4"]'), 'ArrowDown');
    expect(document.activeElement?.getAttribute('data-row')).toBe('3');
    await key(document.activeElement!, ' ');
    expect($$('.selected').map((x) => x.getAttribute('data-row'))).toEqual(['3']);
  });

  it('clicking a folder chip removes the post from that folder; the last folder falls back to 未分類', async () => {
    const chip = $$('[data-row="1"] .chip')[0];
    await click(chip);
    expect((await getBookmark('1'))!.folderIds).toEqual(['inbox']);
    expect((await listFolders())[1].id).toBe('inbox');
    expect(folderRow('未分類').querySelector('.badge')!.textContent).toBe('1');
    expect($('.toast').textContent).toContain('外しました');
    await click($('.toast button'));
    expect((await getBookmark('1'))!.folderIds).toEqual([a]);
  });

  it('drop on a folder adds; Alt+drop moves out of the current folder', async () => {
    await dnd(folderRow('Beta'), 'drop', { [MIME_POSTS]: JSON.stringify(['1', '2']) });
    expect((await getBookmark('1'))!.folderIds).toEqual([a, b]);
    expect(folderRow('Beta').querySelector('.n')!.textContent).toBe('4');
    await click(folderRow('Alpha'));
    await dnd(folderRow('Beta'), 'drop', { [MIME_POSTS]: JSON.stringify(['1']) }, { altKey: true });
    expect((await getBookmark('1'))!.folderIds).toEqual([b]);
    expect(folderRow('Alpha').querySelector('.n')!.textContent).toBe('1');
  });

  it('dragging a post that is part of the selection drags the whole selection', async () => {
    await click($$('.sel')[0]);
    await click($$('.sel')[1]);
    let payload = '';
    const ev = new Event('dragstart', { bubbles: true });
    Object.assign(ev, { dataTransfer: { setData: (_m: string, v: string) => (payload = v), effectAllowed: '' } });
    await act(() => void $('[data-row="4"]').dispatchEvent(ev));
    expect(JSON.parse(payload).sort()).toEqual(['3', '4']);
  });

  it('dropping a folder on another reorders; the built-in ones cannot be dragged onto', async () => {
    await dnd(folderRow('Alpha'), 'drop', { [MIME_FOLDER]: b });
    expect((await listFolders()).map((f) => f.id)).toEqual(['all', b, a]);
    await dnd(folderRow('すべて'), 'drop', { [MIME_FOLDER]: a });
    expect((await listFolders()).map((f) => f.id)).toEqual(['all', b, a]);
    expect(folderRow('すべて').getAttribute('draggable')).not.toBe('true');
  });

  it('external links open in a new tab safely', () => {
    for (const l of $$<HTMLAnchorElement>('.row-actions a')) {
      expect(l.target).toBe('_blank');
      expect(l.rel).toContain('noopener');
      expect(l.rel).toContain('noreferrer');
    }
  });

  const openEdit = async (name: string) => {
    await click($(`[aria-label="名前・アイコン・色を変更: ${name}"]`));
  };

  it('deleting a folder from its edit popover uses the in-app confirm', async () => {
    await openEdit('Alpha');
    await click($('.folder-edit .danger'));
    expect($('[role=alertdialog]')).toBeTruthy();
    await click($$('.dialog-actions button')[1]);
    expect((await listFolders()).map((f) => f.id)).toEqual(['all', b]);
  });

  it('folder edit popover: any icon can have a color, "no color" clears it, the name commits on Enter', async () => {
    await openEdit('Alpha');
    await click($('.folder-edit .ic[aria-label="ti-star"]'));
    const sws = $$<HTMLButtonElement>('.folder-edit .sw');
    expect(sws.length).toBe(9); // 色なし + 8 色
    expect(sws.every((x) => !x.disabled)).toBe(true);
    await click($('.folder-edit .sw[aria-label="#378ADD"]'));
    let f = (await listFolders()).find((x) => x.id === a)!;
    expect(f).toMatchObject({ icon: 'ti-star', color: '#378ADD' });
    await click($('.folder-edit .sw-none'));
    f = (await listFolders()).find((x) => x.id === a)!;
    expect(f.color).toBeUndefined();
    const input = $<HTMLInputElement>('.folder-edit input');
    await act(() => {
      input.value = 'Renamed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await key(input, 'Enter');
    expect((await listFolders()).find((x) => x.id === a)!.name).toBe('Renamed');
    expect(folderRow('Renamed')).toBeTruthy();
  });

  it('sort is an in-app listbox with aria and full keyboard support', async () => {
    const btn = $<HTMLButtonElement>('.sort-btn');
    expect(btn.getAttribute('aria-haspopup')).toBe('listbox');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect($$('select').length).toBe(0); // ネイティブ select は使わない
    await click(btn);
    const list = $('[role=listbox]');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect($$('[role=option]').length).toBe(4);
    expect($('[role=option][aria-selected=true]').textContent).toContain('保存が新しい順');
    expect(list.getAttribute('aria-activedescendant')).toBe($$('[role=option]')[0].id);
    await key(list, 'ArrowDown');
    expect(list.getAttribute('aria-activedescendant')).toBe($$('[role=option]')[1].id);
    await key(list, 'End');
    await key(list, 'Enter'); // 投稿が古い順
    expect($$('[role=listbox]').length).toBe(0);
    expect(btn.textContent).toContain('投稿が古い順');
    expect(document.activeElement).toBe(btn);
    await click(btn);
    await key($('[role=listbox]'), 'Escape');
    expect($$('[role=listbox]').length).toBe(0);
    await key(btn, 'ArrowDown');
    expect($$('[role=listbox]').length).toBe(1);
    await click($$('[role=option]')[1]); // 保存が古い順
    expect(rowIds()).toEqual(['1', '2', '3', '4']);
  });
});

describe('v7 manager layout', () => {
  const rerender = async () => {
    await act(() => void render(null, $('#app')));
    await act(() => void render(<App />, $('#app')));
    await flush();
  };

  it('sidebar has smart views (すべて / 未分類 with a badge / 最近の 7 日) and the folder list', async () => {
    const names = $$('.sec').map((x) => x.textContent);
    expect(names).toEqual(['スマートビュー', 'フォルダ']);
    expect($$('.side .fr .fr-name').map((x) => x.textContent).slice(0, 3)).toEqual(['すべて', '未分類', '最近の 7 日']);
    await click($('.fr [aria-label="名前・アイコン・色を変更: Alpha"]')); // 「…」から編集ポップオーバー
    expect($('.folder-edit')).toBeTruthy();
    expect($$('[aria-label=編集]').length).toBe(0); // ヘッダーの編集パネルは廃止
    expect(folderRow('最近の 7 日').querySelector('.n')!.textContent).toBe('0'); // beforeEach の savedAt (1..4) は 7 日より前
    const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
    data['1'].savedAt = Date.now() - 2 * 86400000;
    await chrome.storage.local.set({ bookmarks: data });
    await flush();
    expect(folderRow('最近の 7 日').querySelector('.n')!.textContent).toBe('1');
    await click(folderRow('最近の 7 日'));
    expect(rowIds()).toEqual(['1']);
  });

  it('header shows the view name, count, search and 3 view modes; the choice is saved in chrome.storage.local', async () => {
    expect($('.bar-name').textContent).toBe('すべて');
    expect($('.bar-count').textContent).toBe('4 件');
    expect($$('.seg button').length).toBe(3);
    await click($('.seg button[aria-label="グリッド表示"]'));
    expect($('.rows').classList.contains('view-grid')).toBe(true);
    await click(folderRow('Alpha'));
    expect($('.bar-name').textContent).toBe('Alpha');
    expect($('.bar-count').textContent).toBe('2 件');
    expect(await getSettings()).toMatchObject({ viewMode: 'grid', lastFolderId: a });
    await rerender(); // 再起動を模擬: 最後のフォルダと表示形式が復元される
    expect($('.bar-name').textContent).toBe('Alpha');
    expect($('.rows').classList.contains('view-grid')).toBe(true);
  });

  it('filter chips (author menu, AND) and the empty "not found" state with a way back', async () => {
    const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
    data['1'].snapshot.media = ['https://x/img.jpg'];
    data['2'].snapshot.media = ['https://x/img2.jpg'];
    data['2'].snapshot.handle = '@u1';
    await chrome.storage.local.set({ bookmarks: data });
    await rerender();
    await click($$('.chip.filter').find((c) => c.textContent?.includes('画像あり'))!);
    expect(rowIds().sort()).toEqual(['1', '2']);
    await click($$('.chip.filter').find((c) => c.textContent?.includes('投稿者で絞り込み'))!);
    const items = $$('.menu-scroll .menu-item');
    expect(items.map((i) => i.querySelector('.fr-name')!.textContent)).toContain('@u1');
    await click(items.find((i) => i.textContent?.includes('@u1'))!);
    expect(rowIds().sort()).toEqual(['1', '2']); // @u1 は 2 件 (post 1 と 2)、どちらも画像あり
    await click($$('.chip.filter').find((c) => c.textContent?.includes('動画あり'))!); // 未判定は出ない
    expect(rowIds()).toEqual([]);
    expect($('.empty-state').textContent).toContain('見つかりませんでした');
    expect($('.empty-state').textContent).toContain('絞り込みを外してください');
    await click($('.empty-state button'));
    expect(rowIds().length).toBe(4);
  });

  it('with no saved posts at all, explains how to save', async () => {
    await chrome.storage.local.set({ bookmarks: {} });
    await rerender();
    expect($('.empty-state').textContent).toContain('まだ保存したポストがありません');
    expect($('.empty-state').textContent).toContain('フォルダボタン');
  });

  it('import banner: shows the pending count, how-to dialog, dismiss survives until it grows', async () => {
    expect($$('.banner').length).toBe(0);
    await recordPending(12);
    await flush();
    expect($('.banner').textContent).toContain('12 件');
    await click($('.banner-btn'));
    expect($('[role=dialog] .pre').textContent).toContain('/i/bookmarks');
    await key(document.body, 'Escape');
    await click($('.banner [aria-label=閉じる]'));
    expect($$('.banner').length).toBe(0);
    expect((await getImportHint()).dismissed).toBe(12);
    await rerender();
    expect($$('.banner').length).toBe(0);
    await recordPending(13);
    await flush();
    expect($$('.banner').length).toBe(1);
  });

  it('grid cards keep an equal-height 3-column grid and show the first image as a cover', async () => {
    const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
    data['4'].snapshot.media = ['https://x/cover.jpg', 'https://x/second.jpg'];
    await chrome.storage.local.set({ bookmarks: data });
    await rerender();
    await click($('.seg button[aria-label="グリッド表示"]'));
    expect($$('.gc').length).toBe(4);
    expect($<HTMLImageElement>('[data-row="4"] .cover').src).toContain('cover.jpg');
    const css = (await import('node:fs')).readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/\.view-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);grid-auto-rows:1fr/);
  });

  it('hover actions exist on every card: change folders / open original / delete', () => {
    const acts = $$('[data-row="4"] .row-actions .icon-btn');
    expect(acts.map((x) => x.getAttribute('aria-label') ?? x.getAttribute('title'))).toEqual(['フォルダを変更', 'X で開く', 'PostShelf から削除']);
  });
});
