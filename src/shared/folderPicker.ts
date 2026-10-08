/**
 * チェックボックス式のフォルダ選択 (フォルダ行 = アイコン(色つき) + 名前 + チェックボックス、末尾に「新しいフォルダ」行)。
 * x.com のポップオーバーと manager の「フォルダを変更」で共通に使う。
 * 配色は theme で受け取る (x.com では X のテーマ、manager では CSS 変数の文字列を渡す)。
 */
import { INBOX_ID, displayName, type Folder } from './models';
import { createFolder, StorageError } from './storage';
import { t } from './strings';
import { ACCENT_FILL } from './tokens';

export interface PickerTheme {
  fg: string;
  border: string;
  hover: string;
  accent: string;
}

export interface FolderPicker {
  el: HTMLElement;
  /** selected を外から書き換えたあと、チェックの表示を合わせる */
  sync: () => void;
}

export function createFolderPicker(opts: {
  folders: Folder[];
  selected: Set<string>;
  theme: PickerTheme;
  /** チェックの変化 (新規作成フォルダの自動選択を含む) のたびに呼ばれる */
  onChange: (selected: Set<string>) => void | Promise<void>;
}): FolderPicker {
  const { selected, theme: th, onChange } = opts;
  const el = document.createElement('div');

  // 先頭に常に「未分類」の行を出す (フォルダが 1 つもなくても、チェックを入れるだけで保存できる)。
  // 「未分類」は他のフォルダと同時には選べない。最後のチェックを外したときは「未分類」に戻る (保存の解除ではない)。
  const boxes = new Map<string, HTMLInputElement>();
  const sync = () => boxes.forEach((cb, id) => (cb.checked = selected.has(id)));
  const normalize = (changed: string, on: boolean) => {
    if (on && changed === INBOX_ID) selected.clear();
    if (on) selected.add(changed);
    else selected.delete(changed);
    if (on && changed !== INBOX_ID) selected.delete(INBOX_ID);
    if (selected.size === 0) selected.add(INBOX_ID);
    sync();
  };
  const inboxOf = (list: Folder[]): Folder => {
    const stored = list.find((f) => f.id === INBOX_ID);
    return { id: INBOX_ID, name: stored?.name ?? '', icon: 'ti-inbox', order: -1, color: stored?.color };
  };

  const render = (all: Folder[]) => {
    el.replaceChildren();
    boxes.clear();
    const list = [inboxOf(all), ...all.filter((f) => f.id !== INBOX_ID)];
    for (const f of list) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;gap:8px;align-items:center;min-height:32px;padding:4px 8px;border-radius:8px;cursor:pointer';
      label.addEventListener('mouseenter', () => (label.style.background = th.hover));
      label.addEventListener('mouseleave', () => (label.style.background = ''));
      const ico = document.createElement('i');
      ico.className = `ti ${f.icon}`;
      ico.style.cssText = `font-size:18px;color:${f.color ?? th.fg}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(f.id);
      cb.style.cssText = `accent-color:${th.accent};width:16px;height:16px;margin:0`;
      boxes.set(f.id, cb);
      cb.addEventListener('change', () => {
        normalize(f.id, cb.checked);
        void onChange(selected);
      });
      const name = document.createElement('span');
      name.textContent = displayName(f);
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      label.append(ico, name, cb);
      el.append(label);
    }
    const row = document.createElement('form');
    row.style.cssText = `display:flex;gap:4px;margin-top:6px;padding-top:6px;border-top:.5px solid ${th.border}`;
    const input = document.createElement('input');
    input.placeholder = t('newFolderPlaceholder');
    input.setAttribute('aria-label', t('newFolder'));
    input.style.cssText = `flex:1;min-width:0;background:transparent;color:${th.fg};border:.5px solid ${th.border};border-radius:8px;padding:4px 8px;min-height:32px`;
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = t('add');
    add.style.cssText = `background:${ACCENT_FILL};color:#fff;border:0;border-radius:8px;padding:4px 12px;min-height:32px;cursor:pointer`;
    row.append(input, add);
    row.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const f = await createFolder({ name: input.value });
        normalize(f.id, true);
        await onChange(selected);
        render([...all, f]);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        input.setCustomValidity(err.message);
        input.reportValidity();
      }
    });
    el.append(row);
  };
  render(opts.folders);
  return { el, sync };
}
