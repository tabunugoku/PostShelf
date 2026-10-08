import { queryFirst } from '../shared/selectors';
import { t } from '../shared/strings';
import { extractTweet } from './snapshot';
import { getBookmark, listFolders, removeBookmark, setBookmarkFolders } from '../shared/storage';
import { displayName, isBuiltinFolder } from '../shared/models';
import { xTheme } from './theme';
import { createFolderPicker } from '../shared/folderPicker';
import { setNativeBookmark } from './native';
import { getSettings, type ButtonMode } from '../shared/settings';
import { getCurrentAccount, subscribeAccount } from './account';
import { requestCache, requestPrune } from '../shared/cacheRequest';

const POP_CLASS = 'postshelf-popover';

let mode: ButtonMode = 'separate';
export const setPopoverMode = (m: ButtonMode): void => {
  mode = m;
};

/** ポップオーバーのアイコン用に、同梱の Tabler Icons CSS を 1 度だけ読み込む (拡張内ファイル。外部通信なし) */
export function ensureIconCss(): void {
  if (document.getElementById('postshelf-icons')) return;
  const link = document.createElement('link');
  link.id = 'postshelf-icons';
  link.rel = 'stylesheet';
  link.href = chrome.runtime?.getURL?.('icons/tabler-icons.min.css') ?? '';
  if (link.href) document.head.append(link);
}

function closePopovers(): void {
  document.querySelectorAll(`.${POP_CLASS}`).forEach((p) => p.remove());
}

export async function openPopover(article: Element, anchor: HTMLElement): Promise<HTMLElement | null> {
  closePopovers();
  ensureIconCss();
  const ex = extractTweet(article);
  if (!ex) return null;
  const { tweetId, snapshot } = ex;
  const account = getCurrentAccount(); // 保存先は、判定できた現在のアカウントだけ
  const folders = (await listFolders()).filter((f) => !isBuiltinFolder(f.id));
  const existing = await getBookmark(tweetId);
  const selected = new Set(existing?.folderIds ?? []);
  let isSaved = !!existing; // 「PostShelf から外す」を出すかどうか

  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.setAttribute('role', 'dialog');
  const th = xTheme();
  pop.style.cssText = `position:fixed;z-index:2147483647;top:0;left:0;color-scheme:${th.scheme};min-width:240px;max-width:300px;background:${th.bg};color:${th.fg};border:.5px solid ${th.border};border-radius:12px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.12);font:14px/1.4 system-ui,sans-serif`;
  pop.addEventListener('click', (e) => e.stopPropagation());

  // 保存先の表示 (アバター小 + @ハンドル)。判定できないときは警告だけを出して保存させない
  const head = document.createElement('div');
  head.className = 'postshelf-account';
  head.style.cssText = `display:flex;gap:6px;align-items:center;padding:2px 8px 8px;margin-bottom:6px;border-bottom:.5px solid ${th.border};font-size:14px;overflow-wrap:anywhere`;
  if (account) {
    if (account.avatar) {
      const img = document.createElement('img');
      img.src = account.avatar;
      img.alt = '';
      img.style.cssText = 'width:20px;height:20px;border-radius:50%;flex:none;object-fit:cover';
      head.append(img);
    }
    const label = document.createElement('span');
    label.textContent = t('saveTo', `@${account.handle}`);
    head.append(label);
  } else {
    head.setAttribute('role', 'alert');
    head.textContent = t('accountUnknown');
  }
  pop.append(head);

  // 保存に失敗したときは、ポップオーバーの中に理由を出す (console だけで終わらせない)
  const errorEl = document.createElement('div');
  errorEl.className = 'postshelf-save-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.style.cssText = 'display:none;padding:6px 8px;margin-top:6px;color:#f4212e;font-size:13px;overflow-wrap:anywhere';
  const save = async () => {
    try {
      await saveNow();
      errorEl.style.display = 'none';
    } catch {
      errorEl.textContent = t('errorStorage');
      errorEl.style.display = 'block';
    }
  };
  const saveNow = async () => {
    if (getCurrentAccount()?.id !== account?.id) return closePopovers(); // 開いている間にアカウントが切り替わった
    await setBookmarkFolders(tweetId, [...selected], snapshot); // 「未分類」だけでも保存する (保存の解除は「PostShelf から外す」だけ)
    isSaved = true;
    unsave.style.display = 'block';
    if (account) requestCache(tweetId, account.id); // キャッシュがオンなら、background が画像を取得して保存する
    // 連動モード (設定オンのときだけ): PostShelf の保存有無に X のブックマークを合わせる
    if ((await getSettings()).syncNative) setNativeBookmark(article, true);
  };
  // 保存の解除は、明示的な操作だけ (保存済みのときだけ表示)
  const unsave = document.createElement('button');
  unsave.type = 'button';
  unsave.textContent = t('removeFromPostShelf');
  unsave.style.cssText = `display:${isSaved ? 'block' : 'none'};width:100%;text-align:left;margin-top:6px;padding:6px 8px;min-height:32px;background:transparent;color:${th.fg};border:.5px solid ${th.border};border-radius:8px;cursor:pointer`;
  unsave.addEventListener('click', async () => {
    try {
      await removeBookmark(tweetId);
      isSaved = false;
      selected.clear();
      picker.sync();
      unsave.style.display = 'none';
      requestPrune();
      if ((await getSettings()).syncNative) setNativeBookmark(article, false);
      errorEl.style.display = 'none';
    } catch {
      errorEl.textContent = t('errorStorage');
      errorEl.style.display = 'block';
    }
  });

  const picker = createFolderPicker({
    folders,
    selected,
    theme: th,
    onChange: () => save(),
  });
  if (account) pop.append(picker.el);
  pop.append(errorEl);
  if (account) pop.append(unsave);
  // 置き換えモードで X 側がブックマーク済みのとき: X のブックマークだけを解除する手段 (Shift+クリックでも可)
  if (account && mode === 'replace' && queryFirst(article, 'removeBookmark')) {
    const rel = document.createElement('button');
    rel.type = 'button';
    rel.textContent = t('releaseNative');
    rel.style.cssText = `display:block;width:100%;text-align:left;margin-top:6px;padding:6px 8px;background:transparent;color:${th.fg};border:.5px solid ${th.border};border-radius:8px;cursor:pointer`;
    rel.addEventListener('click', () => {
      setNativeBookmark(article, false);
      rel.remove();
    });
    pop.append(rel);
  }
  // サイドパネルで開く (content script からは直接開けないので background へ依頼する。ユーザーのクリック直後に送る)
  const side = document.createElement('button');
  side.type = 'button';
  side.textContent = t('openSidePanel');
  side.style.cssText = `display:block;width:100%;text-align:left;margin-top:6px;padding:6px 8px;min-height:32px;background:transparent;color:${th.fg};border:0;border-radius:8px;cursor:pointer`;
  side.addEventListener('click', () => {
    void chrome.runtime?.sendMessage?.({ type: 'openSidePanel' });
    closePopovers();
  });
  pop.append(side);
  document.body.append(pop);
  position(pop, anchor);
  return pop;
}

/** ボタンの真下に出し、画面端ではみ出さないよう補正する (下に収まらなければ上に出す) */
function position(pop: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), Math.max(8, vw - w - 8));
  let top = r.bottom + 4;
  if (h && top + h > vh - 8 && r.top - 4 - h >= 8) top = r.top - 4 - h;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

export function installGlobalHandlers(): void {
  subscribeAccount(() => closePopovers()); // アカウントが切り替わったら閉じる (開き直すと新しいアカウントで開く)
  document.addEventListener('click', (e) => {
    if (!(e.target as Element)?.closest?.(`.${POP_CLASS}`)) closePopovers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopovers();
  });
}
