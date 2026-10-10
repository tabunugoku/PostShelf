import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('static/manager.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2]).join(';');

it('keeps the folder ellipsis free of underlines and uses the icon hover background', () => {
  expect(rule('.fr .more-btn:hover')).toContain('text-decoration:none');
  expect(rule('.fr .more-btn:hover')).toContain('background:var(--fill-ghost-hover)');
  expect(rule('.icon-btn:hover')).toContain('background:var(--fill-ghost-hover)');
});

it('preserves the underline for post read-more buttons and links', () => {
  expect(rule('.more-btn:hover')).toContain('text-decoration:underline');
  expect(rule('.more-btn:hover')).toContain('background:transparent');
});
