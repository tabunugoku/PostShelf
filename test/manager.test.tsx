import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { MIME_FOLDER, MIME_POSTS } from '../src/manager/selection';
import { createFolder, getBookmark, listBookmarks, listFolders, setBookmarkFolders } from '../src/shared/storage';

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
    expect(folderRow('未分類').querySelector('.n')!.textContent).toBe('1');
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

  it('deleting a folder from the edit panel uses the in-app confirm', async () => {
    await click(folderRow('Alpha'));
    await click($('[aria-label=編集]'));
    await click($('.edit .danger'));
    expect($('[role=alertdialog]')).toBeTruthy();
    await click($$('.dialog-actions button')[1]);
    expect((await listFolders()).map((f) => f.id)).toEqual(['all', b]);
  });

  it('edit panel: colors are always enabled; any icon can have a color; "no color" clears it', async () => {
    await click(folderRow('Alpha'));
    await click($('[aria-label=編集]'));
    await click($('.ic[aria-label="ti-star"]'));
    const sws = $$<HTMLButtonElement>('.edit .sw');
    expect(sws.length).toBe(9); // 色なし + 8 色
    expect(sws.every((x) => !x.disabled)).toBe(true);
    await click($('.edit .sw[aria-label="#378ADD"]'));
    await click($('.edit .primary'));
    let f = (await listFolders()).find((x) => x.id === a)!;
    expect(f).toMatchObject({ icon: 'ti-star', color: '#378ADD' });
    await click($('[aria-label=編集]'));
    await click($('.edit .sw-none'));
    await click($('.edit .primary'));
    f = (await listFolders()).find((x) => x.id === a)!;
    expect(f.color).toBeUndefined();
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
