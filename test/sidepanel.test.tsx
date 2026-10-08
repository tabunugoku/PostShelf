import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { applyActionMode, hasSidePanel, openSidePanel } from '../src/shared/panel';
import { getSettings, updateSettings } from '../src/shared/settings';
import { openPopover } from '../src/content/popover';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];

describe('applyActionMode', () => {
  beforeEach(() => installChromeMock());

  it('sidepanel: opens the panel on action click and removes the popup', async () => {
    const calls = installPanelMock();
    await applyActionMode('sidepanel');
    expect(calls.behavior).toEqual([{ openPanelOnActionClick: true }]);
    expect(calls.popup).toEqual([{ popup: '' }]);
  });

  it('popup: restores both', async () => {
    const calls = installPanelMock();
    await applyActionMode('popup');
    expect(calls.behavior).toEqual([{ openPanelOnActionClick: false }]);
    expect(calls.popup).toEqual([{ popup: 'popup.html' }]);
  });

  it('does nothing (and does not throw) without chrome.sidePanel (Chrome 113-)', async () => {
    expect(hasSidePanel()).toBe(false);
    await expect(applyActionMode('sidepanel')).resolves.toBeUndefined();
    await expect(openSidePanel()).resolves.toBeUndefined();
  });

  it('openSidePanel opens for the current window', async () => {
    const calls = installPanelMock();
    await openSidePanel();
    expect(calls.open).toEqual([{ windowId: 7 }]);
  });

  it('actionMode defaults to popup, persists, and falls back on invalid values', async () => {
    expect((await getSettings()).actionMode).toBe('popup');
    await updateSettings({ actionMode: 'sidepanel' });
    expect((await getSettings()).actionMode).toBe('sidepanel');
    await updateSettings({ actionMode: 'x' as never });
    expect((await getSettings()).actionMode).toBe('popup');
  });
});

describe('background', () => {
  it('applies the stored mode at startup and when the setting changes; opens the panel on request', async () => {
    installChromeMock();
    const calls = installPanelMock();
    await updateSettings({ actionMode: 'sidepanel' });
    vi.resetModules();
    await import('../src/background/index');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.popup.at(-1)).toEqual({ popup: '' });
    await updateSettings({ actionMode: 'popup' });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.popup.at(-1)).toEqual({ popup: 'popup.html' });
    expect(calls.behavior.at(-1)).toEqual({ openPanelOnActionClick: false });
    calls.onMessage!({ type: 'openSidePanel' }, { tab: { id: 42 } });
    expect(calls.open.at(-1)).toEqual({ tabId: 42 });
    calls.onMessage!({ type: 'other' }, { tab: { id: 1 } });
    expect(calls.open.length).toBe(1);
  });
});

describe('manager surface', () => {
  beforeEach(async () => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
  });
  const mount = async (surface: 'tab' | 'sidepanel') => {
    await act(() => void render(<App surface={surface} />, $('#app')));
    await flush();
  };

  it('sidepanel surface gets the class and an "open in tab" button, no "open side panel"', async () => {
    installPanelMock();
    await mount('sidepanel');
    expect($('.app').classList.contains('surface-sidepanel')).toBe(true);
    expect($$('[aria-label="タブで開く"]').length).toBe(1);
    expect($$('[aria-label="サイドパネルで開く"]').length).toBe(0);
  });

  it('tab surface shows "open in side panel" only when the API exists', async () => {
    await mount('tab');
    expect($('.app').classList.contains('surface-tab')).toBe(true);
    const sideRow = () => $$('.fr').find((r) => r.textContent?.includes('サイドパネルで開く'));
    expect(sideRow()).toBeUndefined();
    await act(() => void render(null, $('#app')));
    const calls = installPanelMock();
    await mount('tab');
    await act(() => void sideRow()!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(calls.open).toEqual([{ windowId: 7 }]);
    expect($$('[aria-label="タブで開く"]').length).toBe(0);
  });

  it('settings page lets you pick the toolbar icon behavior', async () => {
    installPanelMock();
    await mount('tab');
    await act(() => void $$('.fr').find((r) => r.textContent?.includes('設定'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const radios = $$<HTMLInputElement>('input[name=actionMode]');
    expect(radios.length).toBe(2);
    expect(radios[0].checked).toBe(true);
    await act(() => void radios[1].dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    expect((await getSettings()).actionMode).toBe('sidepanel');
  });
});

describe('x.com popover side panel link', () => {
  it('asks the background to open the side panel', async () => {
    installChromeMock();
    const calls = installPanelMock();
    document.body.innerHTML = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('article')!))!;
    const link = [...pop.querySelectorAll('button')].find((b) => b.textContent === 'サイドパネルで開く')!;
    link.click();
    expect(calls.messages).toEqual([{ type: 'openSidePanel' }]);
  });
});

describe('narrow layout', () => {
  const css = readFileSync(resolve(process.cwd(), 'static/manager.css'), 'utf8');

  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
  });
  const mountAt = async (width: number) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    await act(() => void render(<App surface="sidepanel" />, $('#app')));
    await flush();
  };

  it('width <= 520px: folder dropdown only (no folder chip row), no sidebar (shared components)', async () => {
    await mountAt(400);
    expect($('.app').classList.contains('layout-narrow')).toBe(true);
    expect($$('.side').length).toBe(0);
    expect($('.folder-btn').getAttribute('aria-haspopup')).toBe('menu');
    expect($$('.scroll').length).toBe(0); // フォルダのチップ列はない (ドロップダウンに一本化)
    expect($$('[aria-label="タブで開く"]').length).toBe(1);
    await act(() => void render(null, $('#app')));
  });

  it('width > 520px switches to the tab layout (sidebar)', async () => {
    await mountAt(521);
    expect($('.app').classList.contains('layout-wide')).toBe(true);
    expect($$('.side').length).toBe(1);
    expect($$('.folder-btn').length).toBe(0);
    await act(() => void render(null, $('#app')));
  });

  it('switches live when the window is resized', async () => {
    await mountAt(900);
    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true });
    await act(() => void window.dispatchEvent(new Event('resize')));
    await flush();
    expect($('.app').classList.contains('layout-narrow')).toBe(true);
    await act(() => void render(null, $('#app')));
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });

  it('css: list rows stay single-line, the tools row does not wrap (the bulk bar is a menu button now)', () => {
    expect(css).toMatch(/\.scroll\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/\.layout-narrow \.tools\{[^}]*flex-wrap:nowrap/);
    expect(css).toMatch(/\.mini \.t\{[^}]*white-space:nowrap/);
  });
});

describe('manifest', () => {
  it('declares the side panel and Chrome 114+', () => {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8'));
    expect(m.permissions).toContain('sidePanel');
    expect(m.side_panel.default_path).toBe('sidepanel.html');
    expect(m.minimum_chrome_version).toBe('114');
    expect(readFileSync(resolve(process.cwd(), 'static/sidepanel.html'), 'utf8')).toContain('manager.js');
  });
});
