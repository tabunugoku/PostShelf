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

import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Sentences, splitSentences } from '../src/manager/ui';

describe('v37-B: settings descriptions are shown one sentence per line (wording unchanged)', () => {
  const load = (lang: string) => JSON.parse(readFileSync(`static/_locales/${lang}/messages.json`, 'utf8')) as Record<string, { message: string }>;
  const ja = load('ja').fullTextSwitchDesc.message;
  const mount = async (text: string, lang: string, link = false) => {
    document.documentElement.lang = lang;
    document.body.innerHTML = '<p id="p" class="setting-desc"></p>';
    await act(() => void render(<Sentences text={text}>{link ? <a href="#x">link</a> : null}</Sentences>, document.getElementById('p')!));
    return [...document.querySelectorAll('.desc-line')].map((e) => e.textContent ?? '');
  };

  it('ja: fullTextSwitchDesc becomes one line per 「。」, and nothing is added or lost', async () => {
    const lines = await mount(ja, 'ja');
    expect(lines.length).toBe((ja.match(/。/g) ?? []).length);
    expect(lines.length).toBe(4);
    expect(lines.join('')).toBe(ja);
    for (const l of lines) expect(l.endsWith('。')).toBe(true);
  });

  it('the same result without Intl.Segmenter (split right after 「。」)', async () => {
    const seg = Intl.Segmenter;
    (Intl as any).Segmenter = undefined;
    try {
      const lines = await mount(ja, 'ja');
      expect(lines.length).toBe(4);
      expect(lines.join('')).toBe(ja);
      expect(splitSentences('一つ目。二つ目。')).toEqual(['一つ目。', '二つ目。']);
    } finally {
      (Intl as any).Segmenter = seg;
    }
  });

  it('en: one line per sentence; the words are all kept', async () => {
    const en = load('en').fullTextSwitchDesc.message;
    const lines = await mount(en, 'en');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join(' ')).toBe(en.replace(/\s+/g, ' ').trim());
  });

  it('a one-sentence string is one line; the link follows the last line', async () => {
    expect(await mount('一文だけです。', 'ja')).toEqual(['一文だけです。']);
    const guide = load('ja').updateGuide.message;
    const lines = await mount(guide, 'ja', true);
    expect(lines.length).toBeGreaterThan(1);
    const all = [...document.querySelectorAll('.desc-line')];
    expect(all[all.length - 1].querySelector('a')).not.toBeNull();
    expect(document.querySelectorAll('.desc-line a').length).toBe(1);
  });

  it('.desc-line is a block; the width cap stays off', () => {
    const css = readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/\.desc-line\{display:block\}/);
    expect(css).toMatch(/\.setting-desc\{[^}]*max-width:none/);
  });
});
