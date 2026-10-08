import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { REPO_URL } from '../src/shared/links';

const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  await act(() => void render(<App />, $('#app')));
  await act(() => new Promise<void>((r) => setTimeout(r, 40)));
});
afterEach(() => render(null, $('#app')));

describe('v23 (v25 で左のメニューへ移動): GitHub のリンク', () => {
  it('is an <a> under 「設定」 in the left menu, opening the repository in a new tab safely', () => {
    const a = $<HTMLAnchorElement>('.side a.gh-link');
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe('https://github.com/tabunugoku/PostShelf');
    expect(a.getAttribute('href')).toBe(REPO_URL);
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(a.rel).toContain('noreferrer');
    expect(a.getAttribute('aria-label')).toBe('GitHub で見る（新しいタブで開きます）');
    const icons = [...a.querySelectorAll('i')].map((i) => i.className);
    expect(icons[0]).toContain('ti-brand-github'); // 左にロゴ
    expect(icons[1]).toContain('ti-external-link'); // 右に外部リンクの印
    const side = [...$('.side').children];
    expect(side.indexOf(a)).toBeGreaterThan(side.findIndex((e) => e.textContent?.trim() === '設定'));
    expect(a.tabIndex).toBe(0);
  });

  it('the repository URL is defined in one place only (src/shared/links.ts)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && readFileSync(p, 'utf8').includes('github.com/tabunugoku/PostShelf')) hits.push(p);
      }
    };
    walk('src');
    expect(hits).toEqual([join('src', 'shared', 'links.ts')]);
    expect(readFileSync('src/shared/links.ts', 'utf8').match(/github\.com\/tabunugoku\/PostShelf/g)).toHaveLength(1);
  });

  it('adds no permission and no network code: the link is a plain anchor', () => {
    const m = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
    expect(m.permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel']);
    expect(m.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*']);
  });
});
