import { STRINGS } from './strings';

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
}

export interface Bookmark {
  tweetId: string;
  folderIds: string[];
  savedAt: number;
  snapshot: Snapshot;
}

/** 組み込みフォルダ「すべて」。保存はせず、常に先頭に仮想的に存在する。 */
export const ALL_FOLDER_ID = 'all';
export const ALL_FOLDER: Folder = {
  id: ALL_FOLDER_ID,
  name: STRINGS.allFolderName,
  icon: 'ti-stack-2',
  order: -1,
};

/** 色を選べるのはこのアイコンのときだけ */
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

export const isBuiltinFolder = (id: string): boolean => id === ALL_FOLDER_ID;
export const supportsColor = (icon: string): boolean => icon === FOLDER_ICON;
