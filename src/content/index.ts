import { initButtons } from './buttons';
import { initHealth } from './health';
import { ensureCollectButton, scheduleCollectRefresh, watchCollectData } from './collect';
import { installMessageHandler } from './messages';
import { installGlobalHandlers } from './popover';

installGlobalHandlers();
installMessageHandler();
initHealth();
initButtons();
ensureCollectButton();
// /i/bookmarks への SPA 遷移を拾って収集ボタンを出し入れする
watchCollectData();
new MutationObserver(() => scheduleCollectRefresh()).observe(document.body, { childList: true, subtree: true });
