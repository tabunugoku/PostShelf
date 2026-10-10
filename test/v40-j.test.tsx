import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
const row = (name: string) => [...document.querySelectorAll('.fr')].find(r => r.querySelector('.fr-name')?.textContent === name)!;
const editor = () => document.querySelector<HTMLElement>('.folder-edit')!;
const save = () => editor()?.querySelector<HTMLButtonElement>('button.primary')!;
let folders: Folder[];
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  storage.setAccountScope('unknown');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folders = [];
  for (const name of ['Sample A', 'Sample B']) folders.push(await storage.createFolder({ name }));
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const click = async (el: Element) => {
  expect(el).not.toBeNull();
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flush();
};
const open = (name = 'Sample A') => click(row(name).querySelector('.more-btn')!);
const name = async (value: string) => {
  const input = editor().querySelector<HTMLInputElement>('input')!;
  await act(() => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const key = async (key: string) => {
  await act(() => void editor().querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  await flush();
};
const customize = async () => {
  await name('Sample Draft');
  await click(editor().querySelector('[data-icon="ti-star"]')!);
  await click(editor().querySelector('[data-color="#378ADD"]')!);
};
const stored = async () => (await storage.listFolders()).find(f => f.id === folders[0].id)!;
const newButton = () => [...document.querySelectorAll('.fr.add')].find(el => el.textContent === t('newFolder'))!;

it('keeps name, icon and color in a draft and saves them together once', async () => {
  const update = vi.spyOn(storage, 'updateFolder');
  await open();
  await customize();
  await act(() => void editor().querySelector('input')!.dispatchEvent(new Event('blur')));
  await flush();
  expect(update).not.toHaveBeenCalled();
  expect(await stored()).toMatchObject({ name: 'Sample A', icon: 'ti-folder' });
  expect((await stored()).color).toBeUndefined();
  expect(editor().querySelector('[data-icon="ti-star"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(editor().querySelector('[data-color="#378ADD"]')?.getAttribute('aria-pressed')).toBe('true');
  await click(save());
  expect(update).toHaveBeenCalledExactlyOnceWith(folders[0].id, { name: 'Sample Draft', icon: 'ti-star', color: '#378ADD' });
  expect(await stored()).toMatchObject({ name: 'Sample Draft', icon: 'ti-star', color: '#378ADD' });
  expect(editor()).toBeNull();
});

it.each(['Escape', 'outside', 'other'])('discards the draft on %s and reopens the original values', async (close) => {
  const update = vi.spyOn(storage, 'updateFolder');
  await open();
  await customize();
  if (close === 'Escape') await key('Escape');
  else if (close === 'outside') {
    await act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await flush();
  } else { await open('Sample B'); await key('Escape'); }
  expect(editor()).toBeNull();
  expect(update).not.toHaveBeenCalled();
  await open();
  expect(editor().querySelector<HTMLInputElement>('input')?.value).toBe('Sample A');
  expect(editor().querySelector('[data-icon="ti-folder"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(editor().querySelector('.sw-none')?.getAttribute('aria-pressed')).toBe('true');
});

it('closes unchanged drafts without a storage write', async () => {
  const update = vi.spyOn(storage, 'updateFolder');
  await open();
  await click(save());
  expect(update).not.toHaveBeenCalled();
  expect(editor()).toBeNull();
});

it('saves only the changed fields on Enter and can clear a color', async () => {
  await storage.updateFolder(folders[0].id, { color: '#378ADD' });
  await flush();
  const update = vi.spyOn(storage, 'updateFolder');
  await open();
  await click(editor().querySelector('.sw-none')!);
  await key('Enter');
  expect(update).toHaveBeenCalledExactlyOnceWith(folders[0].id, { color: null });
  expect((await stored()).color).toBeUndefined();
  expect(editor()).toBeNull();
});

it.each(['   ', ' sample b ', '未分類'])('rejects an empty or duplicate name: %s', async (value) => {
  const update = vi.spyOn(storage, 'updateFolder');
  await open();
  await name(value);
  await key('Enter');
  expect(update).not.toHaveBeenCalled();
  expect((await stored()).name).toBe('Sample A');
  expect(editor()).not.toBeNull();
  expect(editor().textContent).toContain(t(value.trim() ? 'errDuplicateFolder' : 'errEmptyName'));
});

it('keeps a failed save open with its draft and permits retry', async () => {
  await open();
  await name('Sample Draft');
  vi.spyOn(storage, 'updateFolder').mockRejectedValueOnce(new Error('Sample storage failure'));
  await click(save());
  expect(editor().textContent).toContain(t('errorStorage'));
  expect(editor().querySelector<HTMLInputElement>('input')?.value).toBe('Sample Draft');
  expect((await stored()).name).toBe('Sample A');
  await click(save());
  expect(editor()).toBeNull();
  expect((await stored()).name).toBe('Sample Draft');
});

it('starts creation without writing and creates once with all draft values', async () => {
  const create = vi.spyOn(storage, 'createFolder');
  await click(newButton());
  expect(create).not.toHaveBeenCalled();
  expect(await storage.listFolders()).toHaveLength(3);
  expect(editor().querySelector<HTMLInputElement>('input')?.value).toBe('');
  expect(save().disabled).toBe(true);
  expect(editor().querySelector('.danger')).toBeNull();
  await customize();
  expect(create).not.toHaveBeenCalled();
  await click(save());
  expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Sample Draft', icon: 'ti-star', color: '#378ADD' });
  const all = await storage.listFolders();
  expect(all).toHaveLength(4);
  expect(all.find(f => f.name === 'Sample Draft')).toMatchObject({ icon: 'ti-star', color: '#378ADD' });
  expect(document.querySelector('.bar-name')?.textContent).toBe('Sample Draft');
  expect(editor()).toBeNull();
});

it.each(['Escape', 'outside'])('creates nothing when cancelled by %s', async (close) => {
  const create = vi.spyOn(storage, 'createFolder');
  await click(newButton());
  await name('Sample Draft');
  if (close === 'Escape') await key('Escape');
  else {
    await act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await flush();
  }
  expect(editor()).toBeNull();
  expect(create).not.toHaveBeenCalled();
  expect(await storage.listFolders()).toHaveLength(3);
});

it('keeps failed creation open and rejects duplicate creation', async () => {
  const create = vi.spyOn(storage, 'createFolder');
  await click(newButton());
  await name('Sample B');
  await key('Enter');
  expect(create).not.toHaveBeenCalled();
  expect(editor().textContent).toContain(t('errDuplicateFolder'));
  await name('Sample Draft');
  create.mockRejectedValueOnce(new Error('Sample storage failure'));
  await click(save());
  expect(editor().textContent).toContain(t('errorStorage'));
  expect(await storage.listFolders()).toHaveLength(3);
});

it('discards edits when deleting and retains the confirmation flow', async () => {
  const update = vi.spyOn(storage, 'updateFolder');
  await open();
  await customize();
  await click(editor().querySelector('.danger')!);
  expect(update).not.toHaveBeenCalled();
  expect(editor()).toBeNull();
  expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
  expect((await stored()).name).toBe('Sample A');
});

it('puts Delete at the left and Save last on a single action row', async () => {
  await open();
  const actions = save().parentElement!;
  expect(actions.classList.contains('erow')).toBe(true);
  expect([...actions.querySelectorAll('button')].map(b => b.textContent?.trim())).toEqual([t('delete'), t('save')]);
  const css = readFileSync('static/manager.css', 'utf8');
  expect(css).toMatch(/\.folder-edit \.folder-actions\{[^}]*justify-content:flex-end/);
  expect(css).toMatch(/\.folder-edit \.folder-actions\{[^}]*flex-wrap:nowrap/);
  expect(css).toMatch(/\.folder-edit \.folder-actions > :first-child\{[^}]*margin-right:auto/);
});

it('allows only one save while pending', async () => {
  await open();
  await name('Sample Draft');
  const original = storage.updateFolder;
  let finish!: () => void;
  const gate = new Promise<void>(r => { finish = r; });
  const update = vi.spyOn(storage, 'updateFolder').mockImplementation(async (id, patch) => { await gate; return original(id, patch); });
  await click(save());
  expect(save().disabled).toBe(true);
  await key('Enter');
  expect(update).toHaveBeenCalledOnce();
  await act(async () => { finish(); await gate; });
  await flush();
  expect(editor()).toBeNull();
});

it('does not close a different editor when a dismissed save finishes', async () => {
  await open();
  await name('Sample Draft');
  const original = storage.updateFolder;
  let finish!: () => void;
  const gate = new Promise<void>(r => { finish = r; });
  vi.spyOn(storage, 'updateFolder').mockImplementation(async (id, patch) => { await gate; return original(id, patch); });
  await click(save());
  await key('Escape');
  await open('Sample B');
  await act(async () => { finish(); await gate; });
  await flush();
  expect(editor().querySelector<HTMLInputElement>('input')?.value).toBe('Sample B');
});

it('also opens draft creation from the narrow folder menu', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(340);
  await act(() => void window.dispatchEvent(new Event('resize')));
  await flush();
  expect(document.querySelector('.layout-narrow')).not.toBeNull();
  const create = vi.spyOn(storage, 'createFolder');
  await click(document.querySelector('.folder-btn')!);
  await click([...document.querySelectorAll('.menu-item')].find(el => el.textContent?.trim() === t('newFolder'))!);
  expect(create).not.toHaveBeenCalled();
  expect(editor()).not.toBeNull();
  expect(document.querySelector('.menu-edit')?.classList.contains('fixed')).toBe(true);
  await name('Sample Narrow');
  await key('Enter');
  expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Sample Narrow', icon: 'ti-folder', color: undefined });
  expect(editor()).toBeNull();
  expect(document.querySelector('.folder-btn .fr-name')?.textContent).toBe('Sample Narrow');
});

it('puts Cancel before Save for creation and cancels without creating', async () => {
  const create = vi.spyOn(storage, 'createFolder');
  await click(newButton()); await name('Sample cancelled');
  const buttons = [...editor().querySelectorAll<HTMLButtonElement>('.folder-actions button')];
  expect(buttons.map(b => b.textContent?.trim())).toEqual([t('cancel'), t('save')]);
  expect(editor().querySelector('.danger')).toBeNull();
  await click(buttons[0]);
  expect(editor()).toBeNull(); expect(create).not.toHaveBeenCalled();
});
it('disables both Cancel and Save while creation is pending', async () => {
  await click(newButton()); await name('Sample pending');
  const original = storage.createFolder; let finish!: () => void;
  const gate = new Promise<void>(r => { finish = r; });
  vi.spyOn(storage, 'createFolder').mockImplementation(async input => { await gate; return original(input); });
  await click(save());
  const buttons = [...editor().querySelectorAll<HTMLButtonElement>('.folder-actions button')];
  expect(buttons).toHaveLength(2); expect(buttons.every(b => b.disabled)).toBe(true);
  await act(async () => { finish(); await gate; }); await flush();
  expect(editor()).toBeNull();
});
