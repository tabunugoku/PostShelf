import type { ComponentChildren } from 'preact';
/** 本体・引用に共通の、最大 4 枚の画像の並び。画像自体の操作とキャッシュは呼び出し側が決める。 */
export function MediaGrid({ count, children }: { count: number; children: ComponentChildren }) {
  return <div class={`media m${Math.min(count, 4)}`}>{children}</div>;
}
