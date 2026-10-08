/**
 * チェックボックス式のフォルダ選択 (フォルダ行 = アイコン(色つき) + 名前 + チェックボックス、末尾に「新しいフォルダ」行)。
 * x.com のポップオーバーと manager の「フォルダを変更」で共通に使う。
 * 配色は theme で受け取る (x.com では X のテーマ、manager では CSS 変数の文字列を渡す)。
 */
import { displayName, type Folder } from './models';
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

  const render = (list: Folder[]) => {
    el.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = t('noFolders');
      el.append(empty);
    }
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
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(f.id);
        else selected.delete(f.id);
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
        selected.add(f.id);
        await onChange(selected);
        render([...list, f]);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        input.setCustomValidity(err.message);
        input.reportValidity();
      }
    });
    el.append(row);
  };
  render(opts.folders);
  return { el };
}
