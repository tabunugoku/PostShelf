import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { installChromeMock } from './chrome-mock';
import { setNativeBookmark } from '../src/content/native';
import { openPopover } from '../src/content/popover';
import { injectButtons } from '../src/content/buttons';
import { createFolder } from '../src/shared/storage';
import { getSettings, updateSettings } from '../src/shared/settings';

const html = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = html;
});

describe('settings', () => {
  it('syncNative defaults to false and persists', async () => {
    expect((await getSettings()).syncNative).toBe(false);
    await updateSettings({ syncNative: true });
    expect((await getSettings()).syncNative).toBe(true);
  });
});

describe('setNativeBookmark', () => {
  const clicks = (sel: string) => {
    const spy = vi.fn();
    document.querySelector(sel)?.addEventListener('click', spy);
    return spy;
  };
  it('clicks bookmark once when wanting it and it is not bookmarked', () => {
    const spy = clicks('[data-testid=bookmark]');
    expect(setNativeBookmark(document.querySelector('article')!, true)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('does nothing when already bookmarked and wanting it', () => {
    document.querySelector('[data-testid=bookmark]')!.setAttribute('data-testid', 'removeBookmark');
    const spy = clicks('[data-testid=removeBookmark]');
    expect(setNativeBookmark(document.querySelector('article')!, true)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
  it('clicks removeBookmark once when un-wanting', () => {
    document.querySelector('[data-testid=bookmark]')!.setAttribute('data-testid', 'removeBookmark');
    const spy = clicks('[data-testid=removeBookmark]');
    expect(setNativeBookmark(document.querySelector('article')!, false)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('does nothing when not bookmarked and un-wanting, or button missing', () => {
    const spy = clicks('[data-testid=bookmark]');
    expect(setNativeBookmark(document.querySelector('article')!, false)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    document.body.innerHTML = '<article data-testid="tweet"></article>';
    expect(setNativeBookmark(document.querySelector('article')!, true)).toBe(false);
  });
});

describe('popover + syncNative', () => {
  async function setup(sync: boolean) {
    if (sync) await updateSettings({ syncNative: true });
    await createFolder({ name: 'a' });
    injectButtons();
    const native = document.querySelector('[data-testid=bookmark]')!;
    const spy = vi.fn(() => native.setAttribute('data-testid', 'removeBookmark')); // X がトグルした状態を模擬
    native.addEventListener('click', spy);
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
    return { pop, spy, native, cb: pop.querySelector<HTMLInputElement>('input[type=checkbox]')! };
  }
  const toggle = async (cb: HTMLInputElement, v: boolean) => {
    cb.checked = v;
    cb.dispatchEvent(new Event('change'));
    await tick();
  };

  it('off: never touches X', async () => {
    const { cb, spy } = await setup(false);
    await toggle(cb, true);
    await toggle(cb, false);
    expect(spy).not.toHaveBeenCalled();
  });
  it('on: checking a folder bookmarks natively once; unchecking all removes it once', async () => {
    const { cb, spy, native } = await setup(true);
    await toggle(cb, true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(native.getAttribute('data-testid')).toBe('removeBookmark');
    await toggle(cb, false);
    expect(spy).toHaveBeenCalledTimes(2); // removeBookmark を 1 回 click
  });
  it('on: second folder while already bookmarked does not click again', async () => {
    await updateSettings({ syncNative: true });
    await createFolder({ name: 'b' });
    const { pop, spy } = await setup(true);
    const [a, b] = [...pop.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    await toggle(a, true);
    await toggle(b, true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
