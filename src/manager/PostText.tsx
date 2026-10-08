/**
 * ポストの本文 (v24): リンクを <a> で表示し、長い本文は 6 行でたたんで「さらに表示」「閉じる」で広げる。
 * 広げた状態は、このポストごとの画面内の状態 (保存しない)。たたむ長さは、保存時に X がたたんでいたかには依存しない。
 * HTML としては解釈しない (部品ごとに要素を作る)。href は検証したものだけ (segments.ts)。
 */
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../shared/models';
import { segmentsOf } from '../shared/segments';
import { t } from '../shared/strings';

/** 6 行を超える本文か (レイアウトを測れない環境 = テストなどでの目安。実際の画面では、測った高さで決める) */
export const looksLong = (text: string): boolean => text.split('\n').length > 6 || text.length > 240;

export function PostText({ s, class: cls = 'text' }: { s: Snapshot; class?: string }) {
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState<boolean | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
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
        {segmentsOf(s).map((g) =>
          g.t === 'link' ? (
            <a class="tl" href={g.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              {g.v}
            </a>
          ) : (
            g.v
          ),
        )}
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
