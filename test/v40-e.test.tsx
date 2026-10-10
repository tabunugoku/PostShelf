import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
let folders: Folder[];
let queue: Bookmark[];
let changed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  storage.setAccountScope('unknown');
  folders = [];
  for (let i = 1; i <= 12; i++) folders.push(await storage.createFolder({ name: `Sample folder ${i}` }));
  for (const id of ['111', '222', '333']) await storage.setBookmarkFolders(id, [], { text: `Sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}` });
  queue = (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  changed = vi.fn();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const mount = async (posts = queue) => {
  await act(() => void render(<Triage queue={posts} live={new Set(posts.map((b) => b.tweetId))} folders={folders} pickerFolders={folders} onChanged={changed} onClose={() => {}} />, document.querySelector('#app')!));
  await flush();
};
const open = async () => {
  await act(() => void document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup=dialog]')!.click());
  await flush();
};
const box = (name: string) => [...document.querySelectorAll<HTMLLabelElement>('.menu label')]
  .find((el) => el.textContent === name)!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
const toggle = async (name: string) => {
  const cb = box(name);
  cb.focus();
  await act(() => void cb.click());
  await flush();
};
const expectProgress = (n: number) => {
  expect(document.querySelector('.triage-progress')?.textContent).toBe(t('triageProgress', n, 3));
  expect(document.querySelector('.triage-post')?.textContent).toContain(`Sample post ${queue[n - 1].tweetId}`);
};

it('saves a new checkbox assignment, closes, advances once and keeps digit shortcuts working', async () => {
  await mount();
  await open();
  await toggle(folders[9].name);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[9].id]);
  expect(document.querySelector('.menu')).toBeNull();
  expectProgress(2);
  expect(document.querySelector('.triage')!.contains(document.activeElement)).toBe(true);
  await act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })));
  await flush();
  expect((await storage.getBookmark('222'))?.folderIds).toEqual([folders[0].id]);
  expectProgress(3);
});

it('stays open when unchecking the last folder, then advances when it is checked again', async () => {
  await storage.setBookmarkFolders('111', [folders[9].id], queue[0].snapshot);
  queue[0].folderIds = [folders[9].id];
  await mount();
  await open();
  await toggle(folders[9].name);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
  expect(document.querySelector('.menu')).not.toBeNull();
  expectProgress(1);
  await toggle(folders[9].name);
  expectProgress(2);
  expect(document.querySelector('.menu')).toBeNull();
});

it('finishes after classifying the last post', async () => {
  await mount([queue[0]]);
  await open();
  await toggle(folders[9].name);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[9].id]);
  expect(document.querySelector('.menu')).toBeNull();
  expect(document.querySelector('#triage-title')?.textContent).toBe(t('triageDone'));
  expect(document.querySelector('.triage [role=status]')?.textContent).toBe(t('triageDoneSub', 1));
});

it('shows the storage error without advancing and allows a successful retry', async () => {
  await mount();
  await open();
  vi.spyOn(storage, 'setBookmarkFolders').mockRejectedValueOnce(new Error('Sample storage failure'));
  await toggle(folders[9].name);
  expectProgress(1);
  expect(document.querySelector('.menu')).not.toBeNull();
  expect(document.querySelector('.triage .error')?.textContent).toBe(t('errorStorage'));
  expect(changed).not.toHaveBeenCalled();
  await toggle(folders[10].name);
  expectProgress(2);
  expect(document.querySelector('.menu')).toBeNull();
  expect(document.querySelector('.triage .error')).toBeNull();
});

it('advances after picker creation and remembers its assignment when revisiting', async () => {
  await mount();
  await open();
  const add = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent === t('addFolder'))!;
  await act(() => void add.click());
  const input = document.querySelector<HTMLInputElement>('.menu form input')!;
  await act(() => {
    input.value = 'Created sample';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('.menu form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
  const created = (await storage.listFolders()).find((f) => f.name === 'Created sample')!;
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([created.id]);
  expectProgress(2);
  expect(document.querySelector('.menu')).toBeNull();
  folders.push(created); await mount();
  await act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  await flush(); await open();
  expectProgress(1);
  expect(document.querySelector('.menu')).not.toBeNull();
  expect(box(created.name).checked).toBe(true);
  await toggle(created.name); // 作成後の割り当ても、最新の状態で「外した」と判定する
  expectProgress(1);
  expect(document.querySelector('.menu')).not.toBeNull();
  await toggle(created.name);
  expectProgress(2);
});

it('ignores repeated picker and shortcut assignments while a save is pending', async () => {
  await mount();
  await open();
  const original = storage.setBookmarkFolders;
  let finish!: () => void;
  const gate = new Promise<void>((r) => { finish = r; });
  const save = vi.spyOn(storage, 'setBookmarkFolders').mockImplementation(async (...args) => { await gate; return original(...args); });
  await toggle(folders[9].name);
  await toggle(folders[10].name);
  await act(() => void document.querySelector<HTMLButtonElement>('.triage-folder')!.click());
  expect(save).toHaveBeenCalledOnce();
  expectProgress(1);
  await act(async () => { finish(); await gate; });
  await flush();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[9].id]);
  expect((await storage.getBookmark('222'))?.folderIds).toEqual(['inbox']);
  expectProgress(2);
  expect(changed).toHaveBeenCalledOnce();
});
