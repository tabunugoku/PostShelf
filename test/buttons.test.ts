import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { applyButtonMode, injectButtons, refreshAll } from '../src/content/buttons';
import { installGlobalHandlers } from '../src/content/popover';
import { createFolder, setBookmarkFolders } from '../src/shared/storage';
import { getSettings, updateSettings } from '../src/shared/settings';

const html = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));
const snap = { text: 't', author: 'a', handle: '@a', media: [], url: 'u' };
const nativeBtn = () => document.querySelector<HTMLElement>('[data-testid=bookmark], [data-testid=removeBookmark]')!;
const popover = () => document.querySelector('.postshelf-popover');

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = html;
  applyButtonMode('separate');
});
afterEach(() => applyButtonMode('separate'));

describe('separate mode button', () => {
  it('is an icon button with a 34px+ hit area and 4px+ gap, outside the native button', () => {
    injectButtons();
    const btn = document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
    expect(btn.querySelector('i.ti-folder-plus')).not.toBeNull();
    expect(btn.textContent).toBe(''); // 文字 ▾ ではない
    expect(parseInt(btn.style.width)).toBeGreaterThanOrEqual(34);
    expect(parseInt(btn.style.height)).toBeGreaterThanOrEqual(34);
    expect(parseInt(btn.style.marginLeft)).toBeGreaterThanOrEqual(4);
    expect(btn.title).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe(btn.title);
    // 標準ボタンの子孫ではなく、直後の兄弟 (判定領域が重ならない)
    expect(nativeBtn().contains(btn)).toBe(false);
    expect(nativeBtn().nextElementSibling).toBe(btn);
  });

  it('does not trigger the native button when clicked, and is injected only once', () => {
    injectButtons();
    injectButtons();
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBe(1);
    const native = vi.fn();
    nativeBtn().addEventListener('click', native);
    document.querySelector<HTMLElement>('[data-postshelf-btn]')!.click();
    expect(native).not.toHaveBeenCalled();
  });

  it('shows a saved state with the first folder color and the folder count', async () => {
    const f = await createFolder({ name: 'a', color: '#E24B4A' });
    const g = await createFolder({ name: 'b' });
    await setBookmarkFolders('1234567890', [f.id, g.id], snap);
    injectButtons();
    await refreshAll();
    const btn = document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
    expect(btn.hasAttribute('data-saved')).toBe(true);
    expect(btn.style.color).toMatch(/226, 75, 74|#e24b4a/i);
    expect(btn.querySelector('[data-postshelf-badge]')!.textContent).toBe('2');
    expect(btn.querySelector('i.ti-folder-check')).not.toBeNull();
  });

  it('refreshAll reflects changes made later', async () => {
    injectButtons();
    const f = await createFolder({ name: 'a' });
    await setBookmarkFolders('1234567890', [f.id], snap);
    await refreshAll();
    expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(true);
    await setBookmarkFolders('1234567890', [], snap);
    await refreshAll();
    expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(false);
  });
});

describe('replace mode', () => {
  beforeEach(() => installGlobalHandlers());

  it('intercepts the native click: X handler is not called, popover opens', async () => {
    applyButtonMode('replace');
    const xHandler = vi.fn();
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().click();
    await tick();
    expect(xHandler).not.toHaveBeenCalled();
    expect(popover()).not.toBeNull();
  });

  it('does not show the separate button, but overlays a badge that ignores pointer events', async () => {
    applyButtonMode('replace');
    expect(document.querySelector('[data-postshelf-btn]')).toBeNull();
    const f = await createFolder({ name: 'a' });
    await setBookmarkFolders('1234567890', [f.id], snap);
    await refreshAll();
    const badge = nativeBtn().querySelector<HTMLElement>('[data-postshelf-badge]')!;
    expect(badge.style.pointerEvents).toBe('none');
    expect(badge.textContent).toBe('1');
  });

  it('Shift+click goes to X and does not open the popover', async () => {
    applyButtonMode('replace');
    const xHandler = vi.fn();
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    await tick();
    expect(xHandler).toHaveBeenCalledTimes(1);
    expect(popover()).toBeNull();
  });

  it('leaves non-bookmark clicks alone', async () => {
    applyButtonMode('replace');
    document.body.insertAdjacentHTML('beforeend', '<button id="other">x</button>');
    const other = vi.fn();
    document.getElementById('other')!.addEventListener('click', other);
    document.getElementById('other')!.click();
    await tick();
    expect(other).toHaveBeenCalledTimes(1);
    expect(popover()).toBeNull();
  });

  it('falls back to X when the post cannot be identified', async () => {
    document.body.innerHTML = '<article data-testid="tweet"><div><button data-testid="bookmark"></button></div></article>';
    applyButtonMode('replace');
    const xHandler = vi.fn();
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().click();
    await tick();
    expect(xHandler).toHaveBeenCalledTimes(1);
  });

  it('switching back to separate removes the listener and badge, restoring native behavior', async () => {
    applyButtonMode('replace');
    applyButtonMode('separate');
    expect(document.querySelector('[data-postshelf-badge]')?.closest('[data-testid=bookmark]')).toBeNull();
    const xHandler = vi.fn();
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().click();
    await tick();
    expect(xHandler).toHaveBeenCalledTimes(1);
    expect(popover()).toBeNull();
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBe(1);
  });

  it('sync mode programmatic click is not intercepted (no infinite loop)', async () => {
    await updateSettings({ syncNative: true });
    await createFolder({ name: 'a' });
    applyButtonMode('replace');
    const xHandler = vi.fn(() => nativeBtn().setAttribute('data-testid', 'removeBookmark'));
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().click(); // ユーザーの click → 横取りされポップオーバーが開く
    await tick();
    expect(xHandler).not.toHaveBeenCalled();
    const cb = popover()!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await tick();
    expect(xHandler).toHaveBeenCalledTimes(1); // 連動の 1 回だけ。横取りされて再度ポップオーバーが開くこともない
  });

  it('offers to remove the X bookmark when already bookmarked on X', async () => {
    nativeBtn().setAttribute('data-testid', 'removeBookmark');
    applyButtonMode('replace');
    const xHandler = vi.fn();
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().click();
    await tick();
    expect(xHandler).not.toHaveBeenCalled();
    const rel = [...popover()!.querySelectorAll('button')].find((b) => b.textContent === 'X のブックマークも解除')!;
    expect(rel).toBeTruthy();
    rel.click();
    expect(xHandler).toHaveBeenCalledTimes(1);
  });
});

describe('settings', () => {
  it('buttonMode defaults to separate and rejects invalid values', async () => {
    expect((await getSettings()).buttonMode).toBe('separate');
    await updateSettings({ buttonMode: 'replace' });
    expect((await getSettings()).buttonMode).toBe('replace');
    await updateSettings({ buttonMode: 'nope' as never });
    expect((await getSettings()).buttonMode).toBe('separate');
  });
});
