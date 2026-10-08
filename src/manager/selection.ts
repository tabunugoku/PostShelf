/** 複数選択・並べ替え用の純粋関数 (単体テスト対象) */

/** 表示順 order の中で anchor から target までの範囲 (両端含む)。どちらかが無ければ target のみ */
export function rangeIds(order: string[], anchor: string | null, target: string): string[] {
  const a = anchor === null ? -1 : order.indexOf(anchor);
  const b = order.indexOf(target);
  if (b < 0) return [];
  if (a < 0) return [target];
  const [from, to] = a < b ? [a, b] : [b, a];
  return order.slice(from, to + 1);
}

/** list の中で id を targetId の直前へ動かした新しい並び (同じ id や未知の id なら元のまま) */
export function moveBefore(list: string[], id: string, targetId: string): string[] {
  if (id === targetId || !list.includes(id) || !list.includes(targetId)) return list;
  const without = list.filter((x) => x !== id);
  without.splice(without.indexOf(targetId), 0, id);
  return without;
}

/** 現在の選択を、存在するポストだけに絞る */
export const pruneSelection = (selected: Set<string>, existing: Set<string>): Set<string> =>
  new Set([...selected].filter((id) => existing.has(id)));

export const MIME_POSTS = 'application/x-postshelf-posts';
export const MIME_FOLDER = 'application/x-postshelf-folder';
