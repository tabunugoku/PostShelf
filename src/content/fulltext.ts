/**
 * 長いポストの全文の更新 (v24)。ユーザーが自分でポストの個別ページ (/ユーザー/status/ID) を開いているとき、
 * 主役のポストが全文で表示されていて、そのポストが保存済みで truncated が真なら、静かに全文へ更新する (キューを待たない)。
 * 読むのは、いま見ている画面の DOM だけ。保存されていないポストは保存しない。
 */
import { refreshFullText } from '../shared/storage';
import { getCurrentAccount } from './account';
import { findArticle } from './messages';
import { extractTweet } from './snapshot';

const STATUS_PATH = /^\/[^/]+\/status\/(\d+)/;
const checked = new Set<string>();

/** いまのページが個別ページで、主役のポストが全文なら、保存済みの分を更新する。更新したら true */
export async function updateFromStatusPage(): Promise<boolean> {
  const id = location.pathname.match(STATUS_PATH)?.[1];
  const account = getCurrentAccount();
  if (!id || !account || checked.has(`${account.id}:${id}`)) return false;
  const article = findArticle(id);
  const ex = article ? extractTweet(article) : null;
  if (!ex || ex.snapshot.truncated || !ex.snapshot.text) return false; // まだ読み込み中、または、このページでもたたまれている
  checked.add(`${account.id}:${id}`);
  return refreshFullText(account.id, id, { text: ex.snapshot.text, segments: ex.snapshot.segments, ...(ex.snapshot.translated ? { translated: true } : {}) }).catch(() => false);
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** ページの変化 (SPA の遷移、ポストの読み込み) のあとに、少し待って確かめる */
export function installFullTextWatcher(): void {
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void updateFromStatusPage(), 1200);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
