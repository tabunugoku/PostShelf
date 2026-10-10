import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFolderPicker } from '../src/shared/folderPicker';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import { getSettings } from '../src/shared/settings';
import { ALL_FOLDER_ID, INBOX_ID, type Bookmark, type Folder } from '../src/shared/models';
import { t } from '../src/shared/strings';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
let folders: Folder[], queue: Bookmark[], changed: ReturnType<typeof vi.fn>;
const renderCurrent = () => render(<Triage queue={queue} live={new Set(queue.map(b => b.tweetId))}
  folders={folders} pickerFolders={folders} onChanged={changed} onClose={() => {}} />, document.querySelector('#app')!);
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); folders = [];
  for (let i = 1; i <= 10; i++) folders.push(await storage.createFolder({ name: 'Sample folder ' + i }));
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], {
    text: 'Sample post ' + id, author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/' + id,
  });
  queue = (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  changed = vi.fn(async () => { folders = (await storage.listFolders()).filter(f => f.id !== ALL_FOLDER_ID && f.id !== INBOX_ID); renderCurrent(); });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const mount = async () => { await act(() => void renderCurrent()); await flush(); };
const click = async (el: HTMLElement) => { await act(() => void el.click()); await flush(); };
const key = async (key: string) => {
  await act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {
    key, code: /^[1-9]$/.test(key) ? 'Digit' + key : key, bubbles: true, cancelable: true,
  }))); await flush();
};
const progress = (n: number) => expect(document.querySelector('.triage-progress')?.textContent).toBe(t('triageProgress', n, queue.length));
const prepare = async (source: 'N' | 'other') => {
  if (source === 'N') await key('n');
  else {
    await click(document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!);
    await click([...document.querySelectorAll<HTMLButtonElement>('.menu button')].find(b => b.textContent === t('addFolder'))!);
  }
  const input = document.querySelector<HTMLInputElement>('.menu form input')!;
  await act(() => { input.value = 'Sample created'; input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const submit = async () => {
  await act(() => void document.querySelector('.menu form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush();
};
const created = async () => (await storage.listFolders()).find(f => f.name === 'Sample created')!;

it.each(['N', 'other'] as const)('adds the %s-created folder, records it and advances with keyboard focus', async source => {
  queue[0].folderIds = [folders[1].id]; await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(); await prepare(source);
  const add = vi.spyOn(storage, 'addToFolders'); const save = vi.spyOn(storage, 'setBookmarkFolders');
  await submit(); const f = await created();
  expect(add).toHaveBeenCalledExactlyOnceWith(['111'], [f.id]); expect(save).not.toHaveBeenCalled();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[1].id, f.id]);
  expect((await getSettings()).recentFolderIds).toEqual([f.id]); expect(changed).toHaveBeenCalledOnce();
  progress(2); expect(document.querySelector('.triage-post')?.textContent).toContain('Sample post 222');
  expect(document.querySelector('.menu')).toBeNull(); expect(document.querySelector('.triage')?.contains(document.activeElement)).toBe(true);
  await key('1'); expect(add).toHaveBeenLastCalledWith(['222'], [folders[0].id]);
});

it.each(['N', 'other'] as const)('finishes when a %s-created folder is assigned to the final post', async source => {
  queue = [queue[0]]; await mount(); await prepare(source); await submit(); const f = await created();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([f.id]);
  expect(document.querySelector('#triage-title')?.textContent).toBe(t('triageDone'));
  expect(document.querySelector('[role=status]')?.textContent).toBe(t('triageDoneSub', 1));
  expect(document.querySelector('.menu')).toBeNull();
});

it.each(['N', 'other'] as const)('retries only assignment after %s creation fails without creating a duplicate', async source => {
  await mount(); await prepare(source); const create = vi.spyOn(storage, 'createFolder');
  const add = vi.spyOn(storage, 'addToFolders').mockRejectedValueOnce(new Error('Sample failure'));
  await submit(); const f = await created(); progress(1);
  expect(document.querySelector('.triage .error')?.textContent).toBe(t('errorStorage'));
  expect(document.querySelector('.menu')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('.menu form input')?.readOnly).toBe(true);
  expect([...document.querySelectorAll<HTMLButtonElement>('.menu [data-icon],.menu [data-color]')].every(b => b.disabled)).toBe(true);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([INBOX_ID]);
  expect((await getSettings()).recentFolderIds).toEqual([]); expect(changed).not.toHaveBeenCalled();
  await submit(); progress(2); expect(create).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledTimes(2);
  expect(add).toHaveBeenLastCalledWith(['111'], [f.id]); expect(changed).toHaveBeenCalledOnce();
  expect((await storage.listFolders()).filter(folder => folder.name === 'Sample created')).toHaveLength(1);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([f.id]); expect(document.querySelector('.menu')).toBeNull();
});

it.each(['N', 'other'] as const)('does not create or assign twice while %s creation is pending', async source => {
  await mount(); await prepare(source); const create = vi.spyOn(storage, 'createFolder'); const original = storage.addToFolders;
  let finish!: () => void; const gate = new Promise<void>(r => finish = r);
  const add = vi.spyOn(storage, 'addToFolders').mockImplementation(async (...args) => { await gate; return original(...args); });
  await submit(); await submit(); expect(create).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledOnce(); progress(1);
  await act(async () => { finish(); await gate; }); await flush(); progress(2); expect(changed).toHaveBeenCalledOnce();
});

it('keeps the shared picker creation pending after false and adds only one row on retry', async () => {
  const change = vi.fn<Parameters<typeof createFolderPicker>[0]['onChange']>().mockReturnValueOnce(false);
  const picker = createFolderPicker({ folders: [], selected: new Set(), theme: { fg: '#000', border: '#888', hover: '#eee', accent: '#00f' }, onChange: change });
  document.querySelector('#app')!.replaceChildren(picker.el);
  await click([...picker.el.querySelectorAll('button')].find(b => b.textContent === t('addFolder'))!);
  const input = picker.el.querySelector('form input')! as HTMLInputElement;
  input.value = 'Sample created'; input.dispatchEvent(new Event('input'));
  const create = vi.spyOn(storage, 'createFolder');
  const form = picker.el.querySelector('form')!;
  await act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush();
  expect(form.hidden).toBe(false); expect(input.readOnly).toBe(true);
  await act(() => void form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush();
  expect(create).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledTimes(2); expect(form.hidden).toBe(true);
  const rows = [...picker.el.querySelectorAll('label')].filter(el => el.textContent === 'Sample created');
  expect(rows).toHaveLength(1); expect(rows[0].querySelector<HTMLInputElement>('input')?.checked).toBe(true);
});
