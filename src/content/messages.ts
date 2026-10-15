import { queryAllFirst, queryFirst } from '../shared/selectors';
import { getHealth, getSettings } from '../shared/settings';
import { extractTweet, fillSource, tweetIdOf } from './snapshot';
import { setNativeBookmark } from './native';
import { getLocalHealth } from './health';
import { blockedWords, buildReport, safePath, skeleton } from '../shared/diagnostics';

/** 表示中のポストのうち tweetId が一致する article (個別ページでは本体のポスト) */
export function findArticle(tweetId: string, root: ParentNode = document): Element | null {
  for (const a of queryAllFirst(root, 'tweet').els) {
    if (tweetIdOf(a) === tweetId) return a;
  }
  return null;
}

/** サイドパネル / popup からの問い合わせ。ユーザーが画面で見ているポストの DOM だけを読む */
export function handleMessage(msg: { type?: string; tweetId?: string; want?: boolean }, sendResponse: (r: unknown) => void): boolean {
  if (msg?.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'getPostSnapshot' && msg.tweetId) {
    const ex = (() => {
      const a = findArticle(msg.tweetId!);
      return a ? extractTweet(a) : null;
    })();
    sendResponse(ex ? { ok: true, tweetId: ex.tweetId, snapshot: ex.snapshot } : { ok: false });
    return false;
  }
  if (msg?.type === 'syncNative' && msg.tweetId) {
    // サイドパネルでの保存 (ユーザーの 1 操作) に対し、連動モードがオンのときだけ標準ブックマークを 1 回切り替える
    // 設定を読めなくても必ず応答する (応答のチャンネルを開いたままにしない)
    void getSettings()
      .then((s) => {
        const a = findArticle(msg.tweetId!);
        if (s.syncNative && a) setNativeBookmark(a, !!msg.want);
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'readFullText' && msg.tweetId) {
    // 裏方が開いたポストのページ (v24)。主役のポストが全文で表示されていれば、本文を返す。読み込み中なら wait。X が制限や警告を出していれば limit
    const a = findArticle(msg.tweetId);
    const ex = a ? extractTweet(a) : null;
    if (queryFirst(document, 'xError') && !ex) sendResponse({ ok: false, reason: 'limit' });
    else if (!ex || ex.snapshot.truncated || !ex.snapshot.text) sendResponse({ ok: false, reason: queryFirst(document, 'xError') ? 'limit' : 'wait' });
    else {
      sendResponse({
        ok: true,
        text: ex.snapshot.text,
        segments: ex.snapshot.segments,
        ...(ex.snapshot.translated ? { translated: true } : {}),
        fill: fillSource(ex),
      });
    }
    return false;
  }
  if (msg?.type === 'getDiagnostics') {
    void buildLocalReport()
      .then((report) => sendResponse({ ok: true, report }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
}

/** 診断情報のテキスト。最初に見つかった article の骨格を含む (テキスト・URL・ユーザー名は含まない) */
export async function buildLocalReport(): Promise<string> {
  const article = queryAllFirst(document, 'tweet').els[0] ?? queryFirst(document, 'articleFallback')?.el;
  // health を読めなくても、分かる範囲 (バージョン等) の報告は作る (Diagnostics.tsx の makeReport と同じ)
  const health = getLocalHealth() ?? (await getHealth().catch(() => null));
  return buildReport({
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    uiLanguage: chrome.i18n.getUILanguage(),
    health,
    path: safePath(location.pathname),
    skeleton: article ? skeleton(article, blockedWords(article)) : null,
  });
}

export function installMessageHandler(): void {
  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => handleMessage(msg, sendResponse));
}
