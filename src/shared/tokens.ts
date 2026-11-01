/**
 * x.com に注入する UI 用の配色トークン (static/manager.css の変数と同じ値)。
 * 管理画面の CSS 変数は OS の prefers-color-scheme に追従するが、x.com 上の UI は X 自身のテーマに追従する (content/theme.ts)。
 */
/** アイコン・リンク・選択の強調 */
export const ACCENT = '#1d9bf0';
/** 文字 (白) の載る塗り (ボタン、バッジ)。白文字で 4.5:1 以上 */
export const ACCENT_FILL = '#0f6fb3';

/** CSS の --sp-* と共通の余白 (px) */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;
/** ボタン・メニュー・チップの高さ (px) */
export const CONTROL_HEIGHT = 32;
/** サイドバー・検索・主ボタンの高さ (px) */
export const ROW_HEIGHT = 36;
/** リスト表示の行の高さ (px) */
export const LIST_HEIGHT = 40;
/** 操作部品の角丸 (px) */
export const RADIUS_CONTROL = 8;
/** カード・メニュー・ダイアログの角丸 (px) */
export const RADIUS_CARD = 12;
/** 検索欄などの丸いピルの角丸 (px) */
export const RADIUS_PILL = 999;
/** 行・ツールバーのアイコンの大きさ (px) */
export const ICON = 18;
/** チップ・ボタン・メニューの小さいアイコンの大きさ (px) */
export const ICON_SMALL = 16;
/** 管理画面と同じ和文フォントを含む並び */
export const FONT_STACK = 'system-ui,"Hiragino Sans","Yu Gothic",sans-serif';
/** X のテーマの明暗に合わせる、管理画面と同じポップオーバーの影 */
export const POPOVER_SHADOW = {
  light: '0 8px 24px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.08)',
  dark: '0 8px 24px rgba(0,0,0,.5)',
} as const;
/** CSS の --ease と共通の動きの曲線 */
export const EASE = 'cubic-bezier(.2,0,0,1)';
/** CSS の --dur と共通の動きの時間 (ms) */
export const DURATION_MS = 120;
/** 管理画面と同じ Tabler check の線を描くローカルの mask */
export const CHECK_MASK = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 '
  + 'viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 '
  + 'stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 12l4 4L19 6%27/'
  + '%3E%3C/svg%3E") center/contain no-repeat';
/** 一部だけ選択されたフォルダの Tabler minus の線を描くローカルの mask */
export const MINUS_MASK = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 '
  + 'viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 '
  + 'stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 12h14%27/'
  + '%3E%3C/svg%3E") center/contain no-repeat';
