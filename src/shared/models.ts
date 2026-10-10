import { t } from './strings';
import type { Segment } from './segments';

export interface Folder {
  id: string;
  name: string;
  icon: string;
  color?: string;
  order: number;
  /** 所有するアカウント (v9)。保存済みのフォルダには必ず入る。「すべて」などの仮想フォルダには無い */
  accountId?: string;
}

/** X のアカウント (x.com の画面から読み取る。保存したアカウントの区別に使う) */
export interface Account {
  /** 正規化したハンドル (小文字、@ なし)。ハンドルを変えると別のアカウント扱いになる */
  id: string;
  /** 表示用のハンドル (@ なし。X での大文字小文字のまま) */
  handle: string;
  displayName?: string;
  avatar?: string;
  /** content script が最後にこのアカウントを読み取った時刻 (ms) */
  lastSeenAt: number;
}

/** アカウントを判定できなかったとき・v9 より前に保存したデータの所属先 (表示名は「アカウント未設定」) */
export const UNKNOWN_ACCOUNT_ID = 'unknown';

/** ブックマークの保存キー (accountId + tweetId)。同じポストを別アカウントで保存すると別のブックマークになる */
export const bookmarkKey = (accountId: string, tweetId: string): string => `${accountId}:${tweetId}`;

/** ハンドルから ID への正規化 (@ を外して小文字に) */
export const accountIdOf = (handle: string): string => handle.replace(/^@/, '').trim().toLowerCase();

/** 表示名: 「@handle」。未設定アカウントは t() で解決する */
export const accountLabel = (a: Pick<Account, 'id' | 'handle'>): string =>
  a.id === UNKNOWN_ACCOUNT_ID ? t('accountUnknownName') : `@${a.handle}`;

/** 見えていた範囲を、そのまま保存する。本文は X の側で途中までのことがあり、翻訳後の文のこともある。 */
export interface QuoteSnapshot {
  author: string;
  handle: string;
  avatar?: string;
  text: string;
  segments?: Segment[];
  media: string[];
  createdAt?: string;
  url?: string;
  translated?: true;
}

export interface Snapshot {
  quote?: QuoteSnapshot;
  /** 画面の本文が翻訳後のものだった場合だけ true。原文は取らない。 */
  translated?: true;
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
  /** 動画の `<video poster>` (サムネイルの URL)。保存時に content script が取る (v11)。取れなければ未定義。古い保存分も未定義 */
  videoPoster?: string;
  /**
   * X がたたんでいた (「さらに表示」があった) 状態で保存したか (v24。省略可)。真のあいだは、本文が途中までの可能性がある。
   * 全文を取れたら偽にする。無い保存分は、たたまれていたか不明 = 全文として扱う
   */
  truncated?: boolean;
  /** 本文を、リンクを含む順序つきの部品で持つ (v24。省略可)。text は、検索と書き出しのために残す。無い保存分は text だけで表示する */
  segments?: Segment[];
}

export interface Bookmark {
  /** 保存したアカウント (v9)。キーは bookmarkKey(accountId, tweetId) */
  accountId: string;
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

export const MAIN_ICONS = [
  'ti-folder',
  'ti-star',
  'ti-code',
  'ti-book',
  'ti-bulb',
  'ti-heart',
  'ti-photo',
  'ti-briefcase',
] as const;

export const MORE_ICONS = [
  'ti-palette',
  'ti-brush',
  'ti-pencil',
  'ti-camera',
  'ti-movie',
  'ti-music',
  'ti-microphone',
  'ti-device-gamepad-2',
  'ti-dice',
  'ti-puzzle',
  'ti-trophy',
  'ti-ghost',
  'ti-leaf',
  'ti-paw',
  'ti-cat',
  'ti-flame',
  'ti-moon',
  'ti-sun',
  'ti-cloud',
  'ti-plane',
  'ti-bike',
  'ti-coffee',
  'ti-pizza',
  'ti-gift',
  'ti-shopping-bag',
  'ti-map-pin',
  'ti-calendar',
  'ti-clock',
  'ti-tag',
  'ti-flag',
  'ti-rocket',
  'ti-diamond',
  'ti-sparkles',
  'ti-world',
  'ti-ticket',
  'ti-planet',
] as const;

export const ICONS = [...MAIN_ICONS, ...MORE_ICONS] as const;

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

const ICON_KEYS: Record<string, string> = {
  'ti-folder': 'iconFolder', 'ti-star': 'iconStar', 'ti-code': 'iconCode', 'ti-book': 'iconBook', 'ti-bulb': 'iconBulb',
  'ti-heart': 'iconHeart', 'ti-photo': 'iconPhoto', 'ti-briefcase': 'iconBriefcase', 'ti-music': 'iconMusic', 'ti-movie': 'iconMovie',
  'ti-palette': 'iconPalette',
  'ti-brush': 'iconBrush',
  'ti-pencil': 'iconPencil',
  'ti-camera': 'iconCamera',
  'ti-microphone': 'iconMicrophone',
  'ti-device-gamepad-2': 'iconGamepad',
  'ti-dice': 'iconDice',
  'ti-puzzle': 'iconPuzzle',
  'ti-trophy': 'iconTrophy',
  'ti-ghost': 'iconGhost',
  'ti-leaf': 'iconLeaf',
  'ti-paw': 'iconPaw',
  'ti-cat': 'iconCat',
  'ti-flame': 'iconFlame',
  'ti-moon': 'iconMoon',
  'ti-sun': 'iconSun',
  'ti-cloud': 'iconCloud',
  'ti-plane': 'iconPlane',
  'ti-bike': 'iconBike',
  'ti-coffee': 'iconCoffee',
  'ti-pizza': 'iconPizza',
  'ti-gift': 'iconGift',
  'ti-shopping-bag': 'iconShoppingBag',
  'ti-map-pin': 'iconMapPin',
  'ti-calendar': 'iconCalendar',
  'ti-clock': 'iconClock',
  'ti-tag': 'iconTag',
  'ti-flag': 'iconFlag',
  'ti-rocket': 'iconRocket',
  'ti-diamond': 'iconDiamond',
  'ti-sparkles': 'iconSparkles',
  'ti-world': 'iconWorld',
  'ti-ticket': 'iconTicket',
  'ti-planet': 'iconPlanet',
};
const COLOR_KEYS: Record<string, string> = {
  '#E24B4A': 'colorRed', '#BA7517': 'colorOrange', '#639922': 'colorGreen', '#1D9E75': 'colorTeal',
  '#378ADD': 'colorBlue', '#7F77DD': 'colorPurple', '#D4537E': 'colorPink', '#888780': 'colorGray',
};
/** アイコンボタンの読み上げ名 (クラス名の ti-star ではなく「星」)。知らないアイコンは ID のまま */
export const iconLabel = (icon: string): string => (ICON_KEYS[icon] ? t(ICON_KEYS[icon]) : icon);
/** 色のスウォッチの読み上げ名 (16 進数ではなく「赤」)。知らない色は値のまま */
export const colorLabel = (color: string): string => (COLOR_KEYS[color.toUpperCase()] ? t(COLOR_KEYS[color.toUpperCase()]) : color);

/** 表示名。組み込み「すべて」と、名前を保存していない「未分類」は t() で解決する */
export const displayName = (f: Folder): string =>
  f.id === ALL_FOLDER_ID ? t('allFolderName') : f.id === INBOX_ID && f.name === '' ? t('inboxName') : f.name;

export const isBuiltinFolder = (id: string): boolean => id === ALL_FOLDER_ID;

/** ユーザーが作ったフォルダだけ (「すべて」と「未分類」は含めない)。管理画面の左のメニューとポップアップの「フォルダ」の数は、これで数える */
export const userFoldersOf = (folders: Folder[]): Folder[] => folders.filter((f) => !isBuiltinFolder(f.id) && f.id !== INBOX_ID);
