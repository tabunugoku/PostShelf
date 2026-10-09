import { describe, expect, it } from 'vitest';
import { sizeSeparateButton } from '../src/content/buttons';

const rect = (w: number, h: number) => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
const size = (btn: HTMLElement) => [btn.style.width, btn.style.height];

describe('v37-A: the folder button circle follows the circle element among the descendants of the bookmark button', () => {
  /** X の操作アイコンの推測の構造: 親の中に、絶対配置の丸 (svg の兄弟) と svg がある */
  const make = (o: { bmH?: number; bmW?: number; svgH?: number; ring?: { w: number; h: number; radius: string; pos?: 'sibling' | 'cousin' } }) => {
    const bm = document.createElement('button');
    bm.getBoundingClientRect = () => rect(o.bmW ?? 60, o.bmH ?? 80);
    const wrap = document.createElement('div');
    bm.append(wrap);
    wrap.innerHTML = '<svg></svg>';
    const svg = wrap.querySelector('svg')!;
    svg.getBoundingClientRect = () => rect(o.svgH ?? 22, o.svgH ?? 22);
    if (o.ring) {
      const ring = document.createElement('div');
      ring.style.cssText = `position:absolute;border-radius:${o.ring.radius}`;
      ring.getBoundingClientRect = () => rect(o.ring!.w, o.ring!.h);
      if (o.ring.pos === 'cousin') {
        const other = document.createElement('div');
        other.append(ring);
        bm.append(other);
      } else wrap.prepend(ring);
    }
    return { bm, btn: document.createElement('button') };
  };

  it('uses the diameter of a round element that is the sibling of the svg', () => {
    const a = make({ ring: { w: 56, h: 56, radius: '9999px' } });
    sizeSeparateButton(a.bm, a.btn);
    expect(size(a.btn)).toEqual(['56px', '56px']);
    const b = make({ ring: { w: 56, h: 57, radius: '50%' } });
    sizeSeparateButton(b.bm, b.btn);
    expect(size(b.btn)).toEqual(['57px', '57px']);
  });

  it('finds a round element elsewhere in the descendants too', () => {
    const c = make({ ring: { w: 50, h: 50, radius: '9999px', pos: 'cousin' } });
    sizeSeparateButton(c.bm, c.btn);
    expect(size(c.btn)).toEqual(['50px', '50px']);
  });

  it('ignores elements that are not larger than the svg, not square, or not round', () => {
    for (const ring of [{ w: 22, h: 22, radius: '9999px' }, { w: 56, h: 40, radius: '9999px' }, { w: 56, h: 56, radius: '4px' }]) {
      const x = make({ ring });
      sizeSeparateButton(x.bm, x.btn);
      expect(size(x.btn), JSON.stringify(ring)).toEqual(['38px', '38px']);
    }
  });

  it('without a circle element: svg height + 16px, never the (padded) height of the bookmark button', () => {
    const x = make({ bmH: 90 });
    sizeSeparateButton(x.bm, x.btn);
    expect(size(x.btn)).toEqual(['38px', '38px']);
    const y = make({ bmH: 90, svgH: 24 });
    sizeSeparateButton(y.bm, y.btn);
    expect(size(y.btn)).toEqual(['40px', '40px']);
  });

  it('buttons that differ only in width give the same size; a svg that cannot be measured gives 34px; the max is 64px', () => {
    const a = make({ bmW: 40 });
    const b = make({ bmW: 110 });
    sizeSeparateButton(a.bm, a.btn);
    sizeSeparateButton(b.bm, b.btn);
    expect(size(b.btn)).toEqual(size(a.btn));
    const z = make({ svgH: 0 });
    sizeSeparateButton(z.bm, z.btn);
    expect(size(z.btn)).toEqual(['34px', '34px']);
    const big = make({ ring: { w: 100, h: 100, radius: '9999px' } });
    sizeSeparateButton(big.bm, big.btn);
    expect(size(big.btn)).toEqual(['64px', '64px']);
  });

  it('prefers the sibling of the svg over a farther round element', () => {
    const x = make({ ring: { w: 56, h: 56, radius: '9999px' } });
    const far = document.createElement('div');
    far.style.borderRadius = '9999px';
    far.getBoundingClientRect = () => rect(44, 44);
    x.bm.prepend(far); // DOM の順では、こちらが先
    sizeSeparateButton(x.bm, x.btn);
    expect(size(x.btn)).toEqual(['56px', '56px']);
  });
});
