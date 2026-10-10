import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const dialog = () => document.querySelector<HTMLElement>('.triage')!;
const key = async (key: string, code = key) => {
  await act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })));
  await flush();
};
const click = async (selector: string) => {
  await act(() => void document.querySelector<HTMLElement>(selector)!.click());
  await flush();
};
let folders: Folder[];
let queue: Bookmark[];
let closed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  storage.setAccountScope('unknown');
  folders = [];
  for (let i = 0; i < 10; i++) folders.push(await storage.createFolder({ name: `Sample ${i + 1}` }));
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], { text: `Sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}` });
  queue = (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  closed = vi.fn();
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<Triage queue={queue} live={new Set(queue.map((b) => b.tweetId))} folders={folders} pickerFolders={folders} onChanged={() => {}} onClose={closed} />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});

it.each(['new', 'other'])('restores keyboard sorting after Escape removes the focused %s menu', async (kind) => {
  const add = vi.spyOn(storage, 'addToFolders');
  if (kind === 'new') await key('n', 'KeyN');
  else await click('.triage-folder[aria-haspopup=dialog]');
  const input = document.querySelector<HTMLInputElement>(kind === 'new' ? '.triage-new input' : '.menu input')!;
  input.focus();
  await key('1', 'Digit1');
  expect(add).not.toHaveBeenCalled(); // 入力欄では数字キーを奪わない
  await key('Escape');
  expect(document.querySelector(kind === 'new' ? '.triage-new' : '.menu')).toBeNull();
  expect(dialog().contains(document.activeElement)).toBe(true);
  expect(closed).not.toHaveBeenCalled();
  await key('1', 'Digit1');
  expect(add).toHaveBeenCalledWith(['111'], [folders[0].id]);
  await key('ArrowLeft');
  expect(dialog().textContent).toContain('Sample post 111');
  await key('Escape');
  expect(closed).toHaveBeenCalledOnce();
});

it('restores focus after successful folder creation removes its focused input', async () => {
  await key('n', 'KeyN');
  const input = document.querySelector<HTMLInputElement>('.triage-new input')!;
  expect(document.activeElement).toBe(input);
  await act(() => {
    input.value = 'Created sample';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('.triage-new form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
  expect(document.querySelector('.triage-new')).toBeNull();
  expect(dialog().contains(document.activeElement)).toBe(true);
  const created = (await storage.listFolders()).find((f) => f.name === 'Created sample')!;
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([created.id]);
  expect(dialog().textContent).toContain('Sample post 222');
  await key('1', 'Digit1');
  expect((await storage.getBookmark('222'))?.folderIds).toEqual([folders[0].id]);
});

it('preserves focus on a remaining trigger when closing its menu', async () => {
  const trigger = document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup=dialog]')!;
  trigger.focus();
  await click('.triage-folder[aria-haspopup=dialog]');
  await key('Escape');
  expect(document.activeElement).toBe(trigger);
});
