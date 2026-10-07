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
