import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { installChromeMock, installPanelMock } from './chrome-mock';

const css = readFileSync('static/manager.css', 'utf8');
const rule = (selector: string) => css.slice(css.indexOf(selector + '{') + selector.length + 1).split('}')[0];
const styleOf = (selector: string) => {
  const el = document.createElement('div'); el.style.cssText = rule(selector); return el.style;
};
const px = (value: string) => parseFloat(value) || 0;
const flush = () => act(() => new Promise<void>(r => setTimeout(r, 40)));

beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); history.replaceState(null, '', '/');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await storage.setBookmarkFolders('111', [], {
    text: 'Sample fictional post', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/111',
  });
  document.body.innerHTML = '<style>.bookmark-toolbar{' + rule('.bookmark-toolbar') + '}</style><div id="app"></div>';
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const mount = async () => { await act(() => void render(<App />, document.querySelector('#app')!)); await flush(); };

it('starts the toolbar at its sticky top while preserving the controls and list spacing', () => {
  const main = styleOf('.main'); const bar = styleOf('.bookmark-toolbar');
  const normalTop = px(main.paddingTop) + px(bar.marginTop);
  expect(normalTop - px(bar.top)).toBe(0);
  expect(normalTop + px(bar.paddingTop)).toBe(16);
  // 元の通常位置: main 16 - margin 8 + padding 8 + gap 12 + 下余白 12。
  expect(normalTop + px(bar.paddingTop) + px(bar.gap) + px(bar.paddingBottom) + px(bar.marginBottom)).toBe(40);
});

it('paints the space below the filters so scrolling post folder chips cannot peek through a transparent margin', () => {
  const bar = styleOf('.bookmark-toolbar');
  expect(px(bar.marginBottom)).toBe(0);
  expect(px(bar.paddingBottom)).toBe(12);
  expect(rule('.bookmark-toolbar')).toContain('background:var(--surface-2)');
  expect(rule('.bookmark-toolbar')).not.toMatch(/(?:overflow|max-height|(?<!-)height):/);
});

it('tracks toolbar padding, row gap and wrapped filters in the offset and half-viewport fallback', async () => {
  let filtersHeight = 40; let notify: () => void = () => {};
  const observe = vi.fn(); const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private cb: () => void) {}
    observe(el: Element) { observe(el); if (el.classList.contains('chips')) notify = this.cb; }
    disconnect = disconnect;
  });
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = original.call(this);
    return this.classList.contains('top') ? { ...rect, height: 60 } : this.classList.contains('chips') ? { ...rect, height: filtersHeight } : rect;
  });
  await mount();
  const bar = document.querySelector<HTMLElement>('.bookmark-toolbar')!;
  const main = document.querySelector<HTMLElement>('.main')!;
  expect(observe).toHaveBeenCalledWith(bar);
  expect(main.style.getPropertyValue('--toolbar-offset')).toBe('148px'); // 60 + 40 + 16 + 12 + 12 + 8
  bar.style.paddingTop = '24px'; bar.style.rowGap = '18px';
  await act(() => notify()); await flush();
  expect(main.style.getPropertyValue('--toolbar-offset')).toBe('162px');
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  filtersHeight = 230;
  await act(() => notify()); await flush();
  expect(document.querySelector('.main .chips')?.parentElement).toBe(main);
  expect(main.style.getPropertyValue('--toolbar-offset')).toBe('104px'); // 上段だけ: 60 + 24 + 12 + 8
  filtersHeight = 70;
  await act(() => notify()); await flush();
  expect(document.querySelector('.main .chips')?.parentElement).toBe(bar);
  expect(main.style.getPropertyValue('--toolbar-offset')).toBe('192px');
  expect(disconnect).toHaveBeenCalled(); // フィルタを移した後も監視対象を付け直す。
});
