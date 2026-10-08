import { applyActionMode } from '../shared/panel';
import { getSettings, onSettingsChanged } from '../shared/settings';
import { afterPostsRemoved, cachePostById } from '../shared/cacheops';

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
  if (msg?.type === 'openSidePanel' && sender.tab?.id !== undefined && chrome.sidePanel?.open) {
    void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
});
