import { SEL, bookmarkButtonSelector } from '../shared/selectors';
import { UI } from '../shared/strings';
import { extractTweet } from './snapshot';
import {
  createFolder,
  getBookmark,
  listFolders,
  setBookmarkFolders,
  StorageError,
} from '../shared/storage';
import { isBuiltinFolder } from '../shared/models';

const BTN_ATTR = 'data-postshelf-btn';
const POP_CLASS = 'postshelf-popover';

export function injectButtons(root: ParentNode = document): void {
  for (const article of root.querySelectorAll(SEL.tweet)) {
    if (article.querySelector(`[${BTN_ATTR}]`)) continue;
    const bm = article.querySelector(bookmarkButtonSelector);
    const host = bm?.parentElement;
    if (!bm || !host) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BTN_ATTR, '');
    btn.title = UI.openFolders;
    btn.setAttribute('aria-label', UI.openFolders);
    btn.textContent = '▾';
    btn.style.cssText = 'background:none;border:0;cursor:pointer;color:#71767b;font-size:14px;padding:4px';
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
  const ex = extractTweet(article);
  if (!ex) return null;
  const { tweetId, snapshot } = ex;
  const folders = (await listFolders()).filter((f) => !isBuiltinFolder(f.id));
  const selected = new Set((await getBookmark(tweetId))?.folderIds ?? []);

  const pop = document.createElement('div');
  pop.className = POP_CLASS;
  pop.setAttribute('role', 'dialog');
  const r = anchor.getBoundingClientRect();
  pop.style.cssText = `position:fixed;z-index:2147483647;top:${r.bottom + 4}px;left:${Math.max(8, r.left - 100)}px;min-width:220px;background:#fff;color:#0f1419;border:1px solid #cfd9de;border-radius:8px;padding:8px;box-shadow:0 2px 12px rgba(0,0,0,.25);font:14px sans-serif`;
  pop.addEventListener('click', (e) => e.stopPropagation());

  const save = () => setBookmarkFolders(tweetId, [...selected], snapshot);

  const render = (list: typeof folders) => {
    pop.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = UI.noFolders;
      pop.append(empty);
    }
    for (const f of list) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 0;cursor:pointer';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(f.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(f.id);
        else selected.delete(f.id);
        void save();
      });
      const name = document.createElement('span');
      name.textContent = f.name;
      label.append(cb, name);
      pop.append(label);
    }
    const row = document.createElement('form');
    row.style.cssText = 'display:flex;gap:4px;margin-top:6px';
    const input = document.createElement('input');
    input.placeholder = UI.newFolderPlaceholder;
    input.setAttribute('aria-label', UI.newFolder);
    input.style.cssText = 'flex:1;min-width:0';
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = UI.add;
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
