import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Bookmark } from '../shared/models';

/** 小文字のハンドル (@ なし) → アイコンの URL。保存データのアイコンが空のときの代用元 */
export type AvatarFallback = ReadonlyMap<string, string>;

export const AvatarContext = createContext<AvatarFallback>(new Map());

const handleKey = (handle: string): string => handle.replace(/^@/, '').trim().toLowerCase();

/** 一覧から、ハンドルごとのアイコンの表を作る。同じハンドルが複数あれば、savedAt が最も新しいポストのもの。保存データは変えない */
export function buildAvatarFallback(bookmarks: Bookmark[]): AvatarFallback {
  const newest = new Map<string, { savedAt: number; avatar: string }>();
  for (const b of bookmarks) {
    const avatar = b.snapshot.avatar;
    const key = handleKey(b.snapshot.handle);
    if (!avatar || !key) continue;
    const cur = newest.get(key);
    if (!cur || b.savedAt > cur.savedAt) newest.set(key, { savedAt: b.savedAt, avatar });
  }
  return new Map([...newest].map(([key, v]) => [key, v.avatar]));
}

/** 保存データのアイコンが空なら、同じハンドルの他のポストのアイコンを使う。無ければ undefined (イニシャルを出す) */
export function useAvatar(avatar: string | undefined, handle: string): string | undefined {
  const fallback = useContext(AvatarContext);
  return avatar || fallback.get(handleKey(handle));
}
