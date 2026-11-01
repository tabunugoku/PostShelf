// 版: v84
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BulkMenu } from '../src/manager/BulkMenu';
import { FILTER_MIN_FOLDERS } from '../src/shared/folderPicker';
import type { Bookmark, Folder } from '../src/shared/models';
import { t } from '../src/shared/strings';
import * as storage from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

let host: HTMLDivElement;
let folders: Folder[];
let bookmarks: Bookmark[];
const onConfirm = vi.fn(async (_addIds: string[], _removeIds: string[]) => true);
const flush = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 20)));
const click = async (button: HTMLElement) => {
  expect(button).not.toBeNull();
  await act(() => button.click());
  await flush();
};
const button = (key: string) => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find(button => button.textContent?.trim() === t(key))!;
const list = () => host.querySelector<HTMLElement>('[data-picker-list]')!;
const filter = () => host.querySelector<HTMLInputElement>(`input[aria-label="${t('folderFilter')}"]`)!;
const draw = async () => {
  await act(() => render(
    <BulkMenu
      count={2}
      folders={folders}
      bookmarks={bookmarks}
      onConfirm={onConfirm}
      onDelete={() => {}}
      onSelectAll={() => {}}
      allSelected={false}
      onClear={() => {}}
    />,
    host,
  ));
  await flush();
};
const open = async () => {
  await draw();
  await click(host.querySelector<HTMLButtonElement>('.bulk-btn')!);
  await click(button('changeFolder'));
};
const input = async (field: HTMLInputElement, value: string) => {
  await act(() => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};

beforeEach(() => {
  installChromeMock();
  onConfirm.mockReset().mockResolvedValue(true);
  storage.setAccountScope('me');
  folders = Array.from({ length: 30 }, (_, index) => ({
    id: `sample_${index}`, name: `架空の棚 ${index}`, icon: 'ti-folder', order: index,
  }));
  bookmarks = ['111', '222'].map(tweetId => ({
    accountId: 'me', tweetId, savedAt: 1, folderIds: ['sample_0', 'sample_1'],
    snapshot: {
      author: '架空の投稿者', handle: '@sample_author', text: '架空の本文',
      media: [], url: `https://x.com/sample_author/status/${tweetId}`,
    },
  }));
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

afterEach(() => {
  render(null, host);
  vi.restoreAllMocks();
});

it('30 個の一覧だけをスクロールし、下部の追加と確定を一覧の外に置く', async () => {
  await open();
  expect(list()).not.toBeNull();
  expect(list().querySelectorAll('label')).toHaveLength(31);
  expect(list().style.overflowY).toBe('auto');
  expect(list().style.overscrollBehavior).toBe('contain');
  for (const key of ['addFolder', 'triageConfirm']) {
    expect(list().contains(button(key))).toBe(false);
    expect(button(key).closest('.bulk-actions')).not.toBeNull();
  }
  expect(host.textContent).not.toContain(t('folderRecent'));
  expect(host.textContent).not.toContain(t('savedInInbox'));
  expect(host.textContent).not.toContain(t('savedInFolders', 2));
});

it('フォルダ変更だけ高さを計算し、resize で更新し、戻ると購読を外す', async () => {
  let viewportHeight = 700;
  vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewportHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  await draw();
  await click(host.querySelector<HTMLButtonElement>('.bulk-btn')!);
  const menu = host.querySelector<HTMLElement>('.menu-bulk')!;
  expect(menu.style.maxHeight).toBe('');
  expect(menu.querySelectorAll('button')).toHaveLength(4);
  await click(button('changeFolder'));
  expect(menu.style.maxHeight).toBe('592px');
  const subscription = added.mock.calls.find(([name]) => name === 'resize')!;
  expect(subscription).toBeDefined();
  viewportHeight = 450;
  window.dispatchEvent(new Event('resize'));
  expect(menu.style.maxHeight).toBe('342px');
  viewportHeight = 200;
  window.dispatchEvent(new Event('resize'));
  expect(parseFloat(menu.style.maxHeight)).toBeGreaterThanOrEqual(160);
  await click(button('back'));
  expect(menu.style.maxHeight).toBe('');
  expect(removed.mock.calls.some(([name, listener]) => name === 'resize' && listener === subscription[1])).toBe(true);
  await click(button('changeFolder'));
  const last = added.mock.calls.filter(([name]) => name === 'resize').at(-1)!;
  await click(host.querySelector<HTMLButtonElement>('.bulk-btn')!);
  expect(removed.mock.calls.some(([name, listener]) => name === 'resize' && listener === last[1])).toBe(true);
});

it.each([0, FILTER_MIN_FOLDERS - 1, FILTER_MIN_FOLDERS])('%i 個のとき絞り込み欄の有無と空でない一覧を保つ', async count => {
  folders = folders.slice(0, count);
  await open();
  expect(filter()?.style.display === 'block').toBe(count >= FILTER_MIN_FOLDERS);
  expect(list()?.querySelectorAll('label')).toHaveLength(count + 1);
  expect(list()?.style.minHeight).toBe('32px');
  expect(button('addFolder')).toBeDefined();
  expect(button('triageConfirm')).toBeDefined();
});

it('絞り込みと一覧内の操作で閉じず、矢印キーで行へ移動する', async () => {
  await open();
  await input(filter(), '架空の棚 29');
  expect(list().querySelectorAll('label')).toHaveLength(1);
  expect(button('addFolder')).toBeDefined();
  expect(button('triageConfirm')).toBeDefined();
  filter().focus();
  filter().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  list().dispatchEvent(new Event('scroll', { bubbles: true }));
  filter().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement).toBe(list().querySelector('input'));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  expect(document.activeElement).toBe(filter());
  expect(host.querySelector('.menu-bulk')).not.toBeNull();
});

it('別タブ相当の増減でも一覧と下部を更新する', async () => {
  await open();
  folders = folders.slice(0, 2);
  await draw();
  expect(list()?.querySelectorAll('label')).toHaveLength(3);
  expect(filter()?.style.display).toBe('none');
  folders = [...folders, { id: 'sample_new', name: '架空の新しい棚', icon: 'ti-star', order: 3 }];
  await draw();
  expect(list()?.querySelectorAll('label')).toHaveLength(4);
  expect(button('addFolder').closest('.bulk-actions')).not.toBeNull();
  expect(button('triageConfirm').closest('.bulk-actions')).not.toBeNull();
});

it('絞り込み中の作成後もクエリを保ち、作ったフォルダは下書きだけに反映する', async () => {
  await open();
  await input(filter(), '架空の棚 29');
  await click(button('addFolder'));
  const form = host.querySelector('form')!;
  await input(form.querySelector('input')!, '架空の棚 29 追加');
  await act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await flush();
  expect(filter()?.value).toBe('架空の棚 29');
  const created = (await storage.listFolders()).find(folder => folder.name === '架空の棚 29 追加')!;
  expect(created).toBeDefined();
  const row = host.querySelector(`[data-picker-folder="${created.id}"]`)!;
  expect(row?.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
  expect(await storage.listBookmarks()).toEqual([]);
  expect(button('addFolder').closest('.bulk-actions')).not.toBeNull();
});

it('高さ制限の経路と下部の折り返しを一括操作の CSS に閉じ込める', () => {
  const css = readFileSync('static/manager.css', 'utf8');
  expect(css).toMatch(/\.menu-bulk\.menu-wide\{[^}]*display:flex/);
  expect(css).toMatch(/\.bulk-picker\{[^}]*min-height:0/);
  expect(css).toMatch(/\.bulk-actions\{[^}]*flex-wrap:wrap/);
});

it('エラーを一覧の外に残し、再保存中は追加ボタンも fieldset で無効にする', async () => {
  onConfirm.mockResolvedValueOnce(false);
  await open();
  await click(host.querySelector<HTMLInputElement>('[data-picker-folder="sample_2"] input')!);
  await click(button('triageConfirm'));
  const error = host.querySelector('.bulk-picker > [role=alert]')!;
  expect(error.textContent).toBe(t('errorStorage'));
  expect(list().contains(error)).toBe(false);
  expect(error.nextElementSibling).toBe(button('triageConfirm').parentElement);
  let finish!: (ok: boolean) => void;
  onConfirm.mockImplementationOnce(() => new Promise<boolean>(resolve => {
    finish = resolve;
  }));
  await click(button('triageConfirm'));
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(button('addFolder').matches(':disabled')).toBe(true);
  expect(button('triageConfirm').disabled).toBe(true);
  await act(async () => finish(true));
  await flush();
  expect(host.querySelector('.menu-bulk')).toBeNull();
});
