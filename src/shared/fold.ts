/**
 * 検索用の正規化 (v31)。一覧の絞り込み・設定の検索・フォルダの絞り込み・本文の強調が、同じ判定を使う。
 * 他のモジュールに依存しない (content script からも読まれる)。
 *
 * 書記素 (見た目の 1 文字) の単位で、NFKC → 小文字にする。「ｶﾞ」(カ + 半角濁点) や「か」+「゛」(結合文字) は 1 つの書記素なので、
 * 全角の「ガ」「が」と同じ文字になる。Intl.Segmenter が無い環境では、コードポイント単位にする。
 */
const ASCII = /^[\x00-\x7f]*$/;
type Segmenter = { segment(s: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

function graphemes(s: string): string[] {
  if (segmenter === undefined) {
    try {
      const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => Segmenter }).Segmenter;
      segmenter = Seg ? new Seg('ja', { granularity: 'grapheme' }) : null;
    } catch {
      segmenter = null;
    }
  }
  return segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : [...s];
}

const foldOne = (g: string): string => g.normalize('NFKC').toLowerCase();

/** 正規化した文字列。ASCII だけの文字列は、小文字にするだけ (normalize を呼ばない) */
export function foldText(s: string): string {
  if (ASCII.test(s)) return s.toLowerCase();
  return graphemes(s).map(foldOne).join('');
}

/**
 * 正規化した文字列と、その各文字 (UTF-16) に対応する元の範囲 (start / end は元の文字列の添字)。
 * 一致した範囲を、元の本文の位置に戻すために使う (強調)。
 */
export function foldWithMap(text: string): { folded: string; start: number[]; end: number[] } {
  if (ASCII.test(text)) {
    const n = text.length;
    return { folded: text.toLowerCase(), start: Array.from({ length: n }, (_, i) => i), end: Array.from({ length: n }, (_, i) => i + 1) };
  }
  let folded = '';
  const start: number[] = [];
  const end: number[] = [];
  let pos = 0;
  for (const g of graphemes(text)) {
    const f = foldOne(g);
    for (let i = 0; i < f.length; i++) {
      start.push(pos);
      end.push(pos + g.length);
    }
    folded += f;
    pos += g.length;
  }
  return { folded, start, end };
}
