/**
 * ポストの本文 (v24): リンクを <a> で表示し、長い本文は 6 行でたたんで「さらに表示」「閉じる」で広げる。
 * 広げた状態は、このポストごとの画面内の状態 (保存しない)。たたむ長さは、保存時に X がたたんでいたかには依存しない。
 * HTML としては解釈しない (部品ごとに要素を作る)。href は検証したものだけ (segments.ts)。
 */
import { createContext } from 'preact';
import { useContext, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { clipRanges, highlightRanges, searchTerms } from '../shared/highlight';
import type { Snapshot } from '../shared/models';
import { segmentsOf } from '../shared/segments';
import { t } from '../shared/strings';

/** 6 行を超える本文か (レイアウトを測れない環境 = テストなどでの目安。実際の画面では、測った高さで決める) */
export const looksLong = (text: string): boolean => text.split('\n').length > 6 || text.length > 240;

/** いま一覧に入れている検索語。本文の中の一致した語を <mark> にするために、一覧のカードへ渡す */
export const SearchContext = createContext('');

/** text を、一致した範囲 (text の中の添字) だけ <mark> にした部品の並びにする。HTML としては解釈しない */
function marked(text: string, ranges: [number, number][]) {
  if (!ranges.length) return text;
  const out: (string | preact.JSX.Element)[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark>{text.slice(a, b)}</mark>);
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function PostText({ s, class: cls = 'text' }: { s: Snapshot; class?: string }) {
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const terms = searchTerms(useContext(SearchContext));
  // たたんだ状態で、実際に 6 行を超えているかを測る (測れないときは、文字数の目安)
  useLayoutEffect(() => {
    const el = box.current;
    if (open || !el) return;
    const measure = () => setOverflow(el.clientHeight > 0 ? el.scrollHeight > el.clientHeight + 1 : null);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, s.text]);
  const toggle = open || (overflow ?? looksLong(s.text));
  return (
    <div class="post-text">
      <div ref={box} id={id} class={`${cls}${open ? '' : ' clamp'}`}>
        {(() => {
          const parts = segmentsOf(s);
          const ranges = highlightRanges(parts.map((g) => g.v).join(''), terms); // 部品をまたぐ一致も拾う
          let from = 0;
          return parts.map((g) => {
            const own = clipRanges(ranges, from, g.v.length);
            from += g.v.length;
            return g.t === 'link' ? (
              <a class="tl" href={g.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                {marked(g.v, own)}
              </a>
            ) : (
              marked(g.v, own)
            );
          });
        })()}
      </div>
      {(toggle || s.truncated === true) && (
        <div class="more-row">
          {toggle && (
            <button class="more-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
              {open ? t('dismiss') : t('showMore')}
            </button>
          )}
          {s.truncated === true && (
            <a class="more-btn" href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              {t('viewFullOnX')}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
