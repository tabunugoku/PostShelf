import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENT, ACCENT_FILL } from '../src/shared/tokens';

const css = readFileSync(resolve(process.cwd(), 'static/manager.css'), 'utf8');

/** :root の変数を、ライト (最初の :root) とダーク (prefers-color-scheme:dark の :root で上書き) で取り出す */
function themes() {
  const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = vars(css.slice(css.indexOf(':root{'), css.indexOf('@media (prefers-color-scheme:dark)')));
  const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme:dark)'));
  const dark = { ...light, ...vars(darkBlock.slice(0, darkBlock.indexOf('}}')) ) };
  return { light, dark };
}

const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lum = (c: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** rgba(r,g,b,a) を背景に重ねた色 */
const over = (rgba: string, bg: number[]) => {
  const m = rgba.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)!;
  const a = Number(m[4]);
  return [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + bg[i - 1] * (1 - a)));
};

describe('design tokens follow the X palette', () => {
  const { light, dark } = themes();
  it('dark: black page, #16181c surface, #2f3336 border, #9aa4ad secondary, #e7e9ea text', () => {
    expect(dark).toMatchObject({ 'surface-2': '#000000', 'surface-1': '#16181c', border: '#2f3336', 'text-secondary': '#9aa4ad', 'text-primary': '#e7e9ea' });
  });
  it('light: white page, #f7f9f9 surface, #eff3f4 border, #536471 secondary, #0f1419 text', () => {
    expect(light).toMatchObject({ 'surface-2': '#ffffff', 'surface-1': '#f7f9f9', border: '#eff3f4', 'text-secondary': '#536471', 'text-primary': '#0f1419' });
  });
  it('accent #1d9bf0 for emphasis, #0f6fb3 for fills that carry white text', () => {
    expect(light['fill-accent']).toBe('#1d9bf0');
    expect(light['accent-strong']).toBe('#0f6fb3');
    expect([ACCENT, ACCENT_FILL]).toEqual(['#1d9bf0', '#0f6fb3']);
  });

  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    describe(`${name} contrast (WCAG 4.5:1)`, () => {
      const bgs = ['surface-1', 'surface-2', 'surface-3', 'bg-accent'];
      it.each(['text-primary', 'text-secondary', 'text-muted', 'text-accent'])('%s on every surface', (fg) => {
        for (const bg of bgs) expect(ratio(rgb(t[fg]), rgb(t[bg])), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      });
      it('text on the selected-row overlay', () => {
        for (const base of ['surface-1', 'surface-2']) {
          const sel = over(t['fill-ghost-selected'].replace(/\s/g, ''), rgb(t[base]));
          for (const fg of ['text-primary', 'text-secondary']) expect(ratio(rgb(t[fg]), sel), `${fg} on selected/${base}`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it('v9-D: the selected row is clearly darker/lighter than both a plain row and a hovered row (not just a thin edge line)', () => {
        for (const base of ['surface-1', 'surface-2']) {
          const plain = rgb(t[base]);
          const hover = over(t['fill-ghost-hover'].replace(/\s/g, ''), plain);
          const sel = over(t['fill-ghost-selected'].replace(/\s/g, ''), plain);
          expect(ratio(sel, plain), `selected vs plain/${base}`).toBeGreaterThanOrEqual(1.1);
          expect(ratio(sel, hover), `selected vs hover/${base}`).toBeGreaterThanOrEqual(1.05);
        }
      });
      it('white on accent-strong and on danger-solid', () => {
        expect(ratio([255, 255, 255], rgb(t['accent-strong']))).toBeGreaterThanOrEqual(4.5);
        expect(ratio([255, 255, 255], rgb(t['danger-solid']))).toBeGreaterThanOrEqual(4.5);
      });
      it('danger text on surfaces', () => {
        for (const bg of ['surface-1', 'surface-2']) expect(ratio(rgb(t.danger), rgb(t[bg]))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
