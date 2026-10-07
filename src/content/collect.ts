import { SEL } from '../shared/selectors';
import { t } from '../shared/strings';
import { addCollected, getSavedIds, onDataChanged } from '../shared/storage';
import { xTheme } from './theme';
import { extractTweet, type Extracted } from './snapshot';

export const isBookmarksPage = (path = location.pathname) => path === '/i/bookmarks';

/** 今画面に表示されているポストだけを読む (自動スクロール・API 呼び出しはしない) */
export function collectVisible(root: ParentNode = document): Extracted[] {
  const seen = new Map<string, Extracted>();
  for (const a of root.querySelectorAll(SEL.tweet)) {
    const ex = extractTweet(a);
    if (ex) seen.set(ex.tweetId, ex);
  }
  return [...seen.values()];
}

/** 画面に出ているポストのうち、PostShelf に未保存のもの (どのフォルダにも入っていない = 保存済みに含まれない) */
export function unsavedItems(visible: Extracted[], savedIds: Set<string>): Extracted[] {
  return visible.filter((x) => !savedIds.has(x.tweetId));
}

let flashing = false; // 取り込み完了メッセージの表示中は件数表示で上書きしない

/** ボタンの表示を「未取り込み N 件」/「すべて取り込み済み」に更新する */
export async function refreshCollectButton(): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>('.postshelf-collect');
  if (!btn || flashing) return;
  const n = unsavedItems(collectVisible(), await getSavedIds()).length;
  btn.textContent = n > 0 ? t('collectPending', n) : t('collectAllDone');
  btn.dataset.pending = String(n);
  btn.disabled = n === 0;
  btn.style.opacity = n === 0 ? '.7' : '1';
  btn.style.cursor = n === 0 ? 'default' : 'pointer';
  btn.title = t('collectTitle');
}

/** /i/bookmarks 上に収集ボタンを出す。ユーザーが押したときだけ取り込む。 */
export function ensureCollectButton(): void {
  const existing = document.querySelector('.postshelf-collect');
  if (!isBookmarksPage()) return existing?.remove();
  if (existing) return;
  const btn = document.createElement('button');
  btn.className = 'postshelf-collect';
  btn.type = 'button';
  btn.textContent = t('collectTitle');
  // 画面右下に固定。配色は X のテーマ (ライト/ダーク/ダーク青) に合わせる
  const th = xTheme();
  btn.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:2147483646;min-height:36px;padding:6px 14px;border-radius:18px;border:.5px solid ${th.border};background:${th.bg};color:${th.fg};color-scheme:${th.scheme};font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer`;
  btn.addEventListener('click', async () => {
    const n = await addCollected(collectVisible()); // 取り込み済みは重複させない
    flashing = true;
    btn.textContent = t('collectDone', n);
    setTimeout(() => {
      flashing = false;
      void refreshCollectButton();
    }, 3000);
  });
  document.body.append(btn);
  void refreshCollectButton();
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** DOM の変化 (スクロールで増えたポスト) に合わせて件数を更新する。連続変化は 300ms にまとめる */
export function scheduleCollectRefresh(): void {
  ensureCollectButton();
  clearTimeout(timer);
  timer = setTimeout(() => void refreshCollectButton(), 300);
}

export const watchCollectData = (): (() => void) => onDataChanged(() => void refreshCollectButton());
