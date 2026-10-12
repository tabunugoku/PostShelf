import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { accountIdOf, type Bookmark } from '../shared/models';
import { isEmojiImageUrl } from '../shared/avatar';

/** 小文字のハンドル (@ なし) → アイコンの URL。保存データのアイコンが空のときの代用元 */
export type AvatarFallback = ReadonlyMap<string, string>;

/** 一覧のアイコンの代用元の表を、カードと引用へ渡す */
export const AvatarContext = createContext<AvatarFallback>(new Map());

/** 一覧から、ハンドルごとのアイコンの表を作る。同じハンドルが複数あれば、savedAt が最も新しいポストのもの。保存データは変えない */
export function buildAvatarFallback(bookmarks: Bookmark[], previous?: AvatarFallback): AvatarFallback {
  const avatars = new Map<string, string>();
  const newestAt = new Map<string, number>();
  for (const b of bookmarks) {
    const avatar = b.snapshot.avatar;
    const key = accountIdOf(b.snapshot.handle);
    if (!avatar || isEmojiImageUrl(avatar) || !key) continue;
    const at = newestAt.get(key);
    if (at === undefined || b.savedAt > at) {
      newestAt.set(key, b.savedAt);
      avatars.set(key, avatar);
    }
  }
  // Context の参照が変わると全カードへ通知される。所属だけが変わる場合は同じ表を渡す。
  if (previous?.size === avatars.size) {
    let same = true;
    for (const [key, avatar] of avatars) {
      if (previous.get(key) !== avatar) {
        same = false;
        break;
      }
    }
    if (same) return previous;
  }
  return avatars;
}

/** 保存データのアイコンが空なら、同じハンドルの他のポストのアイコンを使う。無ければ undefined (イニシャルを出す) */
export function useAvatar(avatar: string | undefined, handle: string): string | undefined {
  const fallback = useContext(AvatarContext);
  return (isEmojiImageUrl(avatar) ? undefined : avatar) || fallback.get(accountIdOf(handle));
}
