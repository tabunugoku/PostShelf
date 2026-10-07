/**
 * サイドパネル / タブで管理画面を開く操作と、ツールバーアイコンのクリック動作の反映。
 * chrome.sidePanel は Chrome 114 以降。無い環境では何もしない (popup のまま動く)。
 */
import type { ActionMode } from './settings';

export const hasSidePanel = (): boolean => typeof chrome !== 'undefined' && !!chrome.sidePanel?.open;

/** ユーザー操作 (クリック) の中で呼ぶこと。現在のウィンドウのサイドパネルを開く */
export async function openSidePanel(): Promise<void> {
  if (!hasSidePanel()) return;
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
}

export async function openManagerTab(hash = ''): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + hash });
}

/**
 * actionMode をブラウザに反映する。background の起動時 / 設定変更時に呼ぶ。
 * - sidepanel: アイコンのクリックでサイドパネルを開き、popup は外す
 * - popup: 両方を元に戻す
 */
export async function applyActionMode(mode: ActionMode): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) return; // Chrome 113 以下: popup のまま
  const side = mode === 'sidepanel';
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: side });
  await chrome.action.setPopup({ popup: side ? '' : 'popup.html' });
}
