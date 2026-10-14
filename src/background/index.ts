import { applyActionMode, openManagerTab } from '../shared/panel';
import { getSettings, onSettingsChanged } from '../shared/settings';
import { afterPostsRemoved, cachePostById } from '../shared/cacheops';
import { AUTO_CAP, FullTextQueue, MANUAL_CAP, cleanupAtStartup, cleanupLegacyTabs, manualItems } from './fulltext';

// 長いポストの全文の取得 (v24)。保存した時点で、たたまれたポストのページを裏のタブで開いて読む (src/background/fulltext.ts)
const fullText = new FullTextQueue();
// 前回の閉じ忘れのタブを閉じる。終わる前に新しい取得が始まると、古い running の記録の更新が新しい状態を上書きするので、
// 取得・停止の依頼はこの完了を待ってから処理する (失敗しても受け付けは止めない)
const startupCleanup = cleanupAtStartup().catch(() => {});

// ツールバーアイコンの動作 (popup / サイドパネル) は再起動で失われるので、service worker の起動ごとに反映する
const apply = () => void getSettings().then((s) => applyActionMode(s.actionMode)).catch(() => {});
apply();
chrome.runtime.onInstalled.addListener(apply);
// 旧版の裏のタブの記録は、更新のときだけ片付ける (service worker が起きるたびには書き込まない)
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update') void cleanupLegacyTabs().catch(() => {});
});
chrome.runtime.onStartup?.addListener(apply);
onSettingsChanged((s) => void applyActionMode(s.actionMode));

/** 全文の取得の依頼 (設定がオフなら、キューが何もしない)。save: 保存した 1 件 / auto: 自動取り込みで取り込んだ分 (最大 30 件) / manual: 設定の「いま取得する」(最大 50 件) */
function requestFullText(
  accountId: string,
  msg: { tweetId?: unknown; kind?: unknown; ids?: unknown; scan?: unknown },
): void {
  if (typeof msg.tweetId === 'string') {
    void fullText.enqueue([{ accountId, tweetId: msg.tweetId }], 'save').catch(() => {});
  } else if (msg.kind === 'auto' && Array.isArray(msg.ids)) {
    const ids = (msg.ids as unknown[]).filter((x): x is string => typeof x === 'string');
    // scan: 引き継いだ取り込み。ID が足りないので、保存してある truncated のポスト (手動と同じ関数) から作り足す
    const build = msg.scan === true
      ? manualItems(accountId, AUTO_CAP).then((stored) => [...new Set([...ids, ...stored.map((i) => i.tweetId)])])
      : Promise.resolve(ids);
    void build
      .then((all) => fullText.enqueue(all.slice(0, AUTO_CAP).map((tweetId) => ({ accountId, tweetId })), 'auto'))
      .catch(() => {});
  } else if (msg.kind === 'manual') {
    void manualItems(accountId, MANUAL_CAP).then((items) => fullText.enqueue(items, 'manual')).catch(() => {});
  }
}

// x.com のポップオーバーからの「サイドパネルで開く」。content script からは直接開けないので、ユーザー操作の直後にここで開く
chrome.runtime.onMessage.addListener((msg, sender) => {
  // 画像のキャッシュ (オフなら何もしない) と、保存から外したポストの画像の掃除
  if (msg?.type === 'cacheImages' && typeof msg.tweetId === 'string' && typeof msg.accountId === 'string') void cachePostById(msg.tweetId, msg.accountId).catch(() => {});
  if (msg?.type === 'pruneCache') void afterPostsRemoved().catch(() => {});
  if (msg?.type === 'fetchFullText' && typeof msg.accountId === 'string') {
    void startupCleanup.then(() => requestFullText(msg.accountId, msg));
  }
  if (msg?.type === 'stopFullText') void startupCleanup.then(() => fullText.stop('user')).catch(() => {});
  // x.com の「自動で取り込む…」/ 進捗パネルの「管理画面を開く」: 管理画面を開く (開いていればそれを前面に出す)
  if (msg?.type === 'openAutoCollect') void openManagerTab('#autocollect', true);
  if (msg?.type === 'openManager') void openManagerTab(msg.hash === '#triage' ? '#triage' : '', true); // 開く先は、決まったものだけ (仕分けモード)
  if (msg?.type === 'openSidePanel' && sender.tab?.id !== undefined && chrome.sidePanel?.open) {
    void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
