import { queryFirst } from '../shared/selectors';
import { isBroken } from './health';

/**
 * 連動モード: X 本来のブックマークボタンの現在状態を読み、目的の状態でなければ 1 回だけ click する。
 * - 状態は bookmark (未保存) / removeBookmark (保存済み) の存在で判定する
 * - X の画面構造が変わって health が broken のときは何もしない (X 標準の動作に一切触れない)
 * - すでに目的の状態、またはボタンが見つからない場合は何もしない (X の DOM 変更に備え、エラーも出さない)
 * - ループ・一括・タイマー実行はしない。呼び出しはユーザーの 1 操作につき 1 回
 * @returns click したかどうか
 */
export function setNativeBookmark(article: Element, want: boolean): boolean {
  if (isBroken()) return false;
  const btn = queryFirst<HTMLElement>(article, want ? 'bookmark' : 'removeBookmark')?.el;
  if (!btn) return false;
  ownClick = true; // 置き換えモードの横取りリスナーが自分のクリックを拾って無限ループしないよう印を付ける
  try {
    btn.click();
  } finally {
    ownClick = false;
  }
  return true;
}

let ownClick = false;
/** いま PostShelf 自身が標準ボタンをプログラム的に click している最中か */
export const isOwnNativeClick = (): boolean => ownClick;
