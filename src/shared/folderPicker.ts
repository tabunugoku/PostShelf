/**
 * チェックボックス式のフォルダ選択 (フォルダ行 = アイコン(色つき) + 名前 + チェックボックス、一覧の下に「フォルダを追加」ボタン)。
 * ボタンを押すと、同じ場所に「フォルダを作成」のメニューが開く (一覧は隠れる。名前・アイコン・色を決めて「作成」)。
 * x.com のポップオーバーと manager の「フォルダを変更」で共通に使う。
 * 配色は theme で受け取る (x.com では X のテーマ、manager では CSS 変数の文字列を渡す)。
 */
import { INBOX_ID, displayName, type Folder } from './models';
import { t } from './strings';
import { createFolderMenu } from './folderCreateMenu';

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

/** 「未分類」の行 (保存されていなくても、一覧の先頭に出す仮想の行) */
export const inboxOf = (list: Folder[]): Folder => {
  const stored = list.find((f) => f.id === INBOX_ID);
  return { id: INBOX_ID, name: stored?.name ?? '', icon: 'ti-inbox', order: -1, color: stored?.color };
};

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

  const folders = [...opts.folders];
  const listEl = document.createElement('div');
  el.append(listEl);

  const menu = createFolderMenu({
    theme: th,
    existing: () => [inboxOf(folders), ...folders], // 「未分類」(まだ保存されていないときの仮想の行) も同名の判定に含める
    onCreated: async (f) => {
      // 作ったフォルダを、このポストの保存先として選んで一覧に戻る (「未分類」との排他は normalize)
      folders.push(f);
      normalize(f.id, true);
      await onChange(selected);
      closeMenu();
    },
    onClose: () => closeMenu(),
  });
  menu.el.hidden = true;
  menu.el.style.display = 'none';
  // Escape: メニューが開いているときは、メニューだけを閉じる (ポップオーバーや呼び出し元のダイアログは閉じない)
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.el.hidden) {
      e.stopPropagation();
      closeMenu();
    }
  });
  const openMenu = () => {
    menu.reset();
    listEl.style.display = 'none';
    menu.el.hidden = false;
    menu.el.style.display = 'grid';
    menu.focus();
  };
  const closeMenu = () => {
    menu.el.hidden = true;
    menu.el.style.display = 'none';
    listEl.style.display = '';
    render();
    addBtn.focus();
  };

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.style.cssText = `display:flex;gap:8px;align-items:center;width:100%;min-height:32px;margin-top:6px;padding:4px 8px;background:transparent;color:${th.fg};border:0;border-top:.5px solid ${th.border};border-radius:0 0 8px 8px;cursor:pointer;font:inherit;text-align:left`;
  const addIcon = document.createElement('i');
  addIcon.className = 'ti ti-folder-plus';
  addIcon.style.cssText = 'font-size:18px';
  addBtn.append(addIcon, document.createTextNode(t('addFolder')));
  addBtn.addEventListener('mouseenter', () => (addBtn.style.background = th.hover));
  addBtn.addEventListener('mouseleave', () => (addBtn.style.background = ''));
  addBtn.addEventListener('click', openMenu);

  const render = () => {
    listEl.replaceChildren();
    boxes.clear();
    const list = [inboxOf(folders), ...folders.filter((f) => f.id !== INBOX_ID)];
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
      listEl.append(label);
    }
    listEl.append(addBtn);
  };
  el.append(menu.el);
  render();
  return { el, sync };
}
