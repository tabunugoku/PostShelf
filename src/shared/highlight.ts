import { foldText, foldWithMap } from './fold';

/** 検索語全体を、一覧の絞り込みと同じ正規化 (foldText) にした 1 つの句。前後の空白だけ落とす */
export function searchTerms(q: string): string[] {
  const term = foldText(q.trim());
  return term ? [term] : [];
}

/**
 * text の中で、いずれかの語に一致する範囲 [start, end) (text の UTF-16 の添字) を返す。重なる・隣り合う範囲は 1 つにまとめる。
 * 比べるときは foldText と同じ書記素ごとの正規化 (全角半角・大文字小文字を区別しない) にし、結果は元の文字の位置に戻す。
 */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  if (!terms.length || !text) return [];
  const { folded, start, end } = foldWithMap(text);
  const found: [number, number][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      found.push([start[at], end[at + term.length - 1]]);
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: [number, number][] = [];
  for (const r of found) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** s[from, from+s.length) の範囲に収まる部分を、s の中の添字にして返す (部品ごとに分けるため) */
export function clipRanges(ranges: [number, number][], from: number, length: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of ranges) {
    const x = Math.max(a, from) - from;
    const y = Math.min(b, from + length) - from;
    if (x < y) out.push([x, y]);
  }
  return out;
}
