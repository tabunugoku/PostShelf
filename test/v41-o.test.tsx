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

it('uses nine columns and square controls within the grid, without widening the menu', async () => {
  await act(() => void render(<FolderEdit folder={folder} onSaved={()=>{}} />,document.querySelector('#app')!));
  await click(document.querySelector('[data-icon-more]')!);
  const grid=document.querySelector<HTMLElement>('[data-more-icons]')!;
  expect(grid.style.gridTemplateColumns).toMatch(/repeat\(9,\s*1fr\)/);
  for(const button of grid.querySelectorAll<HTMLButtonElement>('button')) {
    expect(button.style.width).toBe('100%');expect(button.style.minWidth).toBe('0');
    expect(button.style.minHeight).toBe('0');expect(button.style.aspectRatio).toBe('1');
  }
  const css = readFileSync('static/manager.css', 'utf8');
  expect(css).toContain('.menu-wide{min-width:min(300px,calc(100vw - 16px));max-width:min(340px,calc(100vw - 16px))}');
});
it('keeps the 36 icons in order immediately below the row, closing on selection and saving the draft', async () => {
  const saved = vi.fn();
  await act(() => void render(<FolderEdit folder={folder} onSaved={saved} />, document.querySelector('#app')!));
  const update = vi.spyOn(storage, 'updateFolder');
  await click(document.querySelector('[data-icon-more]')!);
  const grid = document.querySelector('[data-more-icons]')!;
  expect(grid.previousElementSibling?.hasAttribute('data-main-icons')).toBe(true);
  const buttons = [...grid.querySelectorAll<HTMLButtonElement>('button')];
  expect(buttons).toHaveLength(36);
  expect(buttons.map(b => b.dataset.icon)).toEqual(MORE_ICONS);
  await click(buttons[35]);
  expect(document.querySelector<HTMLElement>('[data-more-icons]')?.hidden).toBe(true);
  expect(update).not.toHaveBeenCalled();
  expect((await storage.listFolders()).find(f => f.id === folder.id)?.icon).toBe('ti-folder');
  expect(document.querySelector('[data-icon-more] .ti-planet')).not.toBeNull();
  await click(document.querySelector('[data-folder-actions] [type=submit]')!);
  expect(update).toHaveBeenCalledExactlyOnceWith(folder.id, { icon: 'ti-planet' });
  expect(saved).toHaveBeenCalledOnce();
});
