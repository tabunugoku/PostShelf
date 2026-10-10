import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import { createFolder, listBookmarks, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const css = readFileSync('static/manager.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const zIndex = (selector: string) => Number([...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .find((m) => m[1].trim() === selector)?.[2].match(/z-index:(\d+)/)?.[1]);
let folders: Folder[];
let closed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  setAccountScope('unknown');
  folders = [];
  for (let i = 1; i <= 30; i++) folders.push(await createFolder({ name: `Sample ${i}` }));
  await setBookmarkFolders('111', [], { text: 'Sample post', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/111' });
  closed = vi.fn();
  const queue = await listBookmarks();
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<Triage queue={queue} live={new Set(['111'])} folders={folders} pickerFolders={folders} onChanged={() => {}} onClose={closed} />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const open = async () => {
  await act(() => void document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup=dialog]')!.click());
  await flush();
  return document.querySelector<HTMLElement>('.menu')!;
};

it('raises only the triage fixed menu above the overlay', () => {
  expect(zIndex('.menu.fixed')).toBe(40);
  expect(zIndex('.overlay')).toBe(50);
  expect(zIndex('.menu.fixed.menu-over')).toBeGreaterThan(zIndex('.overlay'));
});

it.each(['Escape', 'outside'])('opens all 30 folders outside the clipped dialog and closes with %s', async (how) => {
  const menu = await open();
  expect(menu.classList.contains('fixed')).toBe(true);
  expect(menu.classList.contains('menu-over')).toBe(true);
  expect(menu.closest('.overlay')).toBeNull();
  for (const f of folders) expect(menu.textContent).toContain(f.name);
  expect(menu.querySelectorAll('input[type=checkbox]')).toHaveLength(31); // 未分類を含む
  expect(menu.style.overflowY).toBe('auto');
  const input = menu.querySelector<HTMLInputElement>('input')!;
  input.focus();
  await act(() => void menu.dispatchEvent(new Event('scroll', { bubbles: true })));
  expect(document.querySelector('.menu')).toBe(menu); // メニュー内のスクロールでは閉じない
  await act(() => {
    if (how === 'Escape') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await flush();
  expect(document.querySelector('.menu')).toBeNull();
  expect(closed).not.toHaveBeenCalled();
  expect(document.querySelector('.triage')!.contains(document.activeElement)).toBe(true);
});

it.each([180, 584])('uses existing viewport placement and scrolling for a %ipx menu (mocked geometry)', async (height) => {
  // jsdom はレイアウトしないため、下端・右端のボタンとメニュー寸法を明示する。
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 300, right: 392, top: 550, bottom: 590, width: 92, height: 40, x: 300, y: 550, toJSON() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(height);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
  const menu = await open();
  expect(menu.style.maxHeight).toBe('584px');
  expect(menu.style.overflowY).toBe('auto');
  expect(menu.style.left).toBe('92px');
  expect(menu.style.top).toBe(height === 180 ? '366px' : '8px');
});
