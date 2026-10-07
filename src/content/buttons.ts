import { SEL, bookmarkButtonSelector } from '../shared/selectors';
import { t } from '../shared/strings';
import { getBookmark, onDataChanged, listFolders } from '../shared/storage';
import { getSettings, onSettingsChanged, type ButtonMode } from '../shared/settings';
import { extractTweet } from './snapshot';
import { ensureIconCss, openPopover, setPopoverMode } from './popover';
import { isOwnNativeClick } from './native';
import type { Folder } from '../shared/models';

const BTN_ATTR = 'data-postshelf-btn';
const BADGE_ATTR = 'data-postshelf-badge';
const STYLE_ID = 'postshelf-style';
const ACCENT = '#1d9bf0';
/** X の操作アイコンに合わせたクリック判定 (34px 以上) と、標準ボタンとの余白 (4px 以上) */
const HIT = 34;
const GAP = 4;

let mode: ButtonMode = 'separate';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  // hover / キーボードフォーカスは X の操作アイコンと同様、アクセント色の薄い透過の丸背景
  s.textContent = `
[${BTN_ATTR}]:hover,[${BTN_ATTR}]:focus-visible{background:rgba(29,155,240,.1)!important;color:${ACCENT}!important}
[${BTN_ATTR}]:focus-visible{outline:2px solid ${ACCENT};outline-offset:0}`;
  document.head.append(s);
}

/** 保存済みポストの表示色: 最初のフォルダがフォルダアイコン+色ならその色、なければアクセント色 */
function savedColor(folders: Folder[]): string {
  return folders[0]?.color ?? ACCENT;
}

function makeBadge(): HTMLElement {
  const b = document.createElement('span');
  b.setAttribute(BADGE_ATTR, '');
  b.style.cssText = `position:absolute;right:-2px;top:-2px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:7px;background:${ACCENT};color:#fff;font:700 10px/14px system-ui,sans-serif;text-align:center;pointer-events:none;display:none`;
  return b;
}

function createSeparateButton(article: Element): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute(BTN_ATTR, '');
  btn.title = t('openFolders');
  btn.setAttribute('aria-label', t('openFolders'));
  btn.style.cssText = `position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:${HIT}px;height:${HIT}px;margin:0 0 0 ${GAP}px;padding:0;border:0;border-radius:50%;background:transparent;color:#71767b;cursor:pointer;font-size:19px;line-height:1`;
  const icon = document.createElement('i');
  icon.className = 'ti ti-folder-plus';
  icon.setAttribute('aria-hidden', 'true');
  btn.append(icon, makeBadge());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void openPopover(article, btn);
  });
  return btn;
}

function setSaved(host: HTMLElement, folders: Folder[]): void {
  const badge = host.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  const n = folders.length;
  host.toggleAttribute('data-saved', n > 0);
  if (host.hasAttribute(BTN_ATTR)) {
    host.style.color = n > 0 ? savedColor(folders) : '#71767b';
    const label = n > 0 ? t('savedBadgeTitle', n) : t('openFolders');
    host.title = label;
    host.setAttribute('aria-label', label);
    const icon = host.querySelector('i');
    if (icon) icon.className = `ti ${n > 0 ? 'ti-folder-check' : 'ti-folder-plus'}`;
  }
  if (badge) {
    badge.textContent = n > 0 ? String(n) : '';
    badge.style.display = n > 0 ? 'block' : 'none';
    if (n > 0) badge.style.background = savedColor(folders);
  }
}

async function refreshArticle(article: Element): Promise<void> {
  const host = article.querySelector<HTMLElement>(`[${BTN_ATTR}], [${BADGE_ATTR}]`)?.closest<HTMLElement>(
    `[${BTN_ATTR}], ${bookmarkButtonSelector}`,
  );
  const ex = extractTweet(article);
  if (!host || !ex) return;
  const bm = await getBookmark(ex.tweetId);
  const all = await listFolders();
  setSaved(host, (bm?.folderIds ?? []).map((id) => all.find((f) => f.id === id)).filter((f): f is Folder => !!f));
}

export async function refreshAll(): Promise<void> {
  await Promise.all([...document.querySelectorAll(SEL.tweet)].map(refreshArticle));
}

/** 画面上のポストに、現在のモードに応じたボタン/バッジを付ける (何度呼んでも二重にならない) */
export function injectButtons(root: ParentNode = document): void {
  ensureIconCss();
  ensureStyle();
  for (const article of root.querySelectorAll(SEL.tweet)) {
    const bm = article.querySelector<HTMLElement>(bookmarkButtonSelector);
    if (!bm) continue;
    if (mode === 'separate') {
      if (article.querySelector(`[${BTN_ATTR}]`)) continue;
      if (!bm.parentElement) continue;
      const btn = createSeparateButton(article);
      bm.insertAdjacentElement('afterend', btn);
      void refreshArticle(article);
    } else {
      if (bm.querySelector(`[${BADGE_ATTR}]`)) continue;
      // バッジは標準ボタンの上に重ねるだけ (アイコンの形は変えず、クリックは透過)
      if (getComputedStyle(bm).position === 'static') {
        bm.style.position = 'relative';
        bm.setAttribute('data-postshelf-pos', '');
      }
      bm.append(makeBadge());
      void refreshArticle(article);
    }
  }
}

/** 置き換えモード: 標準ブックマークボタンのクリックを capture で横取りして PostShelf のフォルダ選択を開く */
function onCaptureClick(e: MouseEvent): void {
  if (e.shiftKey) return; // Shift+クリックは X 標準の動作
  if (isOwnNativeClick()) return; // 連動モードによる自分自身のプログラム的クリックは素通し (無限ループ防止)
  const target = e.target;
  if (!(target instanceof Element)) return;
  const btn = target.closest<HTMLElement>(bookmarkButtonSelector);
  if (!btn) return;
  const article = btn.closest(SEL.tweet);
  // ポストを特定できないなど、横取りできない状況では何もせず X 標準の動作に任せる
  if (!article || !extractTweet(article)) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  void openPopover(article, btn);
}

function removeSeparate(): void {
  document.querySelectorAll(`[${BTN_ATTR}]`).forEach((b) => b.remove());
}

function removeBadges(): void {
  document.querySelectorAll(`[${BADGE_ATTR}]`).forEach((b) => {
    const host = b.parentElement;
    b.remove();
    if (host?.hasAttribute('data-postshelf-pos')) {
      host.style.position = '';
      host.removeAttribute('data-postshelf-pos');
      host.removeAttribute('data-saved');
    }
  });
}

/** モード切替。リロード不要で、古いモードのボタン/リスナー/バッジを外す */
export function applyButtonMode(next: ButtonMode): void {
  mode = next;
  setPopoverMode(next);
  if (next === 'replace') {
    removeSeparate();
    document.addEventListener('click', onCaptureClick, true); // 同一関数なので重複登録されない
  } else {
    document.removeEventListener('click', onCaptureClick, true);
    removeBadges();
  }
  injectButtons();
}

export function initButtons(): void {
  void getSettings().then((s) => applyButtonMode(s.buttonMode));
  onSettingsChanged((s) => applyButtonMode(s.buttonMode));
  onDataChanged(() => void refreshAll());
  new MutationObserver(scheduleInject).observe(document.body, { childList: true, subtree: true });
}

let scheduled = false;
function scheduleInject(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    injectButtons();
  });
}
