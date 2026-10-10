import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
let folders: Folder[], queue: Bookmark[], closed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown');
  folders = [];
  for (let i = 1; i <= 10; i++) folders.push(await storage.createFolder({ name: `Sample folder ${i}` }));
  await storage.setBookmarkFolders('111', [], { text: 'Sample post', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/111' });
  queue = await storage.listBookmarks(); closed = vi.fn(); document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<Triage queue={queue} folders={folders} pickerFolders={folders} live={new Set(['111'])} onChanged={() => {}} onClose={closed} />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const trigger = () => document.querySelector<HTMLButtonElement>('[aria-keyshortcuts=N]')!;
const click = async (el: HTMLElement) => { await act(() => void el.click()); await flush(); };
const escape = async (el: HTMLElement) => {
  await act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await flush();
};

it('opens N creation in a fixed menu with the same width and stacking as other folders', async () => {
  await click(document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!);
  const other = document.querySelector('.menu')!;
  expect(other.classList.contains('menu-wide')).toBe(true); expect(other.classList.contains('menu-over')).toBe(true);
  await escape(document.querySelector('.triage')!); await click(trigger());
  const host = document.querySelector('.triage-new')!; const menu = host.closest('.menu')!;
  expect(menu).not.toBeNull(); expect(menu.classList.contains('fixed')).toBe(true);
  expect(menu.classList.contains('menu-wide')).toBe(true); expect(menu.classList.contains('menu-over')).toBe(true);
  expect(document.querySelector('.triage')?.contains(host)).toBe(false);
  expect(readFileSync('static/manager.css', 'utf8')).not.toMatch(/\.triage-new\s*\{/);
});

it('Escape closes only the N menu and restores focus to its trigger', async () => {
  await click(trigger()); await escape(document.querySelector<HTMLInputElement>('.triage-new input')!);
  expect(document.querySelector('.triage-new')).toBeNull(); expect(closed).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger());
});

it('outside click closes the N menu without closing triage or creating anything', async () => {
  const create = vi.spyOn(storage, 'createFolder'); await click(trigger());
  await act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await flush();
  expect(document.querySelector('.triage-new')).toBeNull(); expect(closed).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled(); expect(document.activeElement).toBe(trigger());
});
