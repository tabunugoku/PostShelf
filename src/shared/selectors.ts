/**
 * X (x.com) の DOM セレクタ。X の仕様変更時はこのファイルだけ直す。
 *
 * 各要素は「優先順の候補リスト」。1 番目は今の `data-testid`、2 番目以降は言語に依存しない構造的な候補。
 * `aria-label` の文言には依存しない (X の表示言語で変わるため)。
 * 取得は queryFirst / queryAllFirst / closestFirst を使い、「何番目の候補で見つかったか」を返す
 * (health.ts が 1 番目以外 = degraded を検出するのに使う)。
 *
 * 前提 (test/fixtures/*.html に固定。実機未確認の推測を含む):
 *  - ポストは article[data-testid="tweet"]
 *  - ブックマークボタンは未保存で [data-testid="bookmark"]、保存済みで [data-testid="removeBookmark"]
 *  - 投稿者表示は [data-testid="User-Name"]、本文は [data-testid="tweetText"]
 *  - 投稿日時は <time datetime> で、親の <a href="/{handle}/status/{id}"> に包まれる
 */
export const CANDIDATES = {
  // 2 番目: X の article は role="article" を持つ (推測)
  tweet: ['article[data-testid="tweet"]', 'article[role="article"]'],
  // 2 番目: 本文の div は lang 属性を持つ (推測)
  tweetText: ['[data-testid="tweetText"]', 'div[lang]'],
  // 2 番目: 投稿者名のリンクは「/status/ を含まない、先頭が / のリンク」(推測)
  userName: ['[data-testid="User-Name"]', 'a[role="link"][href^="/"]:not([href*="/status/"])'],
  // 候補が 1 つだけ: 標準ブックマークボタンは data-testid 以外に言語非依存の目印が無い (aria-label は表示言語で変わる)
  bookmark: ['[data-testid="bookmark"]'],
  removeBookmark: ['[data-testid="removeBookmark"]'],
  // 位置の特定と存在確認用 (未保存 / 保存済みのどちらか)。候補が 1 つだけの理由は上と同じ
  bookmarkButton: ['[data-testid="bookmark"], [data-testid="removeBookmark"]'],
  // 候補が 1 つだけ: 操作列は role="group" 以外に目印が無い
  actionGroup: ['[role="group"]'],
  // 候補が 1 つだけ: time 要素自体が意味を持つ構造
  time: ['time'],
  // 候補が 1 つだけ: ポストへのリンクは href の形で判定する
  statusLink: ['a[href*="/status/"]'],
  avatar: ['[data-testid="Tweet-User-Avatar"] img', 'a[role="link"][href^="/"]:not([href*="/status/"]) img'],
  media: ['[data-testid="tweetPhoto"] img', 'a[href*="/photo/"] img'],
  // 以下は実機未確認の推測。動画は videoPlayer か video 要素
  video: ['[data-testid="videoPlayer"], [data-testid="videoComponent"]', 'video'],
  // 動画のサムネイル (poster 属性)。実機未確認の推測
  videoPoster: ['[data-testid="videoPlayer"] video[poster]', 'video[poster]'],
  // 候補が 1 つだけ: リンクカードは data-testid 以外に目印が無い
  linkCard: ['[data-testid="card.wrapper"]'],
  // 現在ログイン中のアカウント (v9)。いずれも実機未確認 (2026-10 時点):
  // 1 番目: 左メニュー下部のアカウント切替ボタン。実機では表示名と @ハンドルが出ている
  // 2 番目: 左メニューの「プロフィール」リンク (href が /ハンドル)
  // 3 番目: 左メニュー内のアバター (data-testid が UserAvatar-Container-ハンドル)
  accountSwitcher: [
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Profile_Link"]',
    'header [data-testid^="UserAvatar-Container-"]',
  ],
} as const;

export type SelKey = keyof typeof CANDIDATES;

export interface Found<T extends Element = Element> {
  el: T;
  /** 何番目の候補で見つかったか (0 = 1 番目 = 通常) */
  index: number;
}
export interface FoundAll<T extends Element = Element> {
  els: T[];
  index: number;
}

/** 最初に見つかった候補の要素 */
export function queryFirst<T extends Element = Element>(root: ParentNode, key: SelKey): Found<T> | null {
  const list = CANDIDATES[key];
  for (let i = 0; i < list.length; i++) {
    const el = root.querySelector<T>(list[i]);
    if (el) return { el, index: i };
  }
  return null;
}

/** 候補ごとの最初の要素 (見つかった候補だけ、優先順)。1 番目が読めなくても 2 番目以降を試したいとき用 */
export function queryEveryCandidate<T extends Element = Element>(root: ParentNode, key: SelKey): Found<T>[] {
  const out: Found<T>[] = [];
  CANDIDATES[key].forEach((sel, index) => {
    const el = root.querySelector<T>(sel);
    if (el) out.push({ el, index });
  });
  return out;
}

/** 1 件以上見つかった最初の候補の全要素 */
export function queryAllFirst<T extends Element = Element>(root: ParentNode, key: SelKey): FoundAll<T> {
  const list = CANDIDATES[key];
  for (let i = 0; i < list.length; i++) {
    const els = [...root.querySelectorAll<T>(list[i])];
    if (els.length) return { els, index: i };
  }
  return { els: [], index: -1 };
}

/** el から見て最も近い祖先 (自身を含む) で、いずれかの候補に一致するもの */
export function closestFirst<T extends Element = Element>(el: Element, key: SelKey): Found<T> | null {
  const list = CANDIDATES[key];
  for (let i = 0; i < list.length; i++) {
    const hit = el.closest<T>(list[i]);
    if (hit) return { el: hit, index: i };
  }
  return null;
}

/**
 * ブックマーク一覧のパス (取り込みボタンを出すページ)。X の URL 変更時はここだけ直す。
 * 実機確認 (2026-10): 左メニュー「履歴」→「ブックマーク」タブ = /i/history。/i/bookmarks はそこへリダイレクトされる。
 * いいね (/i/history/likes) はブックマークではないので含めない。
 */
export const BOOKMARK_PATHS: readonly string[] = ['/i/history', '/i/bookmarks'];

/** 末尾のスラッシュは無視して完全一致で判定する (クエリ・ハッシュは pathname に含まれない) */
export const isBookmarksPath = (path: string): boolean => BOOKMARK_PATHS.includes(path.replace(/\/+$/, '') || '/');
