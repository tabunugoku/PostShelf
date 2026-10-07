import { SEL, bookmarkButtonSelector } from '../shared/selectors';
import { t } from '../shared/strings';
import { extractTweet } from './snapshot';
import {
  createFolder,
  getBookmark,
  listFolders,
  setBookmarkFolders,
  StorageError,
} from '../shared/storage';
import { displayName, isBuiltinFolder } from '../shared/models';
import { xTheme } from './theme';
import { setNativeBookmark } from './native';
import { getSettings } from '../shared/settings';

const BTN_ATTR = 'data-postshelf-btn';
const POP_CLASS = 'postshelf-popover';

/** ポップオーバーのアイコン用に、同梱の Tabler Icons CSS を 1 度だけ読み込む (拡張内ファイル。外部通信なし) */
function ensureIconCss(): void {
  if (document.getElementById('postshelf-icons')) return;
  const link = document.createElement('link');
  link.id = 'postshelf-icons';
  link.rel = 'stylesheet';
  link.href = chrome.runtime?.getURL?.('icons/tabler-icons.min.css') ?? '';
  if (link.href) document.head.append(link);
}

export function injectButtons(root: ParentNode = document): void {
  for (const article of root.querySelectorAll(SEL.tweet)) {
    if (article.querySelector(`[${BTN_ATTR}]`)) continue;
    const bm = article.querySelector(bookmarkButtonSelector);
    const host = bm?.parentElement;
    if (!bm || !host) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BTN_ATTR, '');
    btn.title = t('openFolders');
    btn.setAttribute('aria-label', t('openFolders'));
    btn.textContent = '▾';
    btn.style.cssText = 'background:none;border:0;cursor:pointer;color:#1d9bf0;font-size:12px;padding:4px';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openPopover(article, btn);
    });
    bm.insertAdjacentElement('afterend', btn);
  }
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
  const folders = (await listFolders()).filter((f) => !isBuiltinFolder(f.id));
  const selected = new Set((await getBookmark(tweetId))?.folderIds ?? []);

  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.setAttribute('role', 'dialog');
  const r = anchor.getBoundingClientRect();
  const th = xTheme();
  pop.style.cssText = `position:fixed;z-index:2147483647;top:${r.bottom + 4}px;left:${Math.max(8, r.left - 100)}px;min-width:240px;max-width:300px;background:${th.bg};color:${th.fg};border:.5px solid ${th.border};border-radius:12px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.12);font:14px/1.4 system-ui,sans-serif`;
  pop.addEventListener('click', (e) => e.stopPropagation());

  const save = async () => {
    const saved = await setBookmarkFolders(tweetId, [...selected], snapshot);
    // 連動モード (設定オンのときだけ): PostShelf の保存有無に X のブックマークを合わせる
    if ((await getSettings()).syncNative) setNativeBookmark(article, saved !== undefined);
  };

  const render = (list: typeof folders) => {
    pop.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = t('noFolders');
      pop.append(empty);
    }
    for (const f of list) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;cursor:pointer';
      label.addEventListener('mouseenter', () => (label.style.background = th.hover));
      label.addEventListener('mouseleave', () => (label.style.background = ''));
      const ico = document.createElement('i');
      ico.className = `ti ${f.icon}`;
      ico.style.cssText = `font-size:18px;color:${f.color ?? th.fg}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(f.id);
      cb.style.cssText = `accent-color:${th.accent};width:16px;height:16px;margin:0`;
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(f.id);
        else selected.delete(f.id);
        void save();
      });
      const name = document.createElement('span');
      name.textContent = displayName(f);
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      label.append(ico, name, cb);
      pop.append(label);
    }
    const row = document.createElement('form');
    row.style.cssText = `display:flex;gap:4px;margin-top:6px;padding-top:6px;border-top:.5px solid ${th.border}`;
    const input = document.createElement('input');
    input.placeholder = t('newFolderPlaceholder');
    input.setAttribute('aria-label', t('newFolder'));
    input.style.cssText = `flex:1;min-width:0;background:transparent;color:${th.fg};border:.5px solid ${th.border};border-radius:8px;padding:4px 8px`;
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = t('add');
    add.style.cssText = `background:${th.accent};color:#fff;border:0;border-radius:8px;padding:4px 10px;cursor:pointer`;
    row.append(input, add);
    row.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const f = await createFolder({ name: input.value });
        selected.add(f.id);
        await save();
        render([...list, f]);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        input.setCustomValidity(err.message);
        input.reportValidity();
      }
    });
    pop.append(row);
  };
  render(folders);
  document.body.append(pop);
  return pop;
}

export function installGlobalHandlers(): void {
  document.addEventListener('click', (e) => {
    if (!(e.target as Element)?.closest?.(`.${POP_CLASS}`)) closePopovers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopovers();
  });
}
