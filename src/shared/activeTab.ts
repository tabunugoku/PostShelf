/**
 * サイドパネルから「いま開いているポスト」を知るための、アクティブタブの URL 判定。
 * x.com / twitter.com は host_permissions に入っているので、`tabs` 権限なしでも tab.url が読める (権限は追加しない)。
 */
export interface ActivePost {
  tabId: number;
  tweetId: string;
}

const STATUS = /^https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/;

export const parsePostUrl = (url: string | undefined): string | null => url?.match(STATUS)?.[1] ?? null;

async function current(): Promise<ActivePost | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tweetId = parsePostUrl(tab?.url);
  return tab?.id !== undefined && tweetId ? { tabId: tab.id, tweetId } : null;
}

/** アクティブタブが x.com のポスト (/status/...) のときだけ値が入る。タブの切替・URL 変更に追従。解除関数を返す */
export function watchActivePost(cb: (p: ActivePost | null) => void): () => void {
  const update = () => void current().then(cb).catch(() => cb(null));
  update();
  chrome.tabs?.onActivated?.addListener(update);
  chrome.tabs?.onUpdated?.addListener(update);
  return () => {
    chrome.tabs?.onActivated?.removeListener(update);
    chrome.tabs?.onUpdated?.removeListener(update);
  };
}

export type PostSnapshotReply =
  | { ok: true; tweetId: string; snapshot: import('./models').Snapshot }
  | { ok: false };

/** そのタブの content script にスナップショットを問い合わせる。取れなければ null */
export async function requestSnapshot(p: ActivePost): Promise<Extract<PostSnapshotReply, { ok: true }> | null> {
  try {
    const r = (await chrome.tabs.sendMessage(p.tabId, { type: 'getPostSnapshot', tweetId: p.tweetId })) as PostSnapshotReply | undefined;
    return r?.ok ? r : null;
  } catch {
    return null; // content script が居ない (拡張の更新後にタブを再読み込みしていない等)
  }
}

/** パネルで保存した結果に X 側のブックマークを合わせる依頼 (連動モードがオンのときだけ content 側で実行される) */
export async function requestNativeSync(tabId: number, tweetId: string, want: boolean): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'syncNative', tweetId, want });
  } catch {
    /* 何もしない */
  }
}

/** x.com / twitter.com のタブ (アクティブなものを優先)。host 権限があるので tabs 権限なしで URL 一致の検索ができる */
async function findXTab(): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  return tab?.id ?? null;
}

/** x.com のタブの content script に診断情報を作ってもらう。タブが無い / 応答が無いときは null */
export async function requestDiagnostics(): Promise<string | null> {
  try {
    const id = await findXTab();
    if (id === null) return null;
    const r = (await chrome.tabs.sendMessage(id, { type: 'getDiagnostics' })) as { ok?: boolean; report?: string } | undefined;
    return r?.ok && typeof r.report === 'string' ? r.report : null;
  } catch {
    return null;
  }
}
