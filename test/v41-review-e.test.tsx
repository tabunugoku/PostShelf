import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { updateSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 40)));
let folder: Folder;
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); history.replaceState(null, '', '/');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folder = await storage.createFolder({ name: 'Sample folder' });
  for (let i = 1; i <= 65; i++) await storage.setBookmarkFolders(String(i), [], {
    text: `Sample ${i <= 40 ? 'match' : 'other'} ${i}`, author: 'Sample', handle: '@sample_user',
    media: i % 2 === 0 ? ['https://example.test/sample.jpg'] : [], url: `https://x.com/sample_user/status/${i}`,
  });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const mount = async () => { await act(() => void render(<App />, document.querySelector('#app')!)); await flush(); };
const click = async (el: HTMLElement) => { expect(el).not.toBeNull(); await act(() => void el.click()); await flush(); };
const menuItem = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.menu-bulk .menu-item')].find(b => b.textContent?.trim() === text)!;
const bulk = () => document.querySelector<HTMLButtonElement>('.bulk-btn')!;
const count = (n: number) => expect(bulk()?.querySelector('strong')?.textContent).toBe(t('selectedCount', n));
const search = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(() => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }); await flush();
};
const ctrlA = async () => {
  await act(() => void document.querySelector('.rows')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))); await flush();
};

it('selects all filtered results including unrendered posts, excluding other results', async () => {
  await mount(); expect(bulk()).toBeNull(); await search('match');
  expect(document.querySelectorAll('[data-row]')).toHaveLength(30);
  await click(document.querySelector<HTMLInputElement>('.sel')!); await click(bulk());
  expect([...document.querySelectorAll('.menu-bulk .menu-item')].map(b => b.textContent?.trim())).toEqual([t('changeFolder'), t('delete'), t('selectAll'), t('clearSelection')]);
  await click(menuItem(t('selectAll'))); count(40); expect(document.querySelector('.menu-bulk')).toBeNull();
  await click(bulk()); await click(menuItem(t('changeFolder')));
  const box = [...document.querySelectorAll('.menu-bulk label')].find(el => el.textContent === folder.name)!.querySelector<HTMLInputElement>('input')!;
  await click(box);
  expect((await storage.listBookmarks()).every(b => !b.folderIds.includes(folder.id))).toBe(true);
  await click([...document.querySelectorAll<HTMLButtonElement>('.menu-bulk button')].find(b => b.textContent?.trim() === t('triageConfirm'))!);
  const bookmarks = await storage.listBookmarks();
  expect(bookmarks.filter(b => b.folderIds.includes(folder.id)).map(b => b.tweetId).sort()).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)).sort());
  expect(bookmarks.filter(b => Number(b.tweetId) > 40).every(b => b.folderIds.join() === 'inbox')).toBe(true);
});

it('prunes selection to the shown results on search and filter changes without selecting new matches', async () => {
  await mount(); await ctrlA(); count(65); await search('match'); count(40);
  await click([...document.querySelectorAll<HTMLButtonElement>('.chip.filter')].find(b => b.textContent?.trim() === t('filterImage'))!); count(20);
  await search(''); count(20); // 絞り込みを緩めても、前に選ばれていなかったポストは追加しない。
});

it('removes an individually selected post when search hides it', async () => {
  await mount(); await click(document.querySelector<HTMLInputElement>('[data-row="65"] .sel')!); count(1);
  await search('match'); expect(bulk()).toBeNull();
});

it('disables Select all when every shown result is already selected', async () => {
  await mount(); await ctrlA(); await click(bulk());
  expect(menuItem(t('selectAll')).disabled).toBe(true); count(65);
});

it('keeps existing selection clearing on folder changes', async () => {
  await mount(); await ctrlA(); count(65);
  await click([...document.querySelectorAll<HTMLElement>('.fr')].find(el => el.querySelector('.fr-name')?.textContent === folder.name)!);
  expect(bulk()).toBeNull();
});

it('keeps selection within the current account after switching accounts', async () => {
  await storage.noteAccount({ handle: 'sample_other' }); storage.setAccountScope('sample_other');
  await storage.setBookmarkFolders('999', [], { text: 'Sample other account', author: 'Sample', handle: '@sample_other', media: [], url: 'https://x.com/sample_other/status/999' });
  storage.setAccountScope('unknown'); await updateSettings({ viewAccount: 'unknown' });
  await mount(); await ctrlA(); count(65); await click(document.querySelector<HTMLButtonElement>('.acct-btn')!);
  await click([...document.querySelectorAll<HTMLButtonElement>('.acct-main')].find(b => b.textContent?.includes('@sample_other'))!);
  expect(bulk()).toBeNull(); expect([...document.querySelectorAll('[data-row]')].map(el => el.getAttribute('data-row'))).toEqual(['999']);
});

it('has the exact Select all translations in every locale', () => {
  const labels = { ja: 'すべて選択', en: 'Select all', zh_CN: '全选', zh_TW: '全選', ko: '모두 선택', es: 'Seleccionar todo', pt_BR: 'Selecionar tudo', fr: 'Tout sélectionner' };
  for (const [locale, message] of Object.entries(labels)) {
    expect(JSON.parse(readFileSync(`static/_locales/${locale}/messages.json`, 'utf8')).selectAll).toEqual({ message });
  }
  expect(readFileSync('node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css', 'utf8')).toContain('.ti-checks:before');
});
