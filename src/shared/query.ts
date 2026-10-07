import { ALL_FOLDER_ID, type Bookmark } from './models';

export type SortKey = 'savedDesc' | 'savedAsc' | 'postedDesc' | 'postedAsc';

const posted = (b: Bookmark) => (b.snapshot.createdAt ? Date.parse(b.snapshot.createdAt) : 0) || 0;

/** フォルダで絞り込み → 検索 (本文/投稿者/ハンドル) → 並べ替え */
export function queryBookmarks(
  all: Bookmark[],
  opts: { folderId: string; search: string; sort: SortKey },
): Bookmark[] {
  const q = opts.search.trim().toLowerCase();
  const out = all.filter((b) => {
    if (opts.folderId !== ALL_FOLDER_ID && !b.folderIds.includes(opts.folderId)) return false;
    if (!q) return true;
    const s = b.snapshot;
    return [s.text, s.author, s.handle].some((x) => x.toLowerCase().includes(q));
  });
  const cmp: Record<SortKey, (a: Bookmark, b: Bookmark) => number> = {
    savedDesc: (a, b) => b.savedAt - a.savedAt,
    savedAsc: (a, b) => a.savedAt - b.savedAt,
    postedDesc: (a, b) => posted(b) - posted(a),
    postedAsc: (a, b) => posted(a) - posted(b),
  };
  return out.sort(cmp[opts.sort]);
}

export function countFolder(all: Bookmark[], folderId: string): number {
  return folderId === ALL_FOLDER_ID ? all.length : all.filter((b) => b.folderIds.includes(folderId)).length;
}
