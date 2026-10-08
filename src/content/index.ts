import { initAccount } from './account';
import { initButtons } from './buttons';
import { initHealth } from './health';
import { ensureCollectButton, pathListeners, scheduleCollectRefresh, watchCollectData, watchPath } from './collect';
import { handleCollectCommand, installAutoCollect } from './autocollect';
import { AutoCollectPanel } from './autocollectPanel';
import { installMessageHandler } from './messages';
import { installGlobalHandlers } from './popover';

installGlobalHandlers();
installMessageHandler();
initAccount();
initHealth();
initButtons();
ensureCollectButton();
// ブックマーク一覧 (/i/history) への SPA 遷移を拾って収集ボタンを出し入れする
watchCollectData();
watchPath();
new MutationObserver(() => scheduleCollectRefresh()).observe(document.body, { childList: true, subtree: true });

// ブックマークの自動取り込み (v15)。管理画面の確認ダイアログで同意して始めたときだけ動く (src/content/autocollect.ts)
const autoCollector = installAutoCollect((s) => panel.update(s));
const panel = new AutoCollectPanel(autoCollector, () => void chrome.runtime?.sendMessage?.({ type: 'openManager' }));
pathListeners.add(() => {
  panel.update(autoCollector.state);
  void handleCollectCommand(autoCollector).catch(() => {});
});
