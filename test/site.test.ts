import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve('site/index.html'), 'utf8');
// Use the installed jsdom without adding a dependency just for its declarations.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: string }) => { window: Window & typeof globalThis };
};
function page() {
  return new JSDOM(html, { url: 'https://tabunugoku.github.io/PostShelf/', runScripts: 'dangerously' });
}

describe('紹介サイト', () => {
  it('pairs Japanese copy with English copy', () => {
    const dom = page();
    for (const ja of dom.window.document.querySelectorAll('span.ja')) {
      expect(ja.nextElementSibling?.matches('span.en'), ja.textContent ?? '').toBe(true);
    }
    dom.window.close();
  });

  it('has no external scripts or stylesheets', () => {
    const dom = page();
    expect(dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"]')).toHaveLength(0);
    dom.window.close();
  });

  it('has two language buttons and updates their pressed state and aria labels', () => {
    const dom = page();
    const d = dom.window.document;
    expect(d.querySelectorAll('.lang button[aria-pressed]')).toHaveLength(2);
    (d.getElementById('l-ja') as HTMLButtonElement).click();
    expect(d.documentElement.lang).toBe('ja');
    expect(d.getElementById('l-ja')?.getAttribute('aria-pressed')).toBe('true');
    expect(d.querySelector('.github')?.getAttribute('aria-label')).toContain('GitHub で');
    (d.getElementById('l-en') as HTMLButtonElement).click();
    expect(d.getElementById('l-en')?.getAttribute('aria-pressed')).toBe('true');
    expect(d.getElementById('l-ja')?.getAttribute('aria-pressed')).toBe('false');
    dom.window.close();
  });

  it('offers compact header controls and five reachable section tabs', () => {
    const dom = page();
    const d = dom.window.document;
    expect(d.querySelector('#l-en .lang-short')?.textContent).toBe('EN');
    expect(d.querySelector('.github')?.getAttribute('data-aria-en')).toBeTruthy();
    const tabs = d.querySelectorAll('.mobile-tabs a');
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) expect(d.querySelector(tab.getAttribute('href')!)).not.toBeNull();
    dom.window.close();
  });
});
