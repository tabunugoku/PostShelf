import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (f: string) => readFileSync(resolve(process.cwd(), 'static', f), 'utf8');

describe('dark mode form controls', () => {
  it('manager.css (also used by the popup) follows the OS color scheme', () => {
    expect(css('manager.css')).toMatch(/:root\s*\{\s*color-scheme:\s*light dark/);
  });
  it('option / optgroup get explicit colors', () => {
    expect(css('manager.css')).toMatch(/option,\s*optgroup\s*\{[^}]*background:\s*var\(--surface-2\)[^}]*color:\s*var\(--text-primary\)/);
  });
  it('the popup page loads manager.css', () => {
    expect(readFileSync(resolve(process.cwd(), 'static/popup.html'), 'utf8')).toContain('manager.css');
  });
});

/** セレクタ(の先頭が sel)に一致する最初のルールの本文 */
const rule = (src: string, sel: string): string => {
  const i = src.indexOf(sel + '{');
  expect(i, `${sel} rule exists`).toBeGreaterThanOrEqual(0);
  return src.slice(i, src.indexOf('}', i));
};

describe('v9-D: selected state has no edge line (background + weight + aria only)', () => {
  const src = css('manager.css');
  it.each(['.fr.on', '.seg button.on', '.post.selected,.mini.selected,.gc.selected'])('%s has no inset box-shadow line', (sel) => {
    expect(rule(src, sel)).not.toMatch(/box-shadow:\s*inset/);
  });
  it('the sidebar row keeps a background and bold weight', () => {
    expect(rule(src, '.fr.on')).toMatch(/background:var\(--fill-ghost-selected\)/);
    expect(rule(src, '.fr.on')).toMatch(/font-weight:700/);
  });
});

describe('v9-G: the tab layout is not width-capped or centered', () => {
  const src = css('manager.css');
  it('.layout-wide has neither max-width nor margin:0 auto', () => {
    const r = rule(src, '.layout-wide');
    expect(r).not.toMatch(/max-width/);
    expect(r).not.toMatch(/margin:\s*0 auto/);
    expect(r).toMatch(/grid-template-columns:240px minmax\(0,1fr\)/);
  });
  it('post cards are capped by one CSS variable and stay left-aligned; the grid adds columns with the width', () => {
    expect(src).toMatch(/--post-col-max:\s*720px/);
    const r = rule(src, '.layout-wide .view-post');
    expect(r).toMatch(/max-width:var\(--post-col-max\)/);
    expect(r).not.toMatch(/margin/);
    expect(rule(src, '.view-grid')).toMatch(/repeat\(auto-fill,minmax\(\d+px,1fr\)\)/);
  });
  it('the narrow (side panel) layout is unchanged: 2 grid columns', () => {
    expect(src).toMatch(/\.layout-narrow \.view-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  });
});
