import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import * as menus from '../src/shared/folderCreateMenu';
import * as pickers from '../src/shared/folderPicker';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { t } from '../src/shared/strings';
import type { Bookmark, Folder } from '../src/shared/models';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));
const click = async (sel: string) => { await act(() => void document.querySelector<HTMLElement>(sel)!.click()); await flush(); };
let folders: Folder[];
let queue: Bookmark[];
let changed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  storage.setAccountScope('unknown');
  folders = [];
  for (let i = 0; i < 10; i++) folders.push(await storage.createFolder({ name: `Sample ${i}` }));
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], { text: `sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}` });
  queue = await storage.listBookmarks();
  queue.sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  changed = vi.fn();
  vi.spyOn(menus, 'createFolderMenu');
  vi.spyOn(pickers, 'createFolderPicker');
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<Triage queue={queue} live={new Set(['111', '222'])} folders={folders} pickerFolders={folders} onChanged={changed} onClose={() => {}} />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const openCreate = () => click('.triage-folder[aria-keyshortcuts=N]');
async function submit() {
  const input = document.querySelector<HTMLInputElement>('.triage-new input')!;
  await act(() => {
    input.value = 'Created sample';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('.triage-new form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

it.each(['skip', 'back'])('creates for the displayed post after navigating %s with the menu open', async (direction) => {
  if (direction === 'back') await click('[aria-keyshortcuts=ArrowRight]');
  await openCreate();
  await click(`[aria-keyshortcuts=${direction === 'skip' ? 'ArrowRight' : 'ArrowLeft'}]`);
  const id = direction === 'skip' ? '222' : '111';
  expect(document.querySelector('.triage-post')?.textContent).toContain(`sample post ${id}`);
  await submit();
  const created = (await storage.listFolders()).find((f) => f.name === 'Created sample')!;
  expect((await storage.getBookmark(id))?.folderIds).toEqual([created.id]);
  expect((await storage.getBookmark(id === '111' ? '222' : '111'))?.folderIds).toEqual(['inbox']);
});

it('keeps the latest assignment when another folder is chosen with the create menu open', async () => {
  await openCreate();
  await act(() => void document.querySelector('.triage-folder')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
  await flush();
  await submit();
  expect(document.querySelector('.triage-folder')?.getAttribute('aria-pressed')).toBe('true');
});

it('shows errorStorage for a failed other-folder save and clears it after a successful retry', async () => {
  await click('.triage-folder[aria-haspopup=dialog]');
  const change = vi.mocked(pickers.createFolderPicker).mock.calls.at(-1)![0].onChange;
  vi.spyOn(storage, 'setBookmarkFolders').mockRejectedValueOnce(new Error('failed'));
  await act(async () => { await expect(change(new Set([folders[9].id]))).resolves.toBeUndefined(); });
  await flush();
  expect(document.querySelector('.triage > .error')?.textContent).toBe(t('errorStorage'));
  expect(changed).not.toHaveBeenCalled();
  await act(async () => { await change(new Set([folders[9].id])); });
  await flush();
  expect(document.querySelector('.triage > .error')).toBeNull();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[9].id]);
});

it('shows errorStorage if assigning a newly created folder fails', async () => {
  await openCreate();
  const created = await storage.createFolder({ name: 'New sample' });
  const onCreated = vi.mocked(menus.createFolderMenu).mock.calls.at(-1)![0].onCreated;
  vi.spyOn(storage, 'addToFolders').mockRejectedValueOnce(new Error('failed'));
  await act(async () => { await expect(onCreated(created)).resolves.toBeUndefined(); });
  await flush();
  expect(document.querySelector('.triage > .error')?.textContent).toBe(t('errorStorage'));
  expect(changed).not.toHaveBeenCalled();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
  await act(async () => { await onCreated(created); });
  await flush();
  expect(document.querySelector('.triage > .error')).toBeNull();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([created.id]);
});
