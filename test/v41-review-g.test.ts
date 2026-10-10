import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFolderMenu } from '../src/shared/folderCreateMenu';
import { COLORS, displayName, iconLabel, type Folder } from '../src/shared/models';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const tick = () => new Promise(r => setTimeout(r, 20));
let folder: Folder;
beforeEach(async () => {
  installChromeMock(); storage.setAccountScope('unknown'); document.body.innerHTML = '';
  folder = await storage.createFolder({ name: 'Sample A', icon: 'ti-cat', color: COLORS[0] });
});
afterEach(() => vi.restoreAllMocks());
const mount = (options: Partial<Parameters<typeof createFolderMenu>[0]> = {}) => {
  const saved = vi.fn(); const close = vi.fn();
  const menu = createFolderMenu({ theme, existing: () => [], onCreated: () => {}, folder, onSaved: saved, onClose: close, ...options });
  document.body.append(menu.el); return { ...menu, saved, close };
};
const setName = (el: HTMLElement, value: string) => {
  const input = el.querySelector('input')!; input.value = value; input.dispatchEvent(new Event('input'));
};
const submit = async (el: HTMLElement) => { el.dispatchEvent(new Event('submit', { cancelable: true })); await tick(); };
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;

it('starts and resets editing from the folder name, extra icon and color', () => {
  const menu = mount(); expect(menu.el.querySelector('input')!.value).toBe(displayName(folder));
  expect(menu.el.querySelector(`[data-icon="${folder.icon}"]`)?.getAttribute('aria-pressed')).toBe('true');
  expect(menu.el.querySelector(`[data-color="${folder.color}"]`)?.getAttribute('aria-pressed')).toBe('true');
  expect(menu.el.querySelector('[data-icon-more]')?.getAttribute('aria-label')).toBe(`${t('iconMore')}: ${iconLabel(folder.icon)}`);
  expect(button(menu.el, t('save'))).toBeTruthy(); expect(button(menu.el, t('create'))).toBeUndefined();
  setName(menu.el, 'Sample draft'); menu.el.querySelector<HTMLButtonElement>('[data-icon-more]')!.click(); menu.reset();
  expect(menu.el.querySelector('input')!.value).toBe('Sample A'); expect(menu.el.querySelector<HTMLElement>('[data-more-icons]')!.hidden).toBe(true);
});

it('keeps draft fields unsaved and applies only the changed fields once', async () => {
  const update = vi.spyOn(storage, 'updateFolder'); const create = vi.spyOn(storage, 'createFolder');
  const menu = mount(); setName(menu.el, ' Sample renamed ');
  menu.el.querySelector<HTMLButtonElement>('[data-icon="ti-planet"]')!.click();
  menu.el.querySelector<HTMLButtonElement>(`[data-color="${COLORS[2]}"]`)!.click();
  expect(update).not.toHaveBeenCalled(); expect((await storage.listFolders()).find(f => f.id === folder.id)).toEqual(folder);
  await submit(menu.el);
  expect(update).toHaveBeenCalledExactlyOnceWith(folder.id, { name: 'Sample renamed', icon: 'ti-planet', color: COLORS[2] });
  expect(create).not.toHaveBeenCalled(); expect(menu.saved).toHaveBeenCalledOnce();
});

it('does not write unchanged drafts and never treats itself as another duplicate', async () => {
  const update = vi.spyOn(storage, 'updateFolder'); const menu = mount({ existing: () => [] });
  await submit(menu.el); expect(update).not.toHaveBeenCalled(); expect(menu.saved).toHaveBeenCalledOnce();
});

it('passes color null when clearing a color and no unrelated fields', async () => {
  const update = vi.spyOn(storage, 'updateFolder'); const menu = mount();
  menu.el.querySelector<HTMLButtonElement>('[data-color=""]')!.click(); await submit(menu.el);
  expect(update).toHaveBeenCalledExactlyOnceWith(folder.id, { color: null });
});

it('rejects another folder with the same normalized name and an empty name', async () => {
  const other = await storage.createFolder({ name: 'Sample B' }); const update = vi.spyOn(storage, 'updateFolder');
  const menu = mount({ existing: () => [other] }); setName(menu.el, ' sample b '); await submit(menu.el);
  expect(menu.el.querySelector('[role=alert]')?.textContent).toBe(t('errDuplicateFolder'));
  setName(menu.el, '   '); await submit(menu.el); expect(button(menu.el, t('save')).disabled).toBe(true);
  expect(menu.el.querySelector('[role=alert]')?.textContent).toBe(t('errEmptyName'));
  expect(update).not.toHaveBeenCalled(); expect(menu.saved).not.toHaveBeenCalled();
});

it('orders Delete, Cancel, Save with the delete action separated at the left', () => {
  const onDelete = vi.fn(); const menu = mount({ onDelete });
  const actions = menu.el.lastElementChild as HTMLElement;
  expect([...actions.querySelectorAll('button')].map(b => b.textContent?.trim())).toEqual([t('delete'), t('cancel'), t('save')]);
  expect(actions.style.justifyContent).toBe('flex-end'); expect(actions.style.flexWrap).toBe('nowrap');
  const del = button(menu.el, t('delete')); expect(del.style.marginRight).toBe('auto'); expect(del.querySelector('.ti-trash')).not.toBeNull();
  del.click(); expect(onDelete).toHaveBeenCalledOnce(); button(menu.el, t('cancel')).click(); expect(menu.close).toHaveBeenCalledOnce();
  expect(button(mount().el, t('delete'))).toBeUndefined();
});

it('omits the back/title and preview only when requested', () => {
  const { el } = mount({ head: false, preview: false });
  expect(el.querySelector('strong')).toBeNull(); expect(button(el, `← ${t('back')}`)).toBeUndefined(); expect(el.querySelector('[aria-hidden=true]')).toBeNull();
});

it('disables every editing control until save finishes, guarding repeated submits', async () => {
  let finish!: () => void; const gate = new Promise<void>(r => { finish = r; }); const original = storage.updateFolder;
  const update = vi.spyOn(storage, 'updateFolder').mockImplementation(async (id, patch) => { await gate; return original(id, patch); });
  const menu = mount({ onDelete: vi.fn() }); setName(menu.el, 'Sample pending');
  await submit(menu.el); expect([...menu.el.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')].every(b => b.disabled)).toBe(true);
  await submit(menu.el); expect(update).toHaveBeenCalledOnce();
  finish(); await gate; await tick(); expect(menu.saved).toHaveBeenCalledOnce(); expect(button(menu.el, t('cancel')).disabled).toBe(false);
});

it('keeps failed editing drafts and shows StorageError for retry', async () => {
  const menu = mount(); setName(menu.el, 'Sample retry');
  vi.spyOn(storage, 'updateFolder').mockRejectedValueOnce(new storage.StorageError(t('errorStorage')));
  await submit(menu.el); expect(menu.saved).not.toHaveBeenCalled(); expect(menu.el.querySelector('input')!.value).toBe('Sample retry');
  expect(menu.el.querySelector('[role=alert]')?.textContent).toBe(t('errorStorage'));
  await submit(menu.el); expect(menu.saved).toHaveBeenCalledOnce();
});

it('keeps the default creation structure and labels intact', () => {
  const { el } = createFolderMenu({ theme, existing: () => [], onCreated: () => {}, onClose: () => {} });
  expect(el.children).toHaveLength(7); expect(el.querySelector('strong')?.textContent).toBe(t('createFolder'));
  expect(el.querySelector('[aria-hidden=true]')).not.toBeNull(); expect(el.querySelector('input')!.value).toBe('');
  expect([...el.lastElementChild!.querySelectorAll('button')].map(b => b.textContent)).toEqual([t('cancel'), t('create')]);
});
