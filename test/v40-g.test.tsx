import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock, loadMessages } from './chrome-mock';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));
const row = (name: string) => [...document.querySelectorAll<HTMLElement>('.fr')].find((r) => r.querySelector('.fr-name')?.textContent === name)!;
const visibleOrder = () => [...document.querySelectorAll('.fr[draggable] .fr-name')].map((r) => r.textContent).filter((name) => name?.startsWith('Sample '));
const savedOrder = async () => (await storage.listFolders()).filter((f) => folders.some((x) => x.id === f.id)).map((f) => f.name);
const button = (direction: 'up' | 'down') => document.querySelector<HTMLButtonElement>(`[data-action=folder-move-${direction}]`)!;
let folders: Folder[];
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  storage.setAccountScope('unknown');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folders = [];
  for (const name of ['Sample A', 'Sample B', 'Sample C']) folders.push(await storage.createFolder({ name }));
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const open = async (name: string) => {
  await act(() => void row(name).querySelector<HTMLButtonElement>('.more-btn')!.click());
  await flush();
};
const move = async (direction: 'up' | 'down') => {
  expect(button(direction)).not.toBeNull();
  await act(() => void button(direction).click());
  await flush();
};

it('moves B up through reorderFolders, keeps its menu, and updates the endpoint button', async () => {
  const reorder = vi.spyOn(storage, 'reorderFolders');
  await open('Sample B');
  const input = document.querySelector<HTMLInputElement>('.folder-edit input')!;
  await move('up');
  expect(reorder).toHaveBeenCalledWith([folders[1].id, folders[0].id, folders[2].id]);
  expect(await savedOrder()).toEqual(['Sample B', 'Sample A', 'Sample C']);
  expect(visibleOrder()).toEqual(['Sample B', 'Sample A', 'Sample C']);
  expect(document.querySelector('.folder-edit input')).toBe(input);
  expect(input.value).toBe('Sample B');
  expect(button('up').disabled).toBe(true);
  expect(row('Sample B').querySelector('.more-btn')?.getAttribute('aria-expanded')).toBe('true');
});

it('disables A up and C down, and never adds menus to smart or inbox rows', async () => {
  await open('Sample A');
  expect(button('up')?.disabled).toBe(true);
  expect(button('down')?.disabled).toBe(false);
  await open('Sample A');
  await open('Sample C');
  expect(button('down')?.disabled).toBe(true);
  for (const smart of document.querySelectorAll('.fr[draggable=false]')) {
    if (smart.querySelector('.fr-name')?.textContent?.startsWith('Sample ')) continue;
    expect(smart.querySelector('.more')).toBeNull();
  }
});

it('moves the same folder down twice using its updated order without closing the menu', async () => {
  await open('Sample A');
  await move('down');
  expect(await savedOrder()).toEqual(['Sample B', 'Sample A', 'Sample C']);
  await move('down');
  expect(await savedOrder()).toEqual(['Sample B', 'Sample C', 'Sample A']);
  expect(visibleOrder()).toEqual(['Sample B', 'Sample C', 'Sample A']);
  expect(document.querySelector<HTMLInputElement>('.folder-edit input')?.value).toBe('Sample A');
  expect(button('down').disabled).toBe(true);
});

it('shows errorStorage without changing order on failure, and permits retry', async () => {
  await open('Sample B');
  vi.spyOn(storage, 'reorderFolders').mockRejectedValueOnce(new Error('Sample storage failure'));
  await move('up');
  expect(await savedOrder()).toEqual(['Sample A', 'Sample B', 'Sample C']);
  expect(visibleOrder()).toEqual(['Sample A', 'Sample B', 'Sample C']);
  expect(document.querySelector('.toast')?.textContent).toContain(t('errorStorage'));
  expect(document.querySelector<HTMLInputElement>('.folder-edit input')?.value).toBe('Sample B');
  expect(button('up').disabled).toBe(false);
  await move('up');
  expect(await savedOrder()).toEqual(['Sample B', 'Sample A', 'Sample C']);
});

it('accepts only one move while a reorder is pending', async () => {
  await open('Sample A');
  const original = storage.reorderFolders;
  let finish!: () => void;
  const gate = new Promise<void>((r) => { finish = r; });
  const reorder = vi.spyOn(storage, 'reorderFolders').mockImplementation(async (ids) => { await gate; return original(ids); });
  await move('down');
  expect(button('down').disabled).toBe(true);
  await move('down');
  expect(reorder).toHaveBeenCalledOnce();
  await act(async () => { finish(); await gate; });
  await flush();
  expect(await savedOrder()).toEqual(['Sample B', 'Sample A', 'Sample C']);
});

it('repositions the fixed menu with the moved row even when menu dimensions are unchanged', async () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const name = this.closest('.fr')?.querySelector('.fr-name')?.textContent;
    const index = visibleOrder().indexOf(name ?? '');
    const top = 100 + Math.max(0, index) * 40;
    return { left: 10, right: 42, top, bottom: top + 32, width: 32, height: 32, x: 10, y: top, toJSON() {} };
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(440);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
  await open('Sample B');
  const menu = document.querySelector<HTMLElement>('.menu-edit')!;
  const top = parseFloat(menu.style.top);
  await move('up');
  expect(document.querySelector('.menu-edit')).toBe(menu);
  expect(parseFloat(menu.style.top)).toBe(top - 40);
});

it.each([
  ['ja', '上へ', '下へ'], ['en', 'Move up', 'Move down'],
  ['zh_CN', '上移', '下移'], ['zh_TW', '上移', '下移'],
  ['ko', '위로', '아래로'], ['es', 'Subir', 'Bajar'],
  ['pt_BR', 'Mover para cima', 'Mover para baixo'], ['fr', 'Monter', 'Descendre'],
])('adds only the specified short labels in %s', (lang, up, down) => {
  const messages = loadMessages(lang);
  expect(messages.folderMoveUp?.message).toBe(up);
  expect(messages.folderMoveDown?.message).toBe(down);
});
