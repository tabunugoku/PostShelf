import { t } from './strings';

export interface Folder {
  id: string;
  name: string;
  icon: string;
  color?: string;
  order: number;
}

export interface Snapshot {
  text: string;
  author: string;
  handle: string;
  avatar?: string;
  media: string[];
  createdAt?: string;
  url: string;
  /** 動画を含むか。保存時に content script が判定する (v7)。既存データでは未定義 = 未判定 (「動画あり」の絞り込みには出ない) */
  hasVideo?: boolean;
  /** 外部リンク / リンクカードを含むか。同上 (v7) */
  hasLink?: boolean;
}

export interface Bookmark {
  tweetId: string;
  folderIds: string[];
  savedAt: number;
  snapshot: Snapshot;
}

/** 組み込みフォルダ「すべて」。保存はせず、常に先頭に仮想的に存在する。 */
export const ALL_FOLDER_ID = 'all';
/** ページ収集の取り込み先。名前は保存せず '' にして表示時に解決する */
export const INBOX_ID = 'inbox';
export const ALL_FOLDER: Folder = {
  id: ALL_FOLDER_ID,
  name: '', // 表示時に displayName() で解決 (言語切替に追従)
  icon: 'ti-bookmarks',
  order: -1,
};

/** 新規フォルダの既定アイコン (色はどのアイコンでも選べる。v5 で「folder のみ」から変更) */
export const FOLDER_ICON = 'ti-folder';

export const ICONS = [
  'ti-folder',
  'ti-star',
  'ti-code',
  'ti-book',
  'ti-bulb',
  'ti-heart',
  'ti-photo',
  'ti-briefcase',
  'ti-music',
  'ti-movie',
] as const;

export const COLORS = [
  '#E24B4A',
  '#BA7517',
  '#639922',
  '#1D9E75',
  '#378ADD',
  '#7F77DD',
  '#D4537E',
  '#888780',
] as const;

/** 表示名。組み込み「すべて」と、名前を保存していない「未分類」は t() で解決する */
export const displayName = (f: Folder): string =>
  f.id === ALL_FOLDER_ID ? t('allFolderName') : f.id === INBOX_ID && f.name === '' ? t('inboxName') : f.name;

export const isBuiltinFolder = (id: string): boolean => id === ALL_FOLDER_ID;
