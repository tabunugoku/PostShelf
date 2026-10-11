/**
 * 長いポストの全文の更新 (v24)。ユーザーが自分でポストの個別ページ (/ユーザー/status/ID) を開いているとき、
 * 主役のポストが全文で表示されていて、そのポストが保存済みで truncated が真なら、静かに全文へ更新する (キューを待たない)。
 * あわせて、保存済みの主役のポストの欠けた項目 (アイコンなど) も補う (全文かどうかに関係なく)。
 * 読むのは、いま見ている画面の DOM だけ。保存されていないポストは保存しない。
 */
import { fillMissing, refreshFullText } from '../shared/storage';
import { getCurrentAccount } from './account';
import { findArticle } from './messages';
import { extractTweet, fillSource, hasPending, type Extracted } from './snapshot';

const STATUS_PATH = /^\/[^/]+\/status\/(\d+)/;
const checked = new Set<string>();
const filled = new Set<string>();

/** 主役のポストが保存済みなら、欠けた項目 (アイコンなど) を補う。全文の更新とは別に行う。読み込み途中の項目があるうちは、確認済みにしない */
async function fillFromPage(accountId: string, ex: Extracted): Promise<void> {
  const key = `${accountId}:${ex.tweetId}`;
  if (filled.has(key)) return;
  await fillMissing([{ tweetId: ex.tweetId, snapshot: fillSource(ex) }], accountId).catch(() => 0);
  if (!hasPending(ex)) filled.add(key);
}

/** いまのページが個別ページで、主役のポストが全文なら、保存済みの分を更新する。更新したら true */
export async function updateFromStatusPage(): Promise<boolean> {
  const id = location.pathname.match(STATUS_PATH)?.[1];
  const account = getCurrentAccount();
  if (!id || !account) return false;
  const key = `${account.id}:${id}`;
  if (checked.has(key) && filled.has(key)) return false;
  const article = findArticle(id);
  const ex = article ? extractTweet(article) : null;
  if (ex) await fillFromPage(account.id, ex);
  if (checked.has(key)) return false;
  if (!ex || ex.snapshot.truncated || !ex.snapshot.text) return false; // まだ読み込み中、または、このページでもたたまれている
  checked.add(key);
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
