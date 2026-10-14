import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('site/index.html'), 'utf8');
// Use the installed jsdom without adding a dependency just for its declarations.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: string; beforeParse?: (window: Window & typeof globalThis) => void }) => { window: Window & typeof globalThis };
};
function page(beforeParse?: (window: Window & typeof globalThis) => void) {
  return new JSDOM(html, { url: 'https://tabunugoku.github.io/PostShelf/', runScripts: 'dangerously', beforeParse });
}

/** ボタンの押された状態を、data 属性の値ごとに返す */
function pressed(d: Document, selector: string, attribute: string) {
  const buttons = [...d.querySelectorAll(selector)];
  return Object.fromEntries(buttons.map(b => [b.getAttribute(attribute), b.getAttribute('aria-pressed')]));
}

/** 約束の後始末 (then / catch) を走らせる */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('紹介サイト', () => {
  it('pairs Japanese copy with English copy', () => {
    const dom = page();
    for (const ja of dom.window.document.querySelectorAll('span.ja')) {
      expect(ja.nextElementSibling?.matches('span.en'), ja.textContent ?? '').toBe(true);
    }
    dom.window.close();
  });

  it('loads no external scripts, and only Google Fonts as an external stylesheet', () => {
    const dom = page();
    const d = dom.window.document;
    expect(d.querySelectorAll('script[src]')).toHaveLength(0);
    const sheets = [...d.querySelectorAll('link[rel="stylesheet"]')].map(l => new URL(l.getAttribute('href')!).host);
    expect(sheets).toEqual(['fonts.googleapis.com']);
    dom.window.close();
  });

  it('links each header item to an existing section', () => {
    const dom = page();
    const d = dom.window.document;
    const links = d.querySelectorAll('header a[href^="#"]');
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      const target = link.getAttribute('href')!;
      expect(d.querySelector(target), target).not.toBeNull();
    }
    dom.window.close();
  });

  it('follows the browser language when nothing is saved', () => {
    const en = page();
    expect(en.window.document.documentElement.lang).toBe('en');
    expect(pressed(en.window.document, '#langseg button', 'data-l')).toEqual({ en: 'true', ja: 'false' });
    en.window.close();
    const ja = page(w => Object.defineProperty(w.navigator, 'language', { value: 'ja-JP' }));
    expect(ja.window.document.documentElement.lang).toBe('ja');
    expect(ja.window.document.title).toContain('フォルダに整理する');
    ja.window.close();
  });

  it('switches the language, saves it and updates the title and pressed state', () => {
    const dom = page();
    const d = dom.window.document;
    d.querySelector<HTMLButtonElement>('#langseg button[data-l="ja"]')!.click();
    expect(d.documentElement.lang).toBe('ja');
    expect(pressed(d, '#langseg button', 'data-l')).toEqual({ en: 'false', ja: 'true' });
    expect(dom.window.localStorage.getItem('ps-lang')).toBe('ja');
    expect(d.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe('ja_JP');
    d.querySelector<HTMLButtonElement>('#langseg button[data-l="en"]')!.click();
    expect(d.documentElement.lang).toBe('en');
    expect(d.title).toContain('Sort your X bookmarks');
    dom.window.close();
  });

  it('prefers the saved language over the browser language', () => {
    const dom = page(w => w.localStorage.setItem('ps-lang', 'ja'));
    expect(dom.window.document.documentElement.lang).toBe('ja');
    dom.window.close();
  });

  it('starts with the automatic theme and switches between light, auto and dark', () => {
    const dom = page();
    const d = dom.window.document, root = d.documentElement;
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(pressed(d, '#theme button', 'data-t')).toEqual({ light: 'false', auto: 'true', dark: 'false' });
    d.querySelector<HTMLButtonElement>('#theme button[data-t="dark"]')!.click();
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(dom.window.localStorage.getItem('ps-theme')).toBe('dark');
    expect(pressed(d, '#theme button', 'data-t')).toEqual({ light: 'false', auto: 'false', dark: 'true' });
    // 自動に戻すと、属性も保存も外して OS の設定に従う
    d.querySelector<HTMLButtonElement>('#theme button[data-t="auto"]')!.click();
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(dom.window.localStorage.getItem('ps-theme')).toBeNull();
    dom.window.close();
  });

  it('applies the saved theme on load', () => {
    const dom = page(w => w.localStorage.setItem('ps-theme', 'light'));
    const d = dom.window.document;
    expect(d.documentElement.getAttribute('data-theme')).toBe('light');
    expect(pressed(d, '#theme button', 'data-t')).toEqual({ light: 'true', auto: 'false', dark: 'false' });
    dom.window.close();
  });

  it('still works when storage throws', () => {
    const dom = page(w => {
      Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    const d = dom.window.document;
    expect(d.documentElement.lang).toBe('en');
    d.querySelector<HTMLButtonElement>('#theme button[data-t="dark"]')!.click();
    expect(d.documentElement.getAttribute('data-theme')).toBe('dark');
    dom.window.close();
  });

  it('uses only sample account handles in the demo', () => {
    const dom = page();
    const handles = dom.window.document.querySelector('.demo')!.textContent!.match(/@[a-zA-Z0-9_]+/g)!;
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) expect(handle).toMatch(/^@sample_/);
    dom.window.close();
  });

  it('opens the folder menu in the demo and closes it with Escape', () => {
    const dom = page();
    const d = dom.window.document;
    const button = d.getElementById('bm') as HTMLButtonElement, menu = d.getElementById('pop')!;
    button.click();
    expect(menu.classList.contains('open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.classList.contains('open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    dom.window.close();
  });

  it('reflects a chosen folder in the demo chips and count, in the selected language', () => {
    const dom = page();
    const d = dom.window.document;
    const box = d.querySelector<HTMLInputElement>('#pop input[data-f="read"]')!;
    const count = () => d.querySelector('#mgr li[data-f="read"] b')!.textContent;
    expect(count()).toBe('2');
    box.click();
    expect(count()).toBe('3');
    expect(d.getElementById('chips')!.textContent).toBe('Read later');
    expect(d.getElementById('bm')!.classList.contains('on')).toBe(true);
    d.querySelector<HTMLButtonElement>('#langseg button[data-l="ja"]')!.click();
    expect(d.getElementById('chips')!.textContent).toBe('あとで読む');
    box.click();
    expect(count()).toBe('2');
    expect(d.getElementById('chips')!.textContent).toBe('');
    expect(d.getElementById('bm')!.classList.contains('on')).toBe(false);
    dom.window.close();
  });

  it('illustrates eight colors and the no-color option', () => {
    const dom = page();
    expect(dom.window.document.querySelectorAll('.dots i')).toHaveLength(9);
    expect(dom.window.document.querySelectorAll('.dots .none')).toHaveLength(1);
    dom.window.close();
  });

  it('compares three kinds of tools in every row, with PostShelf first', () => {
    const dom = page();
    const d = dom.window.document;
    expect(d.querySelectorAll('#compare thead th')).toHaveLength(4);
    const rows = d.querySelectorAll('#compare tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      expect(cells).toHaveLength(3);
      expect(cells[0].classList.contains('me')).toBe(true);
      expect(row.querySelector('th[scope="row"]')).not.toBeNull();
    }
    dom.window.close();
  });

  it('folds the smaller features behind a button that opens them', () => {
    const dom = page();
    const d = dom.window.document;
    const features = d.getElementById('featmore')!, button = d.getElementById('morefeat') as HTMLButtonElement;
    expect(features.classList.contains('fold')).toBe(true);
    expect(button.hidden).toBe(false);
    button.click();
    expect(features.classList.contains('fold')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.hidden).toBe(true);
    dom.window.close();
  });

  it('hides sharing when neither browser API is available', () => {
    const dom = page();
    expect(dom.window.document.querySelector<HTMLButtonElement>('#share')?.hidden).toBe(true);
    dom.window.close();
  });

  it('uses the native share dialog when available, without copying', async () => {
    const share = vi.fn().mockResolvedValue(undefined), writeText = vi.fn();
    const dom = page(w => {
      Object.defineProperty(w.navigator, 'share', { value: share });
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText } });
    });
    const button = dom.window.document.querySelector<HTMLButtonElement>('#share')!;
    expect(button.hidden).toBe(false);
    button.click();
    await settle();
    expect(share).toHaveBeenCalledWith({ url: dom.window.location.href });
    expect(writeText).not.toHaveBeenCalled();
    dom.window.close();
  });

  it('copies the URL and temporarily shows bilingual confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    let restore: (() => void) | undefined;
    const dom = page(w => {
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText } });
      w.setTimeout = ((callback: () => void) => {
        restore = callback;
        return 1;
      }) as typeof w.setTimeout;
    });
    const d = dom.window.document;
    const ready = d.querySelector<HTMLElement>('#share .s1')!, copied = d.querySelector<HTMLElement>('#share .s2')!;
    d.querySelector<HTMLButtonElement>('#share')!.click();
    await vi.waitFor(() => expect(copied.hidden).toBe(false));
    expect(writeText).toHaveBeenCalledWith(dom.window.location.href);
    expect(ready.hidden).toBe(true);
    expect(copied.querySelector('.ja')?.textContent).toBe('コピーしました');
    expect(copied.querySelector('.en')?.textContent).toBe('Copied');
    restore!();
    expect(copied.hidden).toBe(true);
    expect(ready.hidden).toBe(false);
    dom.window.close();
  });

  it.each(['share', 'clipboard'])('handles a rejected %s operation without a false confirmation', async api => {
    const reject = vi.fn().mockRejectedValue(new Error('Denied'));
    const dom = page(w => {
      Object.defineProperty(w.navigator, api, { value: api === 'share' ? reject : { writeText: reject } });
    });
    const d = dom.window.document;
    d.querySelector<HTMLButtonElement>('#share')!.click();
    await settle();
    expect(reject).toHaveBeenCalled();
    expect(d.querySelector<HTMLElement>('#share .s2')?.hidden).toBe(true);
    dom.window.close();
  });

  it('copies chrome://extensions with the copy button, and hides it without a clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const dom = page(w => Object.defineProperty(w.navigator, 'clipboard', { value: { writeText } }));
    dom.window.document.querySelector<HTMLButtonElement>('#copy')!.click();
    expect(writeText).toHaveBeenCalledWith('chrome://extensions');
    dom.window.close();
    const without = page();
    expect(without.window.document.querySelector<HTMLButtonElement>('#copy')?.hidden).toBe(true);
    without.window.close();
  });
});
