import { bookmarkButtonGeometry, closestFirst, queryAllFirst, queryFirst } from '../shared/selectors';
import { isBroken, subscribeHealth } from './health';
import { t } from '../shared/strings';
import { listBookmarks, onDataChanged, listFolders } from '../shared/storage';
import { getSettings, onSettingsChanged, type ButtonMode } from '../shared/settings';
import { extractTweet } from './snapshot';
import { ensureIconCss, openPopover, setPopoverMode } from './popover';
import { isOwnNativeClick } from './native';
import { getCurrentAccount, subscribeAccount } from './account';
import type { Folder } from '../shared/models';
import { ACCENT, ACCENT_FILL } from '../shared/tokens';

const BTN_ATTR = 'data-postshelf-btn';
const BADGE_ATTR = 'data-postshelf-badge';
const STYLE_ID = 'postshelf-style';
/** X の操作アイコンに合わせたクリック判定 (34px 以上) と、標準ボタンとの余白 (4px 以上) */
const HIT = 34;
const GAP = 4;
const MAX_HIT = 64;
const ICON_MIN = 19;

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
  b.style.cssText = `position:absolute;right:-2px;top:-2px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:7px;background:${ACCENT_FILL};color:#fff;font:700 10px/14px system-ui,sans-serif;text-align:center;pointer-events:none;display:none`;
  return b;
}

/**
 * 別ボタンの縦位置と間隔 (v33)。ポストの詳細ページ (x.com/<user>/status/<id>) の操作の行は、タイムラインと構造が違うことが
 * 実機で報告された (ボタンが他のアイコンより上にあり、ブックマークの数字に詰まる)。実機の DOM は未確認の推測:
 * 親が display:flex; align-items:flex-start で、ブックマークの右に数字の span が続く。
 * align-self:center で親の align-items によらず中心をそろえ、右に要素が続くときは右にも同じ間隔を空ける。
 * 親が flex でないときは align-self は効かないので、縦位置は変わらない。タイムラインと詳細ページで同じ規則。
 */
export function placeSeparateButton(bm: HTMLElement, btn: HTMLElement): void {
  btn.style.alignSelf = 'center';
  if (bm.nextElementSibling) btn.style.marginRight = `${GAP}px`;
  bm.insertAdjacentElement('afterend', btn);
}

/** アイコンの周りに広がる hover の丸の、片側の余白 (X の操作アイコンの丸は、アイコンの周りに約 8px ずつ広がる) */
const RING = 8;

/**
 * 隣のブックマークのボタンの大きさに合わせる (v35、v36 で高さ基準、v37 で丸の探し方を変更)。詳細ページでは、ブックマークのボタン (bm) の中に
 * 数字 (「6,837」など) が入り、幅が桁数で変わる。幅は使わない。bm の高さも、余白を含んで丸より大きいので使わない (v36 の実機で約 2 割大きかった)。
 * 丸の直径 = (1) bm の子孫 (svg の祖先だけでなく、svg の兄弟も) で、svg より大きく、幅と高さの差が 2px 以内で、border-radius が大きい
 * (50% か 999px 以上) 要素の直径。複数あれば、svg と同じ親の中にあるもの、svg の祖先、その他の順に、最初のもの。
 * (2) 無ければ svg の高さ + 16px。svg の高さが測れない (0) ときは HIT。下限 HIT = 34px、上限 64px。
 * アイコンは bm の svg の高さに合わせる (下限 19px)。
 * 実機未確認 (推測): X の hover の丸は、svg の祖先ではなく、svg の兄弟 (絶対配置で、負の余白で svg より大きく広がる、border-radius: 9999px の空の要素)
 * であることが多い、という X の操作アイコンの一般的な構造からの想定。違っていたら、selectors.ts の bookmarkButtonGeometry を直す。
 * margin-left は GAP のまま (丸が大きくなっても、詳細ページの数字に重ならないよう、差の半分を減らさない)。
 */
export function sizeSeparateButton(bm: HTMLElement, btn: HTMLElement): void {
  const { iconHeight: sh, circleDiameter } = bookmarkButtonGeometry(bm);
  const clamp = (v: number) => Math.min(MAX_HIT, Math.max(HIT, Math.round(v)));
  const d = circleDiameter > 0 ? circleDiameter : sh > 0 ? sh + RING * 2 : 0;
  const size = d > 0 ? clamp(d) : HIT;
  btn.style.width = `${size}px`;
  btn.style.height = `${size}px`;
  btn.style.fontSize = `${sh > 0 ? Math.max(ICON_MIN, Math.round(sh)) : ICON_MIN}px`;
}

const sizeButtons = new WeakMap<Element, HTMLElement>();
const sizeBookmarks = new WeakMap<Element, HTMLElement>();
let sizeObserver: ResizeObserver | undefined;
let sizeRemovalObserver: MutationObserver | undefined;

function unwatchSize(bm: Element): void {
  const btn = sizeButtons.get(bm);
  sizeObserver?.unobserve(bm);
  sizeButtons.delete(bm);
  if (btn) sizeBookmarks.delete(btn);
}

/** 外された部分木だけを見る。DOM 内の移動なら監視を続け、ボタンだけ外された場合も解除する。 */
function releaseRemovedSizes(node: Node): void {
  const release = (el: Element) => {
    const bm = sizeButtons.has(el) ? el : sizeBookmarks.get(el);
    const btn = bm && sizeButtons.get(bm);
    if (bm && (!bm.isConnected || !btn?.isConnected)) unwatchSize(bm);
  };
  if (node instanceof Element) release(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.nextNode(); el; el = walker.nextNode()) release(el as Element);
}

/** 共有の ResizeObserver で、挿入時と寸法の変化時だけ測る。監視対象を強参照する一覧は持たない。 */
function watchSize(bm: HTMLElement, btn: HTMLElement): void {
  sizeSeparateButton(bm, btn);
  if (typeof ResizeObserver === 'undefined') return;
  if (!sizeObserver) {
    sizeObserver = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const button = sizeButtons.get(target);
        if (!button) continue;
        if (!target.isConnected || !button.isConnected) unwatchSize(target);
        else sizeSeparateButton(target as HTMLElement, button);
      }
    });
  }
  if (!sizeRemovalObserver) {
    sizeRemovalObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) releaseRemovedSizes(node);
    });
    sizeRemovalObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (sizeButtons.has(bm)) unwatchSize(bm);
  sizeButtons.set(bm, btn);
  sizeBookmarks.set(btn, bm);
  sizeObserver.observe(bm);
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
    if (n > 0) badge.style.background = ACCENT_FILL; // 白文字が載るので固定の濃い青 (フォルダ色だとコントラストが足りないことがある)
  }
}

/** ボタンの表示に使う保存データ。まとめて 1 回だけ読み、記事ごとには読まない (記事ごとに全ポストを読み直さないため) */
interface Shared {
  bookmarks: Map<string, { folderIds: string[] }>;
  folders: Folder[];
}
async function loadShared(): Promise<Shared> {
  const [list, folders] = await Promise.all([listBookmarks(), listFolders()]);
  return { bookmarks: new Map(list.map((b) => [b.tweetId, b])), folders };
}

function refreshArticle(article: Element, data: Shared): void {
  const marker = article.querySelector<HTMLElement>(`[${BTN_ATTR}], [${BADGE_ATTR}]`);
  const host = marker?.closest<HTMLElement>(`[${BTN_ATTR}]`) ?? (marker ? closestFirst<HTMLElement>(marker, 'bookmarkButton')?.el : undefined);
  const ex = extractTweet(article);
  if (!host || !ex) return;
  if (!getCurrentAccount()) return void setSaved(host, []); // アカウント不明: どのアカウントの保存か分からないので「未保存」表示
  const bm = data.bookmarks.get(ex.tweetId);
  setSaved(host, (bm?.folderIds ?? []).map((id) => data.folders.find((f) => f.id === id)).filter((f): f is Folder => !!f));
}

/** 指定の記事の表示を更新する。保存データの読み込みは、全体で 1 回 */
async function refreshArticles(articles: Element[]): Promise<void> {
  if (articles.length === 0) return;
  const data = getCurrentAccount() ? await loadShared() : { bookmarks: new Map(), folders: [] };
  for (const a of articles) refreshArticle(a, data);
}

export async function refreshAll(): Promise<void> {
  await refreshArticles(queryAllFirst(document, 'tweet').els);
}

/** 画面上のポストに、現在のモードに応じたボタン/バッジを付ける (何度呼んでも二重にならない) */
export function injectButtons(root: ParentNode = document): void {
  ensureIconCss();
  ensureStyle();
  if (isBroken()) return; // X の画面構造が変わっているときはボタンを挿入しない
  const fresh: Element[] = [];
  for (const article of queryAllFirst(root, 'tweet').els) {
    const bm = queryFirst<HTMLElement>(article, 'bookmarkButton')?.el;
    if (!bm) continue;
    if (mode === 'separate') {
      if (article.querySelector(`[${BTN_ATTR}]`)) continue;
      if (!bm.parentElement) continue;
      const btn = createSeparateButton(article);
      placeSeparateButton(bm, btn);
      watchSize(bm, btn);
      fresh.push(article);
    } else {
      if (bm.querySelector(`[${BADGE_ATTR}]`)) continue;
      // バッジは標準ボタンの上に重ねるだけ (アイコンの形は変えず、クリックは透過)
      if (getComputedStyle(bm).position === 'static') {
        bm.style.position = 'relative';
        bm.setAttribute('data-postshelf-pos', '');
      }
      bm.append(makeBadge());
      fresh.push(article);
    }
  }
  void refreshArticles(fresh); // 新しく付けた分は、まとめて 1 回の読み込みで表示する
}

/** 置き換えモード: 標準ブックマークボタンのクリックを capture で横取りして PostShelf のフォルダ選択を開く */
function onCaptureClick(e: MouseEvent): void {
  if (e.shiftKey) return; // Shift+クリックは X 標準の動作
  if (isBroken()) return; // 画面構造が変わっているとき (broken) は横取りせず X 標準の動作に任せる
  if (isOwnNativeClick()) return; // 連動モードによる自分自身のプログラム的クリックは素通し (無限ループ防止)
  const target = e.target;
  if (!(target instanceof Element)) return;
  const btn = closestFirst<HTMLElement>(target, 'bookmarkButton')?.el;
  if (!btn) return;
  const article = closestFirst(btn, 'tweet')?.el;
  // ポストを特定できないなど、横取りできない状況では何もせず X 標準の動作に任せる
  if (!article || !extractTweet(article)) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  void openPopover(article, btn);
}

function removeSeparate(): void {
  document.querySelectorAll(`[${BTN_ATTR}]`).forEach((b) => {
    const bm = sizeBookmarks.get(b);
    if (bm) unwatchSize(bm);
    b.remove();
  });
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
  if (isBroken()) {
    // X の画面構造が変わっている: PostShelf の UI を外し、X 標準の動作に一切触れない
    removeSeparate();
    removeBadges();
    document.removeEventListener('click', onCaptureClick, true);
    return;
  }
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
  subscribeHealth(() => applyButtonMode(mode)); // broken になったら UI を外し、戻ったら付け直す
  void getSettings().then((s) => applyButtonMode(s.buttonMode));
  onSettingsChanged((s) => applyButtonMode(s.buttonMode));
  onDataChanged(() => void refreshAll());
  subscribeAccount(() => void refreshAll()); // アカウントが判定できた / 切り替わったら表示を作り直す
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
