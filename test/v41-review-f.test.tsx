import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { installChromeMock, installPanelMock } from './chrome-mock';

const css = readFileSync('static/manager.css', 'utf8');
const rule = (selector: string) => css.slice(css.indexOf(`${selector}{`) + selector.length + 1).split('}')[0];
const flush = () => act(() => new Promise<void>(r => setTimeout(r, 40)));
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); history.replaceState(null, '', '/');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], {
    text: `Sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}`,
  });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = async (surface: 'tab' | 'sidepanel' = 'tab') => {
  await act(() => void render(<App surface={surface} />, document.querySelector('#app')!)); await flush();
};

it('groups the top controls and filters in an opaque sticky toolbar below menus', async () => {
  await mount();
  const toolbar = document.querySelector('.bookmark-toolbar')!;
  expect(toolbar).not.toBeNull();
  expect(document.querySelector('.top')?.parentElement).toBe(toolbar);
  expect(document.querySelector('.main .chips')?.parentElement).toBe(toolbar);
  const style = rule('.bookmark-toolbar');
  expect(style).toContain('position:sticky'); expect(style).toContain('top:0');
  expect(style).toContain('background:var(--surface-2)'); expect(style).not.toMatch(/overflow/);
  expect(Number(style.match(/z-index:(\d+)/)?.[1])).toBeLessThan(Number(rule('.menu').match(/z-index:(\d+)/)?.[1]));
  expect(css).toContain('.layout-wide .rows [data-row]{scroll-margin-top:var(--toolbar-offset,140px)}');
  expect(css).toMatch(/\.post\{[^}]*content-visibility:auto;contain-intrinsic-size:auto 320px/);
});

it('does not add the bookmark toolbar to settings', async () => {
  history.replaceState(null, '', '/#settings'); await mount();
  expect(document.querySelector('.settings-page')).not.toBeNull();
  expect(document.querySelector('.bookmark-toolbar')).toBeNull();
});

it('keeps the narrow sidepanel header sticky without a second toolbar', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390); await mount('sidepanel');
  expect(document.querySelector('.phead')).not.toBeNull();
  expect(document.querySelector('.bookmark-toolbar')).toBeNull();
  expect(rule('.phead')).toContain('position:sticky'); expect(rule('.phead')).toContain('background:var(--surface-2)');
});

it('lets tall wrapped filters scroll away when the toolbar exceeds half the viewport', async () => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  let filtersHeight = 260;
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = original.call(this);
    return this.classList.contains('top') ? { ...rect, height: 60 } : this.classList.contains('chips') ? { ...rect, height: filtersHeight } : rect;
  });
  await mount();
  const toolbar = document.querySelector('.bookmark-toolbar')!;
  expect(toolbar).not.toBeNull();
  expect(document.querySelector('.top')?.parentElement).toBe(toolbar);
  expect(document.querySelector('.main .chips')?.parentElement).toBe(document.querySelector('.main'));
  expect(document.querySelector<HTMLElement>('.main')!.style.getPropertyValue('--toolbar-offset')).toBe('76px');
  filtersHeight = 40;
  await act(() => void window.dispatchEvent(new Event('resize'))); await flush();
  expect(document.querySelector('.main .chips')?.parentElement).toBe(toolbar);
  expect(document.querySelector<HTMLElement>('.main')!.style.getPropertyValue('--toolbar-offset')).toBe('128px');
});

it('remeasures wrapped controls with ResizeObserver and releases it on settings navigation', async () => {
  const observe = vi.fn(); const disconnect = vi.fn();
  let notify: () => void = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: () => void) {}
    observe(el: Element) { observe(el); if (el.classList.contains('top')) notify = this.cb; }
    disconnect = disconnect;
  });
  const original = HTMLElement.prototype.getBoundingClientRect;
  let topHeight = 40;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = original.call(this); return this.classList.contains('top') ? { ...rect, height: topHeight } : rect;
  });
  await mount(); expect(observe).toHaveBeenCalledWith(document.querySelector('.top')); expect(observe).toHaveBeenCalledWith(document.querySelector('.main .chips'));
  topHeight = 80; await act(() => notify()); await flush();
  expect(document.querySelector<HTMLElement>('.main')!.style.getPropertyValue('--toolbar-offset')).toBe('108px');
  await act(() => void document.querySelector<HTMLElement>('.fr.add.on, .fr.add:has(.ti-settings)')!.click()); await flush();
  expect(document.querySelector('.bookmark-toolbar')).toBeNull(); expect(disconnect).toHaveBeenCalled();
});

it('scrolls keyboard-focused rows into view using the toolbar scroll margin', async () => {
  const scrollIntoView = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  try {
    await mount(); const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
    await act(() => { rows[0].focus(); rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); }); await flush();
    expect(document.activeElement).toBe(rows[1]); expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous);
    else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});
