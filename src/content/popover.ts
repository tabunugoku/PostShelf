import { queryFirst } from '../shared/selectors';
import { jaWrapRule, t, uiLang } from '../shared/strings';
import { extractTweet, tweetIdOf } from './snapshot';
import { getBookmark, listFolders, removeBookmark, setBookmarkFolders } from '../shared/storage';
import { displayName, isBuiltinFolder } from '../shared/models';
import { xTheme } from './theme';
import { createFolderPicker, divider, iconButton } from '../shared/folderPicker';
import { setNativeBookmark } from './native';
import { getSettings, updateRecentFolders, type ButtonMode } from '../shared/settings';
import { getCurrentAccount, subscribeAccount } from './account';
import { requestCache, requestFullText, requestPrune } from '../shared/cacheRequest';

const POP_CLASS = 'postshelf-popover';

let mode: ButtonMode = 'separate';
export const setPopoverMode = (m: ButtonMode): void => {
  mode = m;
};

/** ポップオーバーの日本語の折り返しの規則 (:lang(ja)) を、1 度だけ <style> として入れる */
function ensureWrapStyle(): void {
  if (document.getElementById('postshelf-popover-style')) return;
  const s = document.createElement('style');
  s.id = 'postshelf-popover-style';
  s.textContent = jaWrapRule(`.${POP_CLASS}`);
  document.head.append(s);
}

/** ポップオーバーのアイコン用に、同梱の Tabler Icons CSS を 1 度だけ読み込む (拡張内ファイル。外部通信なし) */
export function ensureIconCss(): void {
  ensureWrapStyle();
  if (document.getElementById('postshelf-icons')) return;
  const link = document.createElement('link');
  link.id = 'postshelf-icons';
  link.rel = 'stylesheet';
  link.href = chrome.runtime?.getURL?.('icons/tabler-icons.min.css') ?? '';
  if (link.href) document.head.append(link);
}

let stopTracking: (() => void) | undefined;

function closePopovers(): void {
  stopTracking?.();
  stopTracking = undefined;
  document.querySelectorAll(`.${POP_CLASS}`).forEach((p) => p.remove());
}

let opening = false;

/** ポップオーバーを開く。保存データを読む間 (await) に、続けて呼ばれても、開くのは同時に 1 つだけ */
export async function openPopover(article: Element, anchor: HTMLElement): Promise<HTMLElement | null> {
  if (opening) return null;
  opening = true;
  const tweetId = tweetIdOf(article);
  try {
    return await buildPopover(article, anchor);
  } catch {
    return openErrorPopover(article, anchor, tweetId);
  } finally {
    opening = false;
  }
}

/** 保存データを読めなかったとき、同じ位置に失敗の表示だけの小さなポップオーバーを出す。閉じ方は通常のものと同じ (installGlobalHandlers) */
function openErrorPopover(article: Element, anchor: HTMLElement, tweetId: string | null): HTMLElement {
  closePopovers();
  const th = xTheme();
  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.setAttribute('role', 'alert');
  pop.lang = uiLang();
  pop.style.cssText = `position:fixed;z-index:2147483647;top:0;left:0;color-scheme:${th.scheme};min-width:240px;max-width:300px;background:${th.bg};color:#f4212e;border:.5px solid ${th.border};border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.12);font:14px/1.4 system-ui,sans-serif;overflow-wrap:anywhere`;
  pop.textContent = t('errorStorage');
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.body.append(pop);
  trackPopover(pop, article, anchor, tweetId);
  return pop;
}

async function buildPopover(article: Element, anchor: HTMLElement): Promise<HTMLElement | null> {
  closePopovers();
  ensureIconCss();
  const ex = extractTweet(article);
  if (!ex) return null;
  const { tweetId, snapshot } = ex;
  const account = getCurrentAccount(); // 保存先は、判定できた現在のアカウントだけ
  const folders = (await listFolders()).filter((f) => !isBuiltinFolder(f.id));
  const existing = await getBookmark(tweetId);
  const selected = new Set(existing?.folderIds ?? []);
  let chosen = new Set(selected); // 直前の保存時の選択。新しく入れたフォルダを「最近使った」へ入れるために比べる
  const recentIds = (await getSettings()).recentFolderIds ?? [];
  let isSaved = !!existing; // 「PostShelf から外す」を出すかどうか

  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.setAttribute('role', 'dialog');
  const th = xTheme();
  pop.style.cssText = `position:fixed;z-index:2147483647;top:0;left:0;color-scheme:${th.scheme};min-width:240px;max-width:300px;background:${th.bg};color:${th.fg};border:.5px solid ${th.border};border-radius:12px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.12);font:14px/1.4 system-ui,sans-serif;text-wrap:pretty`;
  pop.lang = uiLang(); // X のページの lang ではなく UI の言語で折り返す
  pop.style.cssText += ';box-sizing:border-box;display:flex;flex-direction:column';
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
  head.style.flexShrink = '0';
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
    showUnsave(true);
    const added = [...selected].filter((id) => !chosen.has(id));
    chosen = new Set(selected);
    if (account) requestCache(tweetId, account.id); // キャッシュがオンなら、background が画像を取得して保存する
    if (account && snapshot.truncated) requestFullText(tweetId, account.id); // たたまれた状態で保存したとき: 設定がオンなら、background が全文を取る (v24)
    // 連動モード (設定オンのときだけ): PostShelf の保存有無に X のブックマークを合わせる
    try {
      if ((await getSettings()).syncNative) setNativeBookmark(article, true);
    } catch {
      /* 設定を読めなくても、保存は成功している。X 側の同期だけ飛ばす */
    }
    // 「最近使った」は最後に。失敗しても、保存の流れは止めない (保存はもう成功している)
    if (added.length) void updateRecentFolders(added).catch(() => {});
  };
  // 保存の削除は、明示的な操作だけ (保存済みのときだけ表示。確認は出さない)。アイコンだけのボタンで、下部の 1 行の右端に置く
  const unsave = iconButton(th, t('removeFromPostShelf'), 'ti-trash', 'danger');
  const showUnsave = (on: boolean) => {
    unsave.style.display = on ? 'flex' : 'none';
  };
  showUnsave(isSaved);
  unsave.addEventListener('click', async () => {
    if (getCurrentAccount()?.id !== account?.id) return closePopovers(); // 開いたあとにアカウントが切り替わった: 新しいアカウントの保存を消さない
    try {
      await removeBookmark(tweetId);
      isSaved = false;
      selected.clear();
      chosen = new Set();
      picker.sync();
      showUnsave(false);
      requestPrune();
      if ((await getSettings()).syncNative) setNativeBookmark(article, false);
      closePopovers();
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
    extras: { recentIds },
  });
  if (account) pop.append(picker.el);
  const footer = document.createElement('div');
  footer.dataset.popoverFooter = '';
  footer.style.flexShrink = '0';
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
    footer.append(rel);
  }
  // 下部の 1 行: 左端にサイドパネル、右端に削除 (どちらもアイコンだけ)。content script からは直接開けないので、background へ依頼する
  const side = iconButton(th, t('openSidePanel'), 'ti-layout-sidebar-right');
  side.addEventListener('click', () => {
    void chrome.runtime?.sendMessage?.({ type: 'openSidePanel' });
    closePopovers();
  });
  const bottom = document.createElement('div');
  bottom.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;justify-content:space-between';
  bottom.append(side);
  if (account) bottom.append(unsave);
  footer.prepend(bottom);
  bottom.before(divider(th));
  // 追加、区切り、操作行、置き換えモードの解除、失敗表示の順で固定する。
  if (account && picker.addButton) footer.prepend(picker.addButton);
  footer.append(errorEl);
  pop.append(footer);
  document.body.append(pop);
  trackPopover(pop, article, anchor, tweetId);
  picker.focusFilter();
  return pop;
}

/** 開いたときに決めた表示側と高さの上限 */
interface Placement {
  side: 'below' | 'above' | 'center';
  maxHeight: number;
  naturalHeight: number;
}

/** ボタンと画面の余白の間で、その表示側に使える高さ */
function availableHeight(side: Placement['side'], r: DOMRect, viewportHeight: number): number {
  if (side === 'below') return viewportHeight - r.bottom - 4 - 8;
  if (side === 'above') return r.top - 4 - 8;
  return viewportHeight - 16;
}

/** 上部・下部の実寸と余白を測り、一覧 4 行を含む最低限の高さを求める */
function minimumHeight(pop: HTMLElement): number {
  const style = getComputedStyle(pop);
  const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const;
  let height = frame.reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
  for (const element of pop.querySelectorAll<HTMLElement>(
    '.postshelf-account, [data-picker-header], [data-popover-footer]',
  )) {
    const style = getComputedStyle(element);
    height += element.offsetHeight + (Number.parseFloat(style.marginTop) || 0)
      + (Number.parseFloat(style.marginBottom) || 0);
  }
  return height + 4 * 32;
}

/** 初回の表示側を保ち、ボタンから 4px の位置で空きに合わせて高さを変える */
function position(pop: HTMLElement, r: DOMRect, placement?: Placement): Placement {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  if (!placement) {
    // 制約前の高さを使う。一覧が長くても、選んだ側は開いている間に入れ替えない。
    pop.style.maxHeight = 'none';
    const naturalHeight = pop.offsetHeight;
    const below = availableHeight('below', r, vh);
    const above = availableHeight('above', r, vh);
    let side: Placement['side'];
    if (naturalHeight <= below) side = 'below';
    else if (naturalHeight <= above) side = 'above';
    else if (Math.max(below, above) < minimumHeight(pop)) side = 'center';
    else side = below >= above ? 'below' : 'above';
    let available = vh - 16;
    if (side === 'below') available = below;
    else if (side === 'above') available = above;
    placement = { side, maxHeight: Math.max(0, available), naturalHeight };
  }
  pop.style.boxSizing = 'border-box';
  const available = availableHeight(placement.side, r, vh);
  pop.style.maxHeight = `${Math.max(0, Math.min(placement.maxHeight, available))}px`;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const centered = placement.side === 'center';
  const desiredLeft = centered ? (vw - w) / 2 : r.left + r.width / 2 - w / 2;
  const left = Math.min(Math.max(8, desiredLeft), Math.max(8, vw - w - 8));
  let desiredTop = r.bottom + 4;
  if (centered) desiredTop = (vh - h) / 2;
  else if (placement.side === 'above') desiredTop = r.top - 4 - h;
  pop.style.left = `${left}px`;
  pop.style.top = `${desiredTop}px`;
  return placement;
}

/** 開いている間だけ位置を追従し、元の投稿を追えなくなったら共通の処理で閉じる */
function trackPopover(pop: HTMLElement, article: Element, anchor: HTMLElement, tweetId: string | null): void {
  const placement = position(pop, anchor.getBoundingClientRect());
  let pendingFrame: number | null = null;
  const update = () => {
    pendingFrame = null;
    const r = anchor.getBoundingClientRect();
    const vh = document.documentElement.clientHeight || window.innerHeight;
    // X が投稿の要素を別の投稿に再利用する可能性は、実機未確認の推測。
    if (
      !anchor.isConnected
      || !article.contains(anchor)
      || tweetIdOf(article) !== tweetId
      || r.bottom < 0
      || r.top > vh
    ) {
      closePopovers();
      return;
    }
    if (placement.side !== 'center') {
      const threshold = Math.min(minimumHeight(pop), placement.naturalHeight);
      if (availableHeight(placement.side, r, vh) < threshold) {
        closePopovers();
        return;
      }
      position(pop, r, placement);
    }
  };
  const schedule = () => {
    if (pendingFrame === null) pendingFrame = window.requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  stopTracking = () => {
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
  };
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
