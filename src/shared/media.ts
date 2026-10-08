/**
 * 画像 URL の扱い (純関数)。表示する URL の組み立てだけを行い、通信はしない。
 * X の画像 URL は `https://pbs.twimg.com/media/<id>?format=jpg&name=small` の形 (推測を含む。実機で確認する)。
 */
const NAME_PARAM = /([?&]name=)[^&#]*/;

/** `name=` パラメータを size に差し替える。pbs.twimg.com 以外、`name=` が無い URL (想定外の形) はそのまま返す */
export function withImageSize(url: string, size: string): string {
  if (!/^https:\/\/pbs\.twimg\.com\//.test(url) || !NAME_PARAM.test(url)) return url;
  return url.replace(NAME_PARAM, `$1${size}`);
}

/** ビューアで試す URL の順 (大きいほう → 小さいほう)。orig が無ければ large。想定外の形の URL は 1 件だけ (そのまま) */
export function viewerCandidates(url: string): string[] {
  return [...new Set([withImageSize(url, 'orig'), withImageSize(url, 'large')])];
}
