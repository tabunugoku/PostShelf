import { afterEach, describe, expect, it } from 'vitest';
import { xTheme } from '../src/content/theme';

const withBg = (bg: string) => {
  document.body.style.backgroundColor = bg;
  return xTheme();
};
afterEach(() => (document.body.style.backgroundColor = ''));

describe('xTheme', () => {
  it('detects light / dark / dim', () => {
    expect(withBg('rgb(255, 255, 255)').scheme).toBe('light');
    expect(withBg('rgb(0, 0, 0)').scheme).toBe('dark');
    expect(withBg('rgb(255, 255, 255)').bg).toBe('#ffffff');
    expect(withBg('rgb(0, 0, 0)').bg).toBe('#16181c');
    expect(withBg('rgb(21, 32, 43)').bg).toBe('#1e2732');
  });
});
