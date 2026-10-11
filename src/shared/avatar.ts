/** 絵文字画像の URL か。プロフィールアイコンの取得・補完・表示で共通に使う。 */
export function isEmojiImageUrl(url: string | undefined): boolean {
  // 初期アイコンも abs.twimg.com にある想定 (実機未確認の推測)。ホスト全体を除外せず /emoji/ だけを見る。
  return !!url && url.includes('/emoji/');
}
