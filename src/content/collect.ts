import { isBookmarksPath, queryAllFirst } from '../shared/selectors';
import { t } from '../shared/strings';
import { addCollected, getSavedIds, onDataChanged } from '../shared/storage';
import { getSettings, onSettingsChanged, recordPending } from '../shared/settings';
import { xTheme } from './theme';
import { getCurrentAccount, subscribeAccount } from './account';
import { extractTweet, type Extracted } from './snapshot';

export const isBookmarksPage = (path = location.pathname) => isBookmarksPath(path);

/** 今画面に表示されているポストだけを読む (自動スクロール・API 呼び出しはしない) */
export function collectVisible(root: ParentNode = document): Extracted[] {
  const seen = new Map<string, Extracted>();
  for (const a of queryAllFirst(root, 'tweet').els) {
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

/** 保存済みの ID は、短い時間 (SAVED_TTL_MS) だけ使い回す。スクロールのたびに全ポストを読み直さない。データの変更・アカウントの切り替えで捨てる */
export const SAVED_TTL_MS = 300;
let savedCache: { account: string; at: number; ids: Set<string> } | null = null;
export const dropSavedCache = (): void => void (savedCache = null);
async function cachedSavedIds(account: string): Promise<Set<string>> {
  const now = Date.now();
  if (savedCache && savedCache.account === account && now - savedCache.at < SAVED_TTL_MS) return savedCache.ids;
  const ids = await getSavedIds();
  savedCache = { account, at: Date.now(), ids };
  return ids;
}

/** ボタンの表示を「未取り込み N 件」/「すべて取り込み済み」に更新する */
export async function refreshCollectButton(): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>('.postshelf-collect');
  if (!btn || flashing) return;
  const account = getCurrentAccount();
  if (!account) {
    // アカウントを判定できないときは、どのアカウントのデータか分からないので取り込まない
    btn.textContent = t('collectNoAccount');
    btn.dataset.pending = '0';
    btn.disabled = true;
    btn.style.opacity = '.7';
    btn.style.cursor = 'default';
    btn.title = t('accountUnknown');
    return;
  }
  const n = unsavedItems(collectVisible(), await cachedSavedIds(account.id)).length;
  void recordPending(account.id, n); // manager の取り込み案内バナー用に最後に観測した件数を残す (アカウントごと)
  btn.textContent = n > 0 ? t('collectPending', n) : t('collectAllDone');
  btn.dataset.pending = String(n);
  btn.disabled = n === 0;
  btn.style.opacity = n === 0 ? '.7' : '1';
  btn.style.cursor = n === 0 ? 'default' : 'pointer';
  btn.title = t('collectTitle');
}

/** ブックマーク一覧 (/i/history など。判定は selectors.ts) 上に収集ボタンを出す。ユーザーが押したときだけ取り込む。 */
export function ensureCollectButton(): void {
  const existing = document.querySelector('.postshelf-collect');
  if (!isBookmarksPage()) {
    document.querySelector('.postshelf-autocollect')?.remove();
    return existing?.remove();
  }
  if (existing) return;
  const btn = document.createElement('button');
  btn.className = 'postshelf-collect';
  btn.type = 'button';
  btn.textContent = t('collectTitle');
  // 画面右下に固定。配色は X のテーマ (ライト/ダーク/ダーク青) に合わせる
  const th = xTheme();
  btn.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:2147483646;min-height:36px;padding:6px 14px;border-radius:18px;border:.5px solid ${th.border};background:${th.bg};color:${th.fg};color-scheme:${th.scheme};font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer`;
  btn.addEventListener('click', async () => {
    if (!getCurrentAccount()) return; // アカウント不明のときは何もしない (ボタンも無効)
    const n = await addCollected(collectVisible()); // 取り込み済みは重複させない
    dropSavedCache();
    flashing = true;
    btn.textContent = t('collectDone', n);
    setTimeout(() => {
      flashing = false;
      void refreshCollectButton();
    }, 3000);
  });
  document.body.append(btn);
  // 「いま見えている分だけ取り込む」(上のボタン) と「自動で取り込む…」の 2 つの選択。後者は、管理画面の確認ダイアログで同意したときだけ動く
  document.querySelector('.postshelf-autocollect')?.remove();
  const auto = document.createElement('button');
  auto.className = 'postshelf-autocollect';
  auto.type = 'button';
  auto.textContent = t('acBtnAuto');
  auto.title = t('acBtnAutoTitle');
  auto.style.cssText = `position:fixed;right:16px;bottom:60px;z-index:2147483646;min-height:36px;padding:6px 14px;border-radius:18px;border:.5px solid ${th.border};background:${th.bg};color:${th.fg};color-scheme:${th.scheme};font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;display:none`;
  auto.addEventListener('click', () => void chrome.runtime?.sendMessage?.({ type: 'openAutoCollect' }));
  document.body.append(auto);
  void refreshCollectButton();
  void refreshAutoButton();
}

/** 設定「自動取り込みを使う」がオフなら、開始のボタンを出さない */
export async function refreshAutoButton(): Promise<void> {
  const auto = document.querySelector<HTMLElement>('.postshelf-autocollect');
  if (!auto) return;
  const on = (await getSettings()).autoCollect.enabled && !!getCurrentAccount();
  auto.style.display = on ? '' : 'none';
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** DOM の変化 (スクロールで増えたポスト) に合わせて件数を更新する。連続変化は 300ms にまとめる */
export function scheduleCollectRefresh(): void {
  ensureCollectButton();
  clearTimeout(timer);
  timer = setTimeout(() => void refreshCollectButton(), 300);
}

export const watchCollectData = (): (() => void) => {
  const offs = [
    onDataChanged(() => {
      dropSavedCache();
      void refreshCollectButton();
    }),
    subscribeAccount(() => {
      dropSavedCache();
      void refreshCollectButton();
      void refreshAutoButton();
    }),
    onSettingsChanged(() => void refreshAutoButton()),
  ];
  return () => offs.forEach((o) => o());
};

/**
 * SPA 遷移 (pushState) で URL だけが変わり DOM の変化が少ない場合でも、ボタンを出し入れできるようにパスの変化を見張る。
 * content script は isolated world なので history.pushState を差し替えられない。軽い比較 (500ms ごと) と popstate で拾う。
 */
/** パスが変わったときに呼ばれる (自動取り込みが、ブックマークのタブに移ったあとで待っているコマンドを拾うのに使う) */
export const pathListeners = new Set<() => void>();

export function watchPath(intervalMs = 500): () => void {
  let last = location.pathname;
  const check = () => {
    if (location.pathname === last) return;
    last = location.pathname;
    ensureCollectButton();
    scheduleCollectRefresh();
    pathListeners.forEach((l) => l());
  };
  const id = setInterval(check, intervalMs);
  window.addEventListener('popstate', check);
  return () => {
    clearInterval(id);
    window.removeEventListener('popstate', check);
  };
}
