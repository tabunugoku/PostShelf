import { injectButtons, installGlobalHandlers } from './popover';

installGlobalHandlers();
injectButtons();
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    injectButtons();
  });
}).observe(document.body, { childList: true, subtree: true });
