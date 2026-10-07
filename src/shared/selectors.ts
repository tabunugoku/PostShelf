/**
 * X (x.com) の DOM セレクタ。X の仕様変更時はこのファイルだけ直す。
 * 前提 (test/fixtures/tweet.html に固定。実機未確認の推測を含む):
 *  - ポストは article[data-testid="tweet"]
 *  - ブックマークボタンは未保存で [data-testid="bookmark"]、保存済みで [data-testid="removeBookmark"]
 *  - 投稿者表示は [data-testid="User-Name"]、本文は [data-testid="tweetText"]
 *  - 投稿日時は <time datetime> で、親の <a href="/{handle}/status/{id}"> に包まれる
 */
export const SEL = {
  tweet: 'article[data-testid="tweet"]',
  bookmark: '[data-testid="bookmark"]',
  removeBookmark: '[data-testid="removeBookmark"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
  avatar: '[data-testid="Tweet-User-Avatar"] img',
  media: '[data-testid="tweetPhoto"] img',
  time: 'time',
  statusLink: 'a[href*="/status/"]',
  // 以下 2 つは実機未確認の推測 (v7)。動画は video 要素か videoPlayer、リンクはリンクカード (card.wrapper) か本文中の外部リンク。
  video: 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"]',
  linkCard: '[data-testid="card.wrapper"]',
} as const;

export const bookmarkButtonSelector = `${SEL.bookmark}, ${SEL.removeBookmark}`;
