import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import { createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { installChromeMock, installPanelMock } from './chrome-mock';

const css = readFileSync('static/manager.css', 'utf8');
const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].trim().split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2]).join(';');

beforeEach(() => {
  installChromeMock();
  installPanelMock();
  setAccountScope('unknown');
  history.replaceState(null, '', '/');
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});

it('keeps the count slot in flow while the menu covers it without moving the folder name', () => {
  expect(rule('.fr:hover .n')).not.toMatch(/margin-left\s*:\s*0(?:;|$)/);
  expect(rule('.fr:focus-within .n')).not.toMatch(/margin-left\s*:\s*0(?:;|$)/);
  for (const sel of ['.fr .n', '.fr .badge']) {
    expect(rule(sel)).toContain('min-width:32px');
    expect(rule(sel)).toContain('text-align:right');
    expect(rule(sel)).toContain('flex-shrink:0');
  }
  for (const declaration of ['position:absolute', 'right:6px', 'top:50%', 'transform:translateY(-50%)']) {
    expect(rule('.fr .more')).toContain(declaration);
  }
  for (const state of [':hover:has(.more)', ':focus-within:has(.more)', ':has(.more [aria-expanded=true])']) {
    for (const count of ['.n', '.badge']) expect(rule(`.fr${state} ${count}`)).toContain('visibility:hidden');
  }
  expect(rule('.fr .more:has([aria-expanded=true])')).toContain('display:inline-block');
});

it('renders both the count and fixed menu anchor for user folders and the inbox badge', async () => {
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
  const folder = await createFolder({ name: 'Sample folder' });
  await setBookmarkFolders('111', [], { text: 'Sample post', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/111' });
  await act(() => void render(<App />, document.querySelector('#app')!));
  await act(() => new Promise<void>((r) => setTimeout(r, 60)));
  const row = document.querySelector<HTMLElement>(`.fr[data-id="${folder.id}"]`)
    ?? [...document.querySelectorAll<HTMLElement>('.fr')].find((el) => el.querySelector('.fr-name')?.textContent === folder.name)!;
  expect(row.querySelector('.n')).not.toBeNull();
  expect(row.querySelector('.menu-anchor.more')).not.toBeNull();
  const inbox = document.querySelector('.fr .badge')!.parentElement!;
  expect(inbox.querySelector('.badge')?.textContent).toBe('1');
  await act(() => void row.querySelector<HTMLButtonElement>('.more-btn')!.click());
  expect(document.querySelector('.menu.fixed')).not.toBeNull();
});
