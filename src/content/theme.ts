import { ACCENT } from '../shared/tokens';

export interface XTheme {
  bg: string;
  fg: string;
  border: string;
  hover: string;
  accent: string;
  /** ネイティブのフォーム部品・スクロールバーを合わせるための color-scheme */
  scheme: 'light' | 'dark';
}

function parse(rgb: string): [number, number, number] | null {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * X のテーマ (ライト / ダーク / ダーク青) を body の computed style の背景色から判定し、
 * 注入 UI の配色を返す。背景色が取れない場合はライト扱い。
 */
export function xTheme(): XTheme {
  const rgb = parse(getComputedStyle(document.body).backgroundColor);
  const lum = rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 1;
  const accent = ACCENT;
  if (lum > 0.5) return { bg: '#ffffff', fg: '#0f1419', border: '#cfd9de', hover: 'rgba(15,20,25,.06)', accent, scheme: 'light' };
  // ダーク青 (dim) は青みがある (b > r)。それ以外 (lights out) は黒系。
  const dim = !!rgb && rgb[2] - rgb[0] > 15;
  return dim
    ? { bg: '#1e2732', fg: '#f7f9f9', border: '#38444d', hover: 'rgba(247,249,249,.08)', accent, scheme: 'dark' }
    : { bg: '#16181c', fg: '#e7e9ea', border: '#2f3336', hover: 'rgba(231,233,234,.08)', accent, scheme: 'dark' };
}
