/**
 * 本文の部品の並び (v24)。本文中のリンクを、順序つきの部品として持つ。
 * 保存データの snapshot.segments は省略できる項目。無い (古い) 保存分は text だけで表示する。
 * HTML としては解釈しない (表示側は、部品ごとに要素を作る)。href は http: / https: だけを使う。
 */
export type Segment = { t: 'text'; v: string } | { t: 'link'; v: string; href: string };

/** X の画面のリンクの href を、安全な絶対 URL にする。http: / https: 以外 (javascript: など) は null。相対リンクは https://x.com を補う */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h) return null;
  try {
    const u = new URL(h, 'https://x.com');
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** 保存データ / 取り込んだ JSON の segments を検証する。形が不正なら undefined (無視して text で表示する)。href が不正なリンクは、文字に直す */
export function sanitizeSegments(raw: unknown): Segment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2000) return undefined;
  const out: Segment[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object' || typeof (s as { v?: unknown }).v !== 'string') return undefined;
    const seg = s as { t?: unknown; v: string; href?: unknown };
    if (seg.t === 'text') out.push({ t: 'text', v: seg.v });
    else if (seg.t === 'link') {
      const href = safeHref(seg.href);
      if (href) out.push({ t: 'link', v: seg.v, href });
      else out.push({ t: 'text', v: seg.v });
    } else return undefined;
  }
  return out;
}

/** 隣り合う文字の部品をまとめ、空の部品を除く */
export function mergeSegments(list: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of list) {
    if (!s.v) continue;
    const last = out[out.length - 1];
    if (s.t === 'text' && last?.t === 'text') last.v += s.v;
    else out.push({ ...s });
  }
  return out;
}

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]}、。」』）！？]+$/;

/**
 * segments が無い古い保存分: text の中の https:// (http://) で始まる URL だけをリンクにする。
 * X が途中で「…」に省略した URL (末尾が「…」や ...) は、飛べないのでリンクにしない。
 */
export function linkifyPlain(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const start = m.index ?? 0;
    if (/(…|\.\.\.)$/.test(url)) continue; // 省略されている
    const tail = url.match(TRAILING)?.[0] ?? '';
    if (tail) url = url.slice(0, url.length - tail.length);
    const href = safeHref(url);
    if (!href || url.length < 9) continue;
    out.push({ t: 'text', v: text.slice(last, start) });
    out.push({ t: 'link', v: url, href });
    last = start + url.length;
  }
  out.push({ t: 'text', v: text.slice(last) });
  return mergeSegments(out);
}

/** 表示する部品: 保存してある segments (検証済み) を使い、無ければ text から作る */
export function segmentsOf(s: { text: string; segments?: unknown }): Segment[] {
  return sanitizeSegments(s.segments) ?? linkifyPlain(s.text);
}
