/**
 * 画像 URL の扱い (純関数)。表示する URL の組み立てだけを行い、通信はしない。
 * X の画像 URL は `https://pbs.twimg.com/media/<id>?format=jpg&name=small` の形 (推測を含む。実機で確認する)。
 */
const NAME_PARAM = /([?&]name=)[^&#]*/;

const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\//;

/** X の画像の置き場 (https://pbs.twimg.com/) の URL か。画像キャッシュが取りに行ってよい URL の条件 */
export const isTwimgUrl = (url: string): boolean => TWIMG_URL.test(url);

const X_IMAGE_URL = /^https:\/\/(?:pbs|abs)\.twimg\.com\//;

/**
 * X の画像の置き場 (pbs.twimg.com: 投稿の画像・アイコン・動画のサムネイル / abs.twimg.com: 絵文字・初期アイコン) の URL か。
 * 取り込む JSON の画像 URL の条件。先頭の一致だけで見るので、pbs.twimg.com.example.invalid のような偽のホストは通らない
 */
export const isXImageUrl = (url: unknown): url is string => typeof url === 'string' && X_IMAGE_URL.test(url);

/** `name=` パラメータを size に差し替える。pbs.twimg.com 以外、`name=` が無い URL (想定外の形) はそのまま返す */
export function withImageSize(url: string, size: string): string {
  if (!isTwimgUrl(url) || !NAME_PARAM.test(url)) return url;
  return url.replace(NAME_PARAM, `$1${size}`);
}

/** ビューアで試す URL の順 (大きいほう → 小さいほう)。orig が無ければ large。想定外の形の URL は 1 件だけ (そのまま) */
export function viewerCandidates(url: string): string[] {
  return [...new Set([withImageSize(url, 'orig'), withImageSize(url, 'large')])];
}
