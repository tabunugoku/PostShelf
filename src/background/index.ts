import { applyActionMode, openManagerTab } from '../shared/panel';
import { getSettings, onSettingsChanged } from '../shared/settings';
import { afterPostsRemoved, cachePostById } from '../shared/cacheops';
import { AUTO_CAP, FullTextQueue, MANUAL_CAP, cleanupAtStartup, manualItems } from './fulltext';

// 長いポストの全文の取得 (v24)。保存した時点で、たたまれたポストのページを裏のタブで開いて読む (src/background/fulltext.ts)
const fullText = new FullTextQueue();
void cleanupAtStartup().catch(() => {}); // 前回の閉じ忘れのタブを閉じる

// ツールバーアイコンの動作 (popup / サイドパネル) は再起動で失われるので、service worker の起動ごとに反映する
const apply = () => void getSettings().then((s) => applyActionMode(s.actionMode));
apply();
chrome.runtime.onInstalled.addListener(apply);
chrome.runtime.onStartup?.addListener(apply);
onSettingsChanged((s) => void applyActionMode(s.actionMode));

// x.com のポップオーバーからの「サイドパネルで開く」。content script からは直接開けないので、ユーザー操作の直後にここで開く
chrome.runtime.onMessage.addListener((msg, sender) => {
  // 画像のキャッシュ (オフなら何もしない) と、保存から外したポストの画像の掃除
  if (msg?.type === 'cacheImages' && typeof msg.tweetId === 'string' && typeof msg.accountId === 'string') void cachePostById(msg.tweetId, msg.accountId).catch(() => {});
  if (msg?.type === 'pruneCache') void afterPostsRemoved();
  // 全文の取得の依頼 (設定がオフなら、キューが何もしない)。save: 保存した 1 件 / auto: 自動取り込みで取り込んだ分 (最大 30 件) / manual: 設定の「いま取得する」(最大 50 件)
  if (msg?.type === 'fetchFullText' && typeof msg.accountId === 'string') {
    if (typeof msg.tweetId === 'string') void fullText.enqueue([{ accountId: msg.accountId, tweetId: msg.tweetId }], 'save').catch(() => {});
    else if (msg.kind === 'auto' && Array.isArray(msg.ids)) {
      const items = (msg.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, AUTO_CAP).map((tweetId) => ({ accountId: msg.accountId as string, tweetId }));
      void fullText.enqueue(items, 'auto').catch(() => {});
    } else if (msg.kind === 'manual') void manualItems(msg.accountId, MANUAL_CAP).then((items) => fullText.enqueue(items, 'manual')).catch(() => {});
  }
  if (msg?.type === 'stopFullText') void fullText.stop('user').catch(() => {});
  // x.com の「自動で取り込む…」/ 進捗パネルの「管理画面を開く」: 管理画面を開く (開いていればそれを前面に出す)
  if (msg?.type === 'openAutoCollect') void openManagerTab('#autocollect', true);
  if (msg?.type === 'openManager') void openManagerTab('', true);
  if (msg?.type === 'openSidePanel' && sender.tab?.id !== undefined && chrome.sidePanel?.open) {
    void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
