// 版: v65-c
import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { createFolderPicker } from '../src/shared/folderPicker';
import * as storage from '../src/shared/storage';
import type { Folder } from '../src/shared/models';

const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const BAD_COLOR = 'red;background:url(https://example.invalid/t)';

beforeEach(() => {
  const data = installChromeMock();
  data.schemaVersion = 2;
  data.folderIdsRepaired = true;
  storage.setAccountScope('me');
  document.body.innerHTML = '';
});

const importFolders = (folders: unknown[]) =>
  storage.importData({ app: 'PostShelf', version: 2, exportedAt: 1, accounts: [], folders, bookmarks: [] });
const folderOf = async (id: string) => (await storage.listFolders()).find((f) => f.id === id)!;

it('取り込んだフォルダの不正な色は外し、フォルダは残す', async () => {
  await importFolders([{ id: 'f_bad', name: 'Sample bad', icon: 'ti-star', color: BAD_COLOR, order: 1, accountId: 'me' }]);
  const f = await folderOf('f_bad');
  expect(f.name).toBe('Sample bad');
  expect(f.color).toBeUndefined();
});

it('取り込んだフォルダの候補にある色は残す', async () => {
  await importFolders([{ id: 'f_ok', name: 'Sample ok', icon: 'ti-star', color: '#E24B4A', order: 1, accountId: 'me' }]);
  expect((await folderOf('f_ok')).color).toBe('#E24B4A');
});

it('取り込んだフォルダの不正な icon は ti-folder になる', async () => {
  await importFolders([{ id: 'f_icon', name: 'Sample icon', icon: 'ti-x" onerror="y', order: 1, accountId: 'me' }]);
  expect((await folderOf('f_icon')).icon).toBe('ti-folder');
});

it('id に引用符を含むフォルダでも、ピッカーの開閉で例外にならない', () => {
  const parent: Folder = { id: 'a"b', name: 'Sample parent', icon: 'ti-folder', order: 0, accountId: 'me' };
  const child: Folder = { id: 'c1', name: 'Sample child', icon: 'ti-folder', order: 1, accountId: 'me', parentId: parent.id };
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
  window.addEventListener('error', onError);
  const picker = createFolderPicker({ folders: [parent, child], selected: new Set(), theme, onChange: () => {} });
  document.body.append(picker.el);
  const arrow = () => picker.el.querySelector<HTMLButtonElement>('[data-tree-toggle]')!;
  arrow().click();
  arrow().click();
  window.removeEventListener('error', onError);
  expect(errors).toEqual([]);
  expect(picker.el.querySelector('[data-picker-folder="c1"]')).not.toBeNull();
});

it('ピッカーは候補にない色を style に入れない', () => {
  const bad: Folder = { id: 'f_bad', name: 'Sample bad', icon: 'ti-folder', color: BAD_COLOR, order: 0, accountId: 'me' };
  const good: Folder = { id: 'f_good', name: 'Sample good', icon: 'ti-star', color: '#E24B4A', order: 1, accountId: 'me' };
  const picker = createFolderPicker({ folders: [bad, good], selected: new Set(), theme, onChange: () => {} });
  document.body.append(picker.el);
  const iconOf = (id: string) => picker.el.querySelector<HTMLElement>(`[data-picker-folder="${id}"] i`)!;
  expect(iconOf('f_bad').getAttribute('style')).not.toContain('example.invalid');
  expect(iconOf('f_bad').style.background).toBe('');
  expect(iconOf('f_good').style.color).toBe('rgb(226, 75, 74)');
});

it('不正な色のフォルダを編集で開いても、プレビューの style に入らない', async () => {
  const { createFolderMenu } = await import('../src/shared/folderCreateMenu');
  const bad: Folder = { id: 'f_bad', name: 'Sample bad', icon: 'ti-folder', color: BAD_COLOR, order: 0, accountId: 'me' };
  const menu = createFolderMenu({ theme, existing: () => [], folder: bad, onClose: () => {} });
  document.body.append(menu.el);
  // プレビューは、アイコンと名前が並んだ行 (名前の文字で探す)
  const row = [...menu.el.querySelectorAll<HTMLElement>('div')].find((d) => d.lastElementChild?.textContent === 'Sample bad')!;
  const preview = row.querySelector<HTMLElement>('i')!;
  expect(preview.getAttribute('style')).not.toContain('example.invalid');
  expect(preview.style.background).toBe('');
});
