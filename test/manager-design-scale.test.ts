// 版: v85
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { managerCss } from './css-helpers';

const css = managerCss();
const dialogCss = readFileSync('static/autocollect-dialog.css', 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector}{`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start + selector.length + 2).split('}')[0];
};

describe('管理画面と確認ダイアログの尺度', () => {
  it('テーマによらない尺度を最初の共通ルートに置く', () => {
    const root = rule(':root,:host');
    const tokens = {
      'sp-1': '4px', 'sp-2': '8px', 'sp-3': '12px', 'sp-4': '16px', 'sp-6': '24px', 'sp-8': '32px',
      'h-control': '32px', 'h-row': '36px', 'h-list': '40px',
      'r-control': '8px', 'r-card': '12px', 'r-pill': '999px',
      icon: '18px', 'icon-sm': '16px', ease: 'cubic-bezier(.2,0,0,1)', dur: '120ms',
    };
    for (const [name, value] of Object.entries(tokens)) {
      expect(root).toContain(`--${name}:${value};`);
      expect(dialogCss.match(new RegExp(`--${name}:`, 'g'))).toHaveLength(1);
    }
  });

  it('太さは投稿者名だけ 600、その他は 400 と 500 にする', () => {
    expect(css).not.toMatch(/font-weight:\s*700/);
    const semibold = [...css.matchAll(/([^{}]+)\{[^{}]*font-weight:\s*600[^{}]*\}/g)];
    expect(semibold.map(match => match[1].trim())).toEqual(['.post-head strong']);
    expect(rule('.post-head .muted')).toContain('font-weight:400');
    expect(rule('.setting-group legend')).toContain('font-weight:500');
    // 凡例は枠の線に乗せず、面の中の見出しにする (線が文字に重なるため)
    expect(rule('.setting-group legend')).toContain('float:left');
  });

  it('行とメニューとチップに役割ごとの高さと余白を使う', () => {
    expect(rule('.fr')).toContain('min-height:var(--h-row)');
    expect(rule('.fr')).toContain('padding:0 var(--sp-2)');
    for (const selector of ['.menu-item', '.option', '.chip.filter,.scroll .chip']) {
      expect(rule(selector)).toContain('min-height:var(--h-control)');
    }
    expect(rule('.chip.filter,.scroll .chip')).toContain('border-radius:16px');
    expect(rule('.media')).toContain('gap:2px');
    expect(rule('.gc .cover-wrap')).toContain('border-radius:var(--sp-1)');
  });

  it('チェックをフォントに依存しないローカルの SVG mask で描く', () => {
    const check = rule('.sel:checked::after');
    expect(check).not.toContain('✓');
    expect(check).toMatch(/(?:-webkit-)?mask:.*data:image\/svg\+xml/);
    expect(check).toContain('background:#fff');
  });

  it('動画の下地を単色にし、動画の札の青い塗りは保つ', () => {
    for (const selector of ['.ph.v', '.viewer-video']) {
      expect(rule(selector)).toContain('background:#202327');
      expect(rule(selector)).not.toContain('linear-gradient');
    }
    expect(rule('.mk.v')).toContain('background:var(--accent-strong)');
  });

  it('スイッチは 36×20、つまみは 16 で transform だけで動かす', () => {
    expect(rule('.setting>input[role=switch]')).toContain('width:36px;height:20px;min-height:20px');
    expect(rule('.setting>input[role=switch]::after')).toContain('width:16px;height:16px');
    const checked = rule('.setting>input[role=switch]:checked::after');
    expect(checked).toContain('transform:translateX(16px)');
    expect(checked).not.toContain('left:');
    expect(css).toMatch(/prefers-reduced-motion:reduce[^}]+transition:none/);
  });

  it('動かす値と速さをそろえ、進行中の棒は transform で流す', () => {
    for (const match of css.matchAll(/transition:([^;}]+)/g)) {
      if (match[1] === 'none') continue;
      expect(match[1]).not.toMatch(/\b(all|width|left)\b/);
      expect(match[1]).toContain('var(--dur)');
      expect(match[1]).toContain('var(--ease)');
    }
    // 止まった棒は「35% まで進んだ」に見えるので、流す動きは残す
    expect(css).toContain('.ac-bar.ind i{animation:ac-slide');
    expect(css).toMatch(/@keyframes ac-slide\{0%\{transform:translateX\(-100%\)\}/);
    expect(css).not.toMatch(/@keyframes ac-slide[^@]*margin-left/);
    expect(css).toContain('.ac-dot.run{animation:ac-pulse');
  });

  it('設定は面と行の罫線にし、サイドパネルの上二段は 36、操作は 32 にする', () => {
    expect(rule('.setting-group')).toContain('padding:0 var(--sp-4)');
    expect(rule('.setting-group>.setting~.setting')).toContain('border-top:1px solid var(--border)');
    expect(rule('.phead')).toContain('padding:var(--sp-3)');
    expect(rule('.phead .acct-btn,.phead .folder-btn')).toContain('min-height:var(--h-row)');
    expect(rule('.phead .row>.icon-btn')).toContain('height:var(--h-row)');
    expect(rule('.layout-narrow .tools .seg')).toContain('min-height:var(--h-control)');
    expect(rule('.layout-narrow .tools .seg button')).toContain('height:calc(var(--h-control) - 2px)');
    expect(css).toContain('@media (max-width:380px)');
  });

  it('描画の省略とグリッドのチェックの位置と一括メニューの構造を保つ', () => {
    expect(css).toContain('.post{content-visibility:auto;contain-intrinsic-size:auto 320px}');
    expect(css).toContain('.mini{content-visibility:auto;contain-intrinsic-size:auto 44px}');
    expect(rule('.gc .sel')).toContain('top:-12px;left:-12px');
    expect(rule('.bulk-picker')).toContain('display:contents');
    expect(rule('.menu-bulk .bulk-folder-view')).toContain('min-height:0');
    expect(rule(':lang(ja) body')).toContain('word-break:auto-phrase;line-break:strict');
  });
});
