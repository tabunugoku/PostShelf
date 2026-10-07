import { ensureCollectButton } from './collect';
import { injectButtons, installGlobalHandlers } from './popover';

installGlobalHandlers();
injectButtons();
ensureCollectButton();
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    injectButtons();
    ensureCollectButton();
  });
}).observe(document.body, { childList: true, subtree: true });
