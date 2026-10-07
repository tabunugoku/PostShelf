import { initButtons } from './buttons';
import { ensureCollectButton } from './collect';
import { installGlobalHandlers } from './popover';

installGlobalHandlers();
initButtons();
ensureCollectButton();
// /i/bookmarks への SPA 遷移を拾って収集ボタンを出し入れする
new MutationObserver(() => ensureCollectButton()).observe(document.body, { childList: true, subtree: true });
