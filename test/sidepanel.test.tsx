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
    expect($('.ps').classList.contains('surface-sidepanel')).toBe(true);
    expect($$('[aria-label="タブで開く"]').length).toBe(1);
    expect($$('[aria-label="サイドパネルで開く"]').length).toBe(0);
  });

  it('tab surface shows "open in side panel" only when the API exists', async () => {
    await mount('tab');
    expect($('.ps').classList.contains('surface-tab')).toBe(true);
    expect($$('[aria-label="サイドパネルで開く"]').length).toBe(0);
    await act(() => void render(null, $('#app')));
    const calls = installPanelMock();
    await mount('tab');
    const btn = $('[aria-label="サイドパネルで開く"]');
    await act(() => void btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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

describe('narrow layout CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'static/manager.css'), 'utf8');
  const narrow = css.slice(css.indexOf('@media (max-width:519px)'));
  it('turns the folder list into a horizontally scrolling chip row below 520px', () => {
    expect(narrow).toMatch(/\.side\{display:flex;[^}]*overflow-x:auto/);
    expect(narrow).toMatch(/\.fr\{[^}]*min-height:32px/);
  });
  it('stacks the bulk bar and keeps the list row single-line', () => {
    expect(narrow).toMatch(/\.bulk\{flex-direction:column/);
    expect(css).toMatch(/\.mini \.t\{[^}]*white-space:nowrap/);
  });
  it('manifest declares the side panel and Chrome 114+', () => {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8'));
    expect(m.permissions).toContain('sidePanel');
    expect(m.side_panel.default_path).toBe('sidepanel.html');
    expect(m.minimum_chrome_version).toBe('114');
    expect(readFileSync(resolve(process.cwd(), 'static/sidepanel.html'), 'utf8')).toContain('manager.js');
  });
});
