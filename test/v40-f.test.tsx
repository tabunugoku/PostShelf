import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import { MIME_FOLDER, MIME_POSTS } from '../src/manager/selection';
import { createFolder, listFolders, setAccountScope } from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const row = (name: string) => [...document.querySelectorAll<HTMLElement>('.fr')].find((r) => r.querySelector('.fr-name')?.textContent === name)!;
let folders: Folder[];
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  setAccountScope('unknown');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folders = [];
  for (const name of ['Sample A', 'Sample B', 'Sample C']) folders.push(await createFolder({ name }));
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const drag = async (el: Element, type: string, data: Record<string, string>, protectedData = false) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: { types: Object.keys(data), getData: (key: string) => protectedData ? '' : data[key] ?? '', setData() {}, effectAllowed: '', dropEffect: '' } });
  await act(() => void el.dispatchEvent(event));
  await flush();
};
const start = () => drag(row('Sample A'), 'dragstart', { [MIME_FOLDER]: folders[0].id });
const over = (name = 'Sample B') => drag(row(name), 'dragover', { [MIME_FOLDER]: folders[0].id }, true);

it('shows only an insertion line for folder drags, with protected dragover payloads', async () => {
  await start();
  await over();
  expect(row('Sample B').classList.contains('drop-before')).toBe(true);
  expect(row('Sample B').classList.contains('drop')).toBe(false);
});

it('keeps the existing dotted target for post drags', async () => {
  await drag(row('Sample B'), 'dragover', { [MIME_POSTS]: '["111"]' });
  expect(row('Sample B').classList.contains('drop')).toBe(true);
  expect(row('Sample B').classList.contains('drop-before')).toBe(false);
});

it.each(['drop', 'dragend', 'Escape'])('clears the insertion line after %s', async (end) => {
  await start();
  await over();
  expect(document.querySelector('.drop-before')).not.toBeNull();
  if (end === 'Escape') {
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await flush();
  } else await drag(row(end === 'drop' ? 'Sample B' : 'Sample A'), end, { [MIME_FOLDER]: folders[0].id });
  expect(document.querySelector('.drop-before')).toBeNull();
});

it('never marks the source, inbox or virtual rows, even after a valid target', async () => {
  await start();
  for (const name of ['Sample A', t('inboxName'), t('allFolderName')]) {
    const target = row(name);
    await over();
    await over(name);
    expect(target.classList.contains('drop-before')).toBe(false);
    expect(document.querySelector('.drop-before')).toBeNull();
  }
  const smartRows = [...document.querySelectorAll<HTMLElement>('.fr')].filter((r) => r.getAttribute('draggable') === 'false' && !r.classList.contains('add'));
  expect(smartRows.length).toBeGreaterThanOrEqual(3);
  for (const target of smartRows) {
    await drag(target, 'dragover', { [MIME_FOLDER]: folders[0].id }, true);
    expect(target.classList.contains('drop-before')).toBe(false);
  }
});

it('keeps move-before ordering and disables dragging while the folder menu is open', async () => {
  await drag(row('Sample C'), 'dragstart', { [MIME_FOLDER]: folders[2].id });
  await drag(row('Sample B'), 'drop', { [MIME_FOLDER]: folders[2].id });
  expect((await listFolders()).filter((f) => folders.some((x) => x.id === f.id)).map((f) => f.name)).toEqual(['Sample A', 'Sample C', 'Sample B']);
  await act(() => void row('Sample B').querySelector<HTMLButtonElement>('.more-btn')!.click());
  expect(row('Sample B').draggable).toBe(false);
});

it('draws the line on a positioned pseudo-element without changing row dimensions', () => {
  const css = readFileSync('static/manager.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const line = rules.find((m) => m[1].trim() === '.fr.drop-before::before')?.[2] ?? '';
  expect(line).toContain('position:absolute');
  expect(line).toContain('top:-2px');
  expect(line).toContain('background:var(--fill-accent)');
  expect(line).toContain('pointer-events:none');
  for (const rule of rules.filter((m) => m[1].includes('.fr.drop-before') && !m[1].includes('::before'))) {
    expect(rule[2]).not.toMatch(/(?:^|;)(?:margin|padding|(?:min-|max-)?height)(?:-|:)/);
  }
});
