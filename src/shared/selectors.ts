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
  // 詳細ページの実機観測: 引用の time はこの入れ物の中。本体の time より先に現れる。
  quoteContainer: ['div[role="link"]'],
  // 引用内の写真リンクからだけ、引用元の ID を読む (time は a に包まれない)。
  quotePhotoLink: ['a[href*="/status/"][href*="/photo/"]'],
  quoteAvatarHandle: ['[data-testid^="UserAvatar-Container-"]'],
  quoteMedia: ['[data-testid="tweetPhoto"] img'],
  nameText: ['span'],
  bodyLink: ['a[href]'],
  avatar: ['[data-testid="Tweet-User-Avatar"] img', 'a[role="link"][href^="/"]:not([href*="/status/"]) img'],
  media: ['[data-testid="tweetPhoto"] img', 'a[href*="/photo/"] img'],
  // 以下は実機未確認の推測。動画は videoPlayer か video 要素
  video: ['[data-testid="videoPlayer"], [data-testid="videoComponent"]', 'video'],
  // 動画のサムネイル (poster 属性)。実機未確認の推測
  videoPoster: ['[data-testid="videoPlayer"] video[poster]', 'video[poster]'],
  // 長いポストのたたみ (「さらに表示」)。本文の後ろのボタンで、たたまれたポストにだけある (2026-10 の実機観測)。
  // 候補が 1 つだけ: data-testid 以外に目印が無い (文言は表示言語で変わる)
  showMore: ['[data-testid="tweet-text-show-more-link"]'],
  // 候補が 1 つだけ: リンクカードは data-testid 以外に目印が無い
  linkCard: ['[data-testid="card.wrapper"]'],
  // 現在ログイン中のアカウント (v9)。いずれも実機未確認 (2026-10 時点):
  // 1 番目: 左メニュー下部のアカウント切替ボタン。実機では表示名と @ハンドルが出ている
  // 2 番目: 左メニューの「プロフィール」リンク (href が /ハンドル)
  // 3 番目: 左メニュー内のアバター (data-testid が UserAvatar-Container-ハンドル)
  // 自動取り込み (v15) で使う。いずれも実機未確認の推測 (docs/MANUAL_TEST.md に未確認として書く):
  // 読み込み中の表示 (スクロールの下端に出るスピナー)。role="progressbar" を持つ (推測)。
  // ポストの中の読み込み表示 (動画など) は終わりの判定に関係ないので、メインの列の中に絞り、timelineLoading で article の内側を除く
  loadingIndicator: ['[data-testid="primaryColumn"] [role="progressbar"]'],
  // X が出すエラーや制限の表示 (「問題が発生しました」「Rate limit exceeded」と再試行ボタン)。data-testid は推測。
  // 誤検知で止めすぎないよう、文言 (表示言語で変わる) には頼らず、エラー専用らしい data-testid だけを候補にする
  xError: ['[data-testid="error-detail"]', '[data-testid="retry"]'],
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

/** User-Name を含む最も外側の入れ物。所属バッジの role=link は引用にしない (2026-10 の実機観測)。 */
export function findQuote(article: Element): Element | null {
  const containers = queryAllFirst(article, 'quoteContainer').els;
  return containers.find((el) => queryFirst(el, 'userName') && !containers.some((parent) => parent !== el && parent.contains(el))) ?? null;
}

/** 引用の中の候補を除いてから優先順を判定する。本体の候補が無ければ次の構造的な候補を試す。 */
export function queryAllOwn<T extends Element = Element>(article: Element, key: SelKey): FoundAll<T> {
  const list = CANDIDATES[key];
  for (let i = 0; i < list.length; i++) {
    const els = [...article.querySelectorAll<T>(list[i])].filter((el) => {
      const quote = closestFirst(el, 'quoteContainer')?.el;
      return !quote || !article.contains(quote);
    });
    if (els.length) return { els, index: i };
  }
  return { els: [], index: -1 };
}

/** 本体の最初の要素。article の外側の role=link は引用扱いにしない。 */
export function queryOwn<T extends Element = Element>(article: Element, key: SelKey): Found<T> | null {
  const { els, index } = queryAllOwn<T>(article, key);
  return els.length ? { el: els[0], index } : null;
}

/** 本体の time を囲むポストへのリンク。無ければ本体の最初の statusLink を使う。 */
export function ownPostLink(article: Element): { time: Element | null; link: HTMLAnchorElement | null } {
  const time = queryOwn(article, 'time')?.el ?? null;
  const timedLink = time ? closestFirst<HTMLAnchorElement>(time, 'statusLink')?.el : null;
  const link = timedLink && article.contains(timedLink) ? timedLink : queryOwn<HTMLAnchorElement>(article, 'statusLink')?.el ?? null;
  return { time, link };
}

/** タイムラインの読み込み表示が出ているか (ポスト = article の内側のものは数えない) */
export function timelineLoading(root: ParentNode): boolean {
  return queryAllFirst(root, 'loadingIndicator').els.some((el) => !el.closest('article'));
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

/**
 * ブックマークボタンの svg の高さと hover の丸の直径 (v35〜v37)。
 * 丸は svg の兄弟・祖先・その他の子孫の順で探す。X の構造の想定は buttons.ts と v37 の fixture に記載。
 * 計算したスタイルで丸を判定し、余白を含むボタン自身の寸法は使わない。
 */
export function bookmarkButtonGeometry(bm: HTMLElement): { iconHeight: number; circleDiameter: number } {
  const svg = bm.querySelector('svg');
  const sh = svg?.getBoundingClientRect().height ?? 0;
  const round = (el: Element) => {
    const cs = getComputedStyle(el);
    const br = cs.borderTopLeftRadius || cs.borderRadius;
    return br.endsWith('%') ? parseFloat(br) >= 50 : parseFloat(br) >= 999;
  };
  const circle = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.height > sh && Math.abs(r.width - r.height) <= 2 && round(el) ? r.height : 0;
  };
  let d = 0;
  if (svg && sh > 0) {
    const rank = (el: Element) => (el.parentElement === svg.parentElement ? 0 : el.contains(svg) ? 1 : 2);
    const cands = [...bm.querySelectorAll('*')].filter((el) => el !== svg && !svg.contains(el));
    // 同じ順位の中では、svg に近い祖先が先 (内側から外側)。
    cands.sort((x, y) => rank(x) - rank(y) || (x.contains(y) ? 1 : y.contains(x) ? -1 : 0));
    for (const el of cands) {
      d = circle(el);
      if (d > 0) break;
    }
  }
  return { iconHeight: sh, circleDiameter: d };
}
