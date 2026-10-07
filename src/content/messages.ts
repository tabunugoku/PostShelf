import { queryAllFirst } from '../shared/selectors';
import { getHealth, getSettings } from '../shared/settings';
import { extractTweet } from './snapshot';
import { setNativeBookmark } from './native';
import { getLocalHealth } from './health';
import { blockedWords, buildReport, skeleton } from '../shared/diagnostics';

/** 表示中のポストのうち tweetId が一致する article (個別ページでは本体のポスト) */
export function findArticle(tweetId: string, root: ParentNode = document): Element | null {
  for (const a of queryAllFirst(root, 'tweet').els) {
    if (extractTweet(a)?.tweetId === tweetId) return a;
  }
  return null;
}

/** サイドパネル / popup からの問い合わせ。ユーザーが画面で見ているポストの DOM だけを読む */
export function handleMessage(msg: { type?: string; tweetId?: string; want?: boolean }, sendResponse: (r: unknown) => void): boolean {
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
    void getSettings().then((s) => {
      const a = findArticle(msg.tweetId!);
      if (s.syncNative && a) setNativeBookmark(a, !!msg.want);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg?.type === 'getDiagnostics') {
    void buildLocalReport().then((report) => sendResponse({ ok: true, report }));
    return true;
  }
  return false;
}

/** 診断情報のテキスト。最初に見つかった article の骨格を含む (テキスト・URL・ユーザー名は含まない) */
export async function buildLocalReport(): Promise<string> {
  const article = queryAllFirst(document, 'tweet').els[0] ?? document.querySelector('article');
  const health = getLocalHealth() ?? (await getHealth());
  return buildReport({
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    uiLanguage: chrome.i18n.getUILanguage(),
    health,
    skeleton: article ? skeleton(article, blockedWords(article)) : null,
  });
}

export function installMessageHandler(): void {
  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => handleMessage(msg, sendResponse));
}
