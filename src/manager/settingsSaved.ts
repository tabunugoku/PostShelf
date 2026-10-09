import { createContext } from 'preact';

/**
 * 設定ページで、設定の保存に成功したときに呼ぶ (「変更を保存しました」を出す)。
 * 設定を書く部品 (画像のキャッシュ、全文の取得など) は、書き込みが成功したあとでこれを呼ぶ。出さない操作 (書き出し・初期化・削除) は呼ばない。
 */
export const SavedContext = createContext<() => void>(() => {});
