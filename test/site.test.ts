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

  it('uses only sample account handles in the demo', () => {
    const dom = page();
    const handles = dom.window.document.querySelector('.demo')!.textContent!.match(/@[a-zA-Z0-9_]+/g)!;
    expect(handles).toHaveLength(3);
    for (const handle of handles) expect(handle).toMatch(/^@sample_/);
    dom.window.close();
  });

  it('illustrates eight colors and the no-color option', () => {
    const dom = page();
    expect(dom.window.document.querySelectorAll('.dots i')).toHaveLength(9);
    expect(dom.window.document.querySelectorAll('.dots .none')).toHaveLength(1);
    dom.window.close();
  });

  it('labels all 30 comparison values, using the selected language from the column headings', () => {
    const dom = page(), d = dom.window.document;
    const cells = d.querySelectorAll('#compare td');
    expect(cells).toHaveLength(30);
    for (const lang of ['ja', 'en']) {
      d.querySelector<HTMLButtonElement>(`#l-${lang}`)!.click();
      const headings = d.querySelectorAll('#compare thead th');
      for (const row of d.querySelectorAll('#compare tbody tr')) {
        [...row.querySelectorAll('td')].forEach((cell, i) => {
          expect(cell.hasAttribute('data-label')).toBe(true);
          const heading = headings[i + 1];
          expect(cell.getAttribute('data-label')).toBe((heading.querySelector(`.${lang}`) ?? heading).textContent!.trim());
        });
      }
    }
    dom.window.close();
  });

  it('expands and collapses six comparison items without duplicating any values', () => {
    const dom = page(), d = dom.window.document;
    const section = d.getElementById('compare')!, button = d.querySelector<HTMLButtonElement>('.compare-toggle')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(section.hasAttribute('data-collapsible')).toBe(true);
    expect(section.hasAttribute('data-expanded')).toBe(false);
    expect(button.getAttribute('aria-controls')).toBe(d.querySelector('tbody')?.id);
    const values = [...section.querySelectorAll('td')].map(c => c.textContent);
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(section.hasAttribute('data-expanded')).toBe(true);
    expect(button.querySelector<HTMLElement>('.less-label')?.hidden).toBe(false);
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(section.hasAttribute('data-expanded')).toBe(false);
    expect(button.querySelector<HTMLElement>('.more-label')?.hidden).toBe(false);
    expect([...section.querySelectorAll('td')].map(c => c.textContent)).toEqual(values);
    dom.window.close();
  });

  it('hides sharing when neither browser API is available', () => {
    const dom = page();
    expect(dom.window.document.querySelector<HTMLButtonElement>('#share-link')?.hidden).toBe(true);
    dom.window.close();
  });

  it('uses the native share dialog when available, without copying', async () => {
    const share = vi.fn().mockResolvedValue(undefined), writeText = vi.fn();
    const dom = page(w => {
      Object.defineProperty(w.navigator, 'share', { value: share });
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText } });
    });
    const button = dom.window.document.querySelector<HTMLButtonElement>('#share-link')!;
    expect(button.hidden).toBe(false);
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(share).toHaveBeenCalledWith({ url: dom.window.location.href });
    expect(writeText).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    dom.window.close();
  });

  it('copies the URL and temporarily shows bilingual confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    let restore: (() => void) | undefined;
    const dom = page(w => {
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText } });
      w.setTimeout = ((callback: () => void) => { restore = callback; return 1; }) as typeof w.setTimeout;
    });
    const d = dom.window.document;
    d.querySelector<HTMLButtonElement>('#share-link')!.click();
    await vi.waitFor(() => expect(d.querySelector<HTMLElement>('.share-copied')?.hidden).toBe(false));
    expect(writeText).toHaveBeenCalledWith(dom.window.location.href);
    expect(d.querySelector<HTMLElement>('.share-copied')?.hidden).toBe(false);
    expect(d.querySelector<HTMLElement>('.share-ready')?.hidden).toBe(true);
    expect(d.querySelector('.share-copied .ja')?.textContent).toBe('コピーしました');
    expect(d.querySelector('.share-copied .en')?.textContent).toBe('Copied');
    restore!();
    expect(d.querySelector<HTMLElement>('.share-copied')?.hidden).toBe(true);
    expect(d.querySelector<HTMLElement>('.share-ready')?.hidden).toBe(false);
    dom.window.close();
  });

  it.each(['share', 'clipboard'])('handles a rejected %s operation without a false confirmation', async api => {
    const reject = vi.fn().mockRejectedValue(new Error('Denied'));
    const dom = page(w => {
      Object.defineProperty(w.navigator, api, { value: api === 'share' ? reject : { writeText: reject } });
    });
    const d = dom.window.document, button = d.querySelector<HTMLButtonElement>('#share-link')!;
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.disabled).toBe(false);
    expect(d.querySelector<HTMLElement>('.share-copied')?.hidden).toBe(true);
    dom.window.close();
  });
});
