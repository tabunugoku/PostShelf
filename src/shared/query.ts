import { ALL_FOLDER_ID, type Bookmark } from './models';
import { foldText } from './fold';

export type SortKey = 'savedDesc' | 'savedAsc' | 'postedDesc' | 'postedAsc';

/** スマートビュー「最近の 7 日」。保存データには無い仮想の絞り込み */
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

export function inView(b: Bookmark, folderId: string, now = Date.now()): boolean {
  if (folderId === ALL_FOLDER_ID) return true;
  if (folderId === RECENT_ID) return b.savedAt >= now - RECENT_MS;
  return b.folderIds.includes(folderId);
}

export { foldText };

/**
 * ポストごとの、正規化済みの検索対象 (本文・投稿者・ハンドル)。キーは accountId:tweetId。
 * 読み込みのたびに snapshot のオブジェクトは作り直される (自動取り込み中は 20 件ごと) ので、オブジェクトではなく ID で持ち、
 * sig (本文・投稿者・ハンドルそのもの) が同じなら再計算しない。本文が変わったポストだけ作り直す (v35)。
 */
const FOLD_CACHE_MAX = 20000;
const foldedPost = new Map<string, { sig: string; folded: string }>();
const foldedOf = (b: Bookmark): string => {
  const s = b.snapshot;
  const sig = [s.text, s.author, s.handle].join('\u0000');
  const key = `${b.accountId}:${b.tweetId}`;
  const hit = foldedPost.get(key);
  if (hit && hit.sig === sig) return hit.folded;
  const folded = [s.text, s.author, s.handle].map(foldText).join('\u0000'); // 欄をまたぐ一致を避ける区切り
  if (foldedPost.size >= FOLD_CACHE_MAX && !hit) foldedPost.clear(); // メモリが増えすぎないよう、上限を超えたら全体を捨てて作り直す
  foldedPost.set(key, { sig, folded });
  return folded;
};

/** ビュー (フォルダ / すべて / 最近の 7 日) で絞り込み → 検索 (本文/投稿者/ハンドル) → 絞り込みチップ (AND) → 並べ替え */
export function queryBookmarks(
  all: Bookmark[],
  opts: { folderId: string; search: string; sort: SortKey; filters?: Filters; now?: number },
): Bookmark[] {
  const q = foldText(opts.search.trim());
  const out = all.filter((b) => {
    if (!inView(b, opts.folderId, opts.now)) return false;
    if (opts.filters && !matchesFilters(b, opts.filters)) return false;
    if (!q) return true;
    return foldedOf(b).includes(q);
  });
  const cmp: Record<SortKey, (a: Bookmark, b: Bookmark) => number> = {
    savedDesc: (a, b) => b.savedAt - a.savedAt,
    savedAsc: (a, b) => a.savedAt - b.savedAt,
    postedDesc: (a, b) => posted(b) - posted(a),
    postedAsc: (a, b) => posted(a) - posted(b),
  };
  return out.sort(cmp[opts.sort]);
}

export function countFolder(all: Bookmark[], folderId: string, now = Date.now()): number {
  return all.filter((b) => inView(b, folderId, now)).length;
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
