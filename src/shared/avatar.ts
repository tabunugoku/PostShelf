/** 絵文字などの静的画像 URL か。プロフィールアイコンの取得・補完・表示で共通に使う。 */
export function isEmojiImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.includes('/emoji/')) return true;
  try {
    return new URL(url).hostname === 'abs.twimg.com';
  } catch {
    return false;
  }
}
