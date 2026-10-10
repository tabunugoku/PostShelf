import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderEdit } from '../src/manager/FolderEdit';
import { MORE_ICONS, type Folder } from '../src/shared/models';
import * as storage from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

let folder: Folder;
const flush = () => act(() => new Promise<void>(r => setTimeout(r, 20)));
beforeEach(async () => {
  installChromeMock(); storage.setAccountScope('unknown');
  folder = await storage.createFolder({ name: 'Sample folder' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const click = async (el: Element) => { await act(() => void (el as HTMLElement).click()); await flush(); };

it('uses nine columns and scales square controls only within the grid, without widening the menu', () => {
  const css = readFileSync('static/manager.css', 'utf8');
  expect(css).toMatch(/\.folder-icon-grid\{[^}]*grid-template-columns:repeat\(9,\s*(?:minmax\(0,\s*1fr\)|1fr)\)/);
  const rule = css.match(/\.folder-icon-grid \.ic\{([^}]+)\}/)![1];
  expect(rule).toContain('max-width:34px');
  expect(rule).toContain('width:100%');
  expect(rule).toContain('min-width:0');
  expect(rule).toContain('min-height:0');
  expect(rule).toContain('aspect-ratio:1');
  expect(css).toContain('.menu-edit{width:min(440px,calc(100vw - 16px));max-width:none}');
});
it('keeps the 36 icons in order immediately below the row, closing on selection and saving the draft', async () => {
  const saved = vi.fn();
  await act(() => void render(<FolderEdit folder={folder} onSaved={saved} />, document.querySelector('#app')!));
  const update = vi.spyOn(storage, 'updateFolder');
  await click(document.querySelector('.icon-more')!);
  const grid = document.querySelector('.folder-icon-grid')!;
  expect(grid.previousElementSibling?.classList.contains('folder-icon-row')).toBe(true);
  const buttons = [...grid.querySelectorAll<HTMLButtonElement>('button')];
  expect(buttons).toHaveLength(36);
  expect(buttons.map(b => b.dataset.icon)).toEqual(MORE_ICONS);
  await click(buttons[35]);
  expect(document.querySelector('.folder-icon-grid')).toBeNull();
  expect(update).not.toHaveBeenCalled();
  expect((await storage.listFolders()).find(f => f.id === folder.id)?.icon).toBe('ti-folder');
  expect(document.querySelector('.icon-more .ti-planet')).not.toBeNull();
  await click(document.querySelector('.folder-actions .primary')!);
  expect(update).toHaveBeenCalledExactlyOnceWith(folder.id, { icon: 'ti-planet' });
  expect(saved).toHaveBeenCalledOnce();
});
