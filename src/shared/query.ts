import { ALL_FOLDER_ID, INBOX_ID, type Bookmark } from './models';
import { foldText } from './fold';

export type SortKey = 'savedDesc' | 'savedAsc' | 'postedDesc' | 'postedAsc';

/** スマートビュー「直近 7 日」。保存データには無い仮想の絞り込み */
export const RECENT_ID = '@recent';
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export interface Filters {
  image?: boolean;
  video?: boolean;
  link?: boolean;
  /** 投稿者のハンドル (@ 付き)。ほかの条件とは AND */
  handle?: string;
}

const posted = (b: Bookmark) => (b.snapshot.createdAt ? Date.parse(b.snapshot.createdAt) : 0) || 0;

/**
 * 画像のポストか。動画のポストは、X が動画のサムネイルを画像として表示するので、保存時に media にそのサムネイルが入る。
 * そのため、hasVideo が真のポストは (media があっても) 画像ではない。動画の本数には依存しない。
 * hasVideo を持たない (v7 より前に保存した) ポストは、動画かどうか分からないので、media があれば画像として扱う。
 */
export const hasImage = (b: Bookmark): boolean => b.snapshot.hasVideo !== true && b.snapshot.media.length > 0;

/** 保存データに hasVideo / hasLink が無い (v6 以前に保存した) ポストは未判定として false 扱い = 絞り込みに出ない */
export function matchesFilters(b: Bookmark, f: Filters): boolean {
  if (f.image && !hasImage(b)) return false;
  if (f.video && b.snapshot.hasVideo !== true) return false;
  if (f.link && b.snapshot.hasLink !== true) return false;
  if (f.handle && b.snapshot.handle.toLowerCase() !== f.handle.toLowerCase()) return false;
  return true;
}

export const hasActiveFilters = (f: Filters): boolean => !!(f.image || f.video || f.link || f.handle);

/** フォルダごとの子孫 ID。表示用に事前計算し、ポストの所属を Set で照合する */
export type DescendantsOf = ReadonlyMap<string, ReadonlySet<string>>;

/** ビューの所属判定。子孫表の省略時は祖先にも表示し、指定時は最下位の所属だけにする */
export function inView(
  b: Bookmark,
  folderId: string,
  now = Date.now(),
  descendantsOf?: DescendantsOf,
): boolean {
  if (folderId === ALL_FOLDER_ID) return true;
  if (folderId === RECENT_ID) return b.savedAt >= now - RECENT_MS;
  if (!b.folderIds.includes(folderId)) return false;
  if (folderId === INBOX_ID) return true;
  const descendants = descendantsOf?.get(folderId);
  // 保存済みの所属は祖先を含むため、親と子の両方を直接選んだ場合も「子だけ」と区別できず、子にだけ表示する。
  return !descendants || !b.folderIds.some((id) => descendants.has(id));
}

export { foldText };

/**
 * ポストごとの、正規化済みの検索対象 (本文・投稿者・ハンドル)。キーは accountId:tweetId。
 * 読み込みのたびに snapshot のオブジェクトは作り直される (自動取り込み中は 20 件ごと) ので、オブジェクトではなく ID で持ち、
 * 本文・投稿者・ハンドルを個別に照合し、同じなら再計算しない。変わったポストだけ作り直す。
 */
const FOLD_CACHE_MAX = 20000;
const foldedPost = new Map<string, { text: string; author: string; handle: string; folded: string }>();
const foldedOf = (b: Bookmark): string => {
  const s = b.snapshot;
  const key = `${b.accountId}:${b.tweetId}`;
  const hit = foldedPost.get(key);
  if (hit && hit.text === s.text && hit.author === s.author && hit.handle === s.handle) return hit.folded;
  const folded = [s.text, s.author, s.handle].map(foldText).join('\u0000'); // 欄をまたぐ一致を避ける区切り
  if (foldedPost.size >= FOLD_CACHE_MAX && !hit) foldedPost.clear(); // メモリが増えすぎないよう、上限を超えたら全体を捨てて作り直す
  foldedPost.set(key, { text: s.text, author: s.author, handle: s.handle, folded });
  return folded;
};

/** ビュー (フォルダ / すべて / 直近 7 日) で絞り込み → 検索 (本文/投稿者/ハンドル) → 絞り込みチップ (AND) → 並べ替え */
export function queryBookmarks(
  all: Bookmark[],
  opts: {
    folderId: string;
    search: string;
    sort: SortKey;
    filters?: Filters;
    now?: number;
    descendantsOf?: DescendantsOf;
  },
): Bookmark[] {
  const q = foldText(opts.search.trim());
  const out = all.filter((b) => {
    if (!inView(b, opts.folderId, opts.now, opts.descendantsOf)) return false;
    if (opts.filters && !matchesFilters(b, opts.filters)) return false;
    if (!q) return true;
    return foldedOf(b).includes(q);
  });
  if (opts.sort === 'postedDesc' || opts.sort === 'postedAsc') {
    const direction = opts.sort === 'postedDesc' ? -1 : 1;
    return out
      .map((bookmark) => ({ bookmark, postedAt: posted(bookmark) }))
      .sort((a, b) => direction * (a.postedAt - b.postedAt))
      .map(({ bookmark }) => bookmark);
  }
  const cmp = {
    savedDesc: (a: Bookmark, b: Bookmark) => b.savedAt - a.savedAt,
    savedAsc: (a: Bookmark, b: Bookmark) => a.savedAt - b.savedAt,
  };
  return out.sort(cmp[opts.sort]);
}

/** 一覧と同じ所属判定で、検索・フィルターをかける前の件数を数える */
export function countFolder(
  all: Bookmark[],
  folderId: string,
  now = Date.now(),
  descendantsOf?: DescendantsOf,
): number {
  return all.filter((b) => inView(b, folderId, now, descendantsOf)).length;
}

/** 保存データにある投稿者のハンドル一覧 (件数の多い順、同数は名前順) */
export function authorHandles(all: Bookmark[]): { handle: string; author: string; count: number }[] {
  const m = new Map<string, { handle: string; author: string; count: number }>();
  for (const b of all) {
    const k = b.snapshot.handle.toLowerCase();
    const e = m.get(k) ?? { handle: b.snapshot.handle, author: b.snapshot.author, count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle));
}
