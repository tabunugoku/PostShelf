import { SEL } from '../shared/selectors';
import { t } from '../shared/strings';
import { addCollected } from '../shared/storage';
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

/** /i/bookmarks 上に収集ボタンを出す。ユーザーが押したときだけ取り込む。 */
export function ensureCollectButton(): void {
  const existing = document.querySelector('.postshelf-collect');
  if (!isBookmarksPage()) return existing?.remove();
  if (existing) return;
  const btn = document.createElement('button');
  btn.className = 'postshelf-collect';
  btn.textContent = t('collectTitle');
  btn.addEventListener('click', async () => {
    const n = await addCollected(collectVisible());
    btn.textContent = t('collectDone', n);
    setTimeout(() => (btn.textContent = t('collectTitle')), 3000);
  });
  document.body.append(btn);
}
