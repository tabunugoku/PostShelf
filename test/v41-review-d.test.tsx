import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 40)));
let folders: Folder[];
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folders = [];
  for (const name of ['Sample A', 'Sample B', 'Sample C']) folders.push(await storage.createFolder({ name }));
  const assignments = [[folders[0].id], [folders[0].id, folders[1].id], [folders[1].id]];
  for (let i = 0; i < 3; i++) await storage.setBookmarkFolders(String(i + 1), assignments[i], {
    text: `Sample post ${i + 1}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${i + 1}`,
  });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const click = async (el: HTMLElement) => { expect(el).not.toBeNull(); await act(() => void el.click()); await flush(); };
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.menu-bulk button')].find(b => b.textContent?.trim().replace(/^← /, '') === text.replace(/^← /, ''))!;
const box = (text: string) => [...document.querySelectorAll('.menu-bulk label')].find(el => el.textContent === text)!.querySelector<HTMLInputElement>('input')!;
const ids = async () => (await storage.listBookmarks()).sort((a,b) => a.tweetId.localeCompare(b.tweetId)).map(b => b.folderIds);
const mount = async (surface: 'tab' | 'sidepanel' = 'tab') => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(surface === 'tab' ? 1280 : 390);
  await act(() => void render(<App surface={surface} />, document.querySelector('#app')!)); await flush();
  await act(() => void document.querySelector('.rows')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))); await flush();
  await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!);
};
const open = () => click(byText(t('changeFolder')));

it.each(['tab', 'sidepanel'] as const)('shows mixed states and adds to every selected post on %s', async surface => {
  await mount(surface);
  expect([...document.querySelectorAll('.menu-bulk .menu-item')].map(b => b.textContent?.trim())).toEqual([t('changeFolder'), t('delete'), t('clearSelection')]);
  await open();
  for (const name of ['Sample A', 'Sample B']) {
    expect(box(name).indeterminate).toBe(true); expect(box(name).getAttribute('aria-checked')).toBe('mixed'); expect(box(name).checked).toBe(false);
  }
  expect(box('Sample C').checked).toBe(false); expect(box('Sample C').indeterminate).toBe(false);
  await click(box('Sample A'));
  expect((await ids()).every(a => a.includes(folders[0].id))).toBe(true);
  expect(box('Sample A').checked).toBe(true); expect(box('Sample A').indeterminate).toBe(false);
  expect(box('Sample B').indeterminate).toBe(true); expect(document.querySelector('.menu-bulk')).not.toBeNull();
  expect(document.querySelector('.toast')?.textContent).toContain(t('toastAdded', 1));
});

it('removes a checked folder from everyone and returns posts with no folders to inbox', async () => {
  await mount(); await open(); await click(box('Sample A')); await click(box('Sample A'));
  expect(await ids()).toEqual([['inbox'], [folders[1].id], [folders[1].id]]);
  expect(box('Sample A').checked).toBe(false); expect(box(t('inboxName')).indeterminate).toBe(true);
  await click(box('Sample B')); await click(box('Sample B'));
  expect(await ids()).toEqual([['inbox'], ['inbox'], ['inbox']]); expect(box(t('inboxName')).checked).toBe(true);
});

it('sets every selected post to inbox when its row is pressed', async () => {
  await mount(); await open(); await click(box(t('inboxName')));
  expect(await ids()).toEqual([['inbox'], ['inbox'], ['inbox']]);
  expect(box('Sample A').checked).toBe(false); expect(box('Sample A').indeterminate).toBe(false);
  expect(box(t('inboxName')).checked).toBe(true);
});

it('creates with an extra icon and adds the new folder to everyone without closing the list', async () => {
  await mount(); await open(); await click(byText(t('addFolder')));
  const input = document.querySelector<HTMLInputElement>('.menu-bulk form input')!;
  await act(() => { input.value = 'Sample new'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click(document.querySelector<HTMLButtonElement>('.menu-bulk [data-icon-more]')!);
  await click(document.querySelector<HTMLButtonElement>('.menu-bulk [data-icon="ti-cat"]')!);
  await act(() => void document.querySelector('.menu-bulk form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush(); await flush();
  const f = (await storage.listFolders()).find(f => f.name === 'Sample new')!;
  expect(f.icon).toBe('ti-cat'); expect((await ids()).every(a => a.includes(f.id))).toBe(true);
  expect(box('Sample new').checked).toBe(true); expect(document.querySelector('.menu-bulk')).not.toBeNull();
});

it('restores persisted mixed states and shows the storage error after a failed save', async () => {
  await mount(); await open(); const before = await ids();
  vi.spyOn(storage, 'addToFolders').mockRejectedValueOnce(new Error('Sample failure'));
  await click(box('Sample A'));
  expect(await ids()).toEqual(before); expect(box('Sample A').checked).toBe(false); expect(box('Sample A').indeterminate).toBe(true);
  expect(document.querySelector('.toast')?.textContent).toBe(t('errorStorage'));
});

it('prevents a second toggle while the bulk save is pending', async () => {
  await mount(); await open(); const original = storage.addToFolders; let finish!: () => void;
  const gate = new Promise<void>(r => { finish = r; });
  const add = vi.spyOn(storage, 'addToFolders').mockImplementation(async (...args) => { await gate; return original(...args); });
  await click(box('Sample A')); await click(box('Sample B')); expect(add).toHaveBeenCalledOnce();
  await act(async () => { finish(); await gate; }); await flush(); await flush();
  expect(box('Sample A').checked).toBe(true); expect(box('Sample B').indeterminate).toBe(true);
});

it('returns to the main menu and removes the unused bulk action translations', async () => {
  await mount(); await open(); await click(byText(`← ${t('back')}`));
  expect(byText(t('changeFolder'))).not.toBeNull();
  for (const locale of ['ja','en','zh_CN','zh_TW','ko','es','pt_BR','fr']) {
    const d = JSON.parse(readFileSync(`static/_locales/${locale}/messages.json`, 'utf8'));
    expect(d.bulkAdd).toBeUndefined(); expect(d.bulkRemove).toBeUndefined();
  }
});
