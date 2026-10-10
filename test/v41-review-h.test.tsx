import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import * as menus from '../src/shared/folderCreateMenu';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
let folder: Folder;
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folder = await storage.createFolder({ name: 'Sample A' }); await storage.createFolder({ name: 'Sample B' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const click = async (el: HTMLElement) => { expect(el).not.toBeNull(); await act(() => void el.click()); await flush(); };
const form = () => { const el = document.querySelector<HTMLFormElement>('.menu-edit form')!; expect(el).not.toBeNull(); return el; };
const actions = () => [...form().querySelectorAll<HTMLButtonElement>('[data-folder-actions] button')];
const input = () => form().querySelector<HTMLInputElement>('input')!;
const name = async (value: string) => { await act(() => { input().value = value; input().dispatchEvent(new Event('input', { bubbles: true })); }); };
const mount = async (surface: 'tab' | 'sidepanel' = 'tab') => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(surface === 'tab' ? 1280 : 390);
  await act(() => void render(<App surface={surface} />, document.querySelector('#app')!)); await flush();
};
const openEdit = () => click([...document.querySelectorAll<HTMLElement>('.fr')].find(el => el.querySelector('.fr-name')?.textContent === 'Sample A')!.querySelector<HTMLButtonElement>('.more-btn')!);
const openCreate = async (surface: 'tab' | 'sidepanel') => {
  if (surface === 'sidepanel') {
    await click(document.querySelector<HTMLButtonElement>('.folder-btn')!);
    await click([...document.querySelectorAll<HTMLButtonElement>('.menu-item')].find(el => el.textContent?.trim() === t('newFolder'))!);
  } else await click([...document.querySelectorAll<HTMLElement>('.fr.add')].find(el => el.textContent === t('newFolder'))!);
};

it.each(['tab', 'sidepanel'] as const)('uses adjacent Cancel/Create in %s, cancels without writes, and chooses the created folder', async surface => {
  const menu = vi.spyOn(menus, 'createFolderMenu'); await mount(surface); await openCreate(surface);
  expect(menu).toHaveBeenCalledOnce(); expect(menu.mock.calls[0][0]).toMatchObject({ head: false, preview: false });
  expect(actions().map(b => b.textContent?.trim())).toEqual([t('cancel'), t('create')]);
  expect(actions()[0].style.marginRight).not.toBe('auto'); expect(actions()[0].parentElement?.style.justifyContent).toBe('flex-end');
  expect(form().querySelector('strong')).toBeNull(); expect(form().querySelector('[aria-hidden=true]')).toBeNull();
  const create = vi.spyOn(storage, 'createFolder'); await name('Sample cancelled'); await click(actions()[0]);
  expect(document.querySelector('.menu-edit')).toBeNull(); expect(create).not.toHaveBeenCalled();
  await openCreate(surface); await name('Sample new'); await click(form().querySelector<HTMLButtonElement>('[data-icon-more]')!);
  await click(form().querySelector<HTMLButtonElement>('[data-icon="ti-planet"]')!); await click(form().querySelector<HTMLButtonElement>('[data-color="#378ADD"]')!);
  await click(actions().at(-1)!);
  expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Sample new', icon: 'ti-planet', color: '#378ADD' });
  expect(document.querySelector('.menu-edit')).toBeNull();
  expect(document.querySelector(surface === 'tab' ? '.bar-name' : '.folder-btn .fr-name')?.textContent).toBe('Sample new');
});

it('uses Delete/Cancel/Save, selects the initial name, and discards a cancelled draft', async () => {
  await mount(); await openEdit(); expect(actions().map(b => b.textContent?.trim())).toEqual([t('delete'), t('cancel'), t('save')]);
  expect(actions()[0].style.marginRight).toBe('auto'); expect(actions()[1].style.marginRight).not.toBe('auto');
  expect(document.activeElement).toBe(input()); expect(input().selectionStart).toBe(0); expect(input().selectionEnd).toBe('Sample A'.length);
  const update = vi.spyOn(storage, 'updateFolder'); await name('Sample discarded'); await click(actions()[1]);
  expect(document.querySelector('.menu-edit')).toBeNull(); expect(update).not.toHaveBeenCalled();
  await openEdit(); expect(input().value).toBe('Sample A');
});

it('opens the existing delete confirmation without saving the draft', async () => {
  await mount(); await openEdit(); await name('Sample discarded'); const update = vi.spyOn(storage, 'updateFolder');
  await click(actions()[0]); expect(update).not.toHaveBeenCalled(); expect(document.querySelector('.menu-edit')).toBeNull();
  expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
});

it('saves name, extra icon and color together using the shared edit menu', async () => {
  const menu = vi.spyOn(menus, 'createFolderMenu'); await mount(); await openEdit();
  expect(menu.mock.calls[0][0].folder?.id).toBe(folder.id);
  expect(menu.mock.calls[0][0].existing().some(f => f.id === folder.id)).toBe(false);
  const update = vi.spyOn(storage, 'updateFolder'); await name('Sample updated');
  await click(form().querySelector<HTMLButtonElement>('[data-icon-more]')!); await click(form().querySelector<HTMLButtonElement>('[data-icon="ti-cat"]')!);
  await click(form().querySelector<HTMLButtonElement>('[data-color="#378ADD"]')!); expect(update).not.toHaveBeenCalled();
  await click(actions().at(-1)!); expect(update).toHaveBeenCalledExactlyOnceWith(folder.id, { name: 'Sample updated', icon: 'ti-cat', color: '#378ADD' });
  expect((await storage.listFolders()).find(f => f.id === folder.id)).toMatchObject({ name: 'Sample updated', icon: 'ti-cat', color: '#378ADD' });
});

it('rejects duplicate names without updates', async () => {
  await mount(); await openEdit(); const update = vi.spyOn(storage, 'updateFolder'); await name(' sample b '); await click(actions().at(-1)!);
  expect(form().querySelector('[role=alert]')?.textContent).toBe(t('errDuplicateFolder')); expect(update).not.toHaveBeenCalled();
});

it.each(['edit', 'create'])('disables every control during a pending %s and permits only one write', async mode => {
  await mount(); if (mode === 'edit') await openEdit(); else await openCreate('tab'); await name('Sample pending');
  let finish!: () => void; const gate = new Promise<void>(r => { finish = r; });
  const originalUpdate = storage.updateFolder; const originalCreate = storage.createFolder;
  const write = mode === 'edit' ? vi.spyOn(storage, 'updateFolder').mockImplementation(async (id, patch) => { await gate; return originalUpdate(id, patch); })
    : vi.spyOn(storage, 'createFolder').mockImplementation(async options => { await gate; return originalCreate(options); });
  await click(actions().at(-1)!);
  expect([...form().querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')].every(b => b.disabled)).toBe(true);
  await act(() => void form().dispatchEvent(new Event('submit', { cancelable: true }))); expect(write).toHaveBeenCalledOnce();
  await act(async () => { finish(); await gate; }); await flush(); expect(document.querySelector('.menu-edit')).toBeNull();
});
