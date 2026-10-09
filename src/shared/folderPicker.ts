/**
 * チェックボックス式のフォルダ選択 (フォルダ行 = アイコン(色つき) + 名前 + チェックボックス、一覧の下に「フォルダを追加」ボタン)。
 * ボタンを押すと、同じ場所に「フォルダを作成」のメニューが開く (一覧は隠れる。名前・アイコン・色を決めて「作成」)。
 * x.com のポップオーバーと manager の「フォルダを変更」で共通に使う。
 * 配色は theme で受け取る (x.com では X のテーマ、manager では CSS 変数の文字列を渡す)。
 */
import { INBOX_ID, displayName, type Folder } from './models';
import { t } from './strings';
import { createFolderMenu } from './folderCreateMenu';
import { foldText } from './fold';

export interface PickerTheme {
  fg: string;
  border: string;
  hover: string;
  accent: string;
}

/** 絞り込み欄を出すフォルダ数 (「未分類」を除く) の下限 */
export const FILTER_MIN_FOLDERS = 8;
/** 「最近使った」を出すフォルダ数 (「未分類」を除く) の下限 */
export const RECENT_MIN_FOLDERS = 6;

export interface FolderPicker {
  el: HTMLElement;
  /** selected を外から書き換えたあと、チェックの表示を合わせる */
  sync: () => void;
  /** 絞り込み欄があればフォーカスを当てる (あれば true) */
  focusFilter: () => boolean;
}

/** 「未分類」の行 (保存されていなくても、一覧の先頭に出す仮想の行) */
export const inboxOf = (list: Folder[]): Folder => {
  const stored = list.find((f) => f.id === INBOX_ID);
  return { id: INBOX_ID, name: stored?.name ?? '', icon: 'ti-inbox', order: -1, color: stored?.color };
};

/**
 * 下部の操作に使う、アイコン + 文の同じ形のボタン (「フォルダを追加」「サイドパネルで開く」「PostShelf から外す」)。
 * x.com の CSS に引きずられないよう、余白とフォントを明示する。tone: 'sub' は控えめな色、'danger' は赤い文字。
 */
export function flatButton(th: PickerTheme, text: string, icon: string, tone: 'normal' | 'sub' | 'danger' = 'normal'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  const color = tone === 'danger' ? '#f4212e' : th.fg;
  b.style.cssText = `box-sizing:border-box;margin:0;display:flex;gap:8px;align-items:center;width:100%;min-height:36px;padding:4px 8px;background:transparent;color:${color};border:0;border-radius:8px;cursor:pointer;font:inherit;line-height:1.4;text-align:left;opacity:${tone === 'sub' ? '.8' : '1'}`;
  const ic = document.createElement('i');
  ic.className = `ti ${icon}`;
  ic.style.cssText = 'display:block;position:static;margin:0;padding:0;width:18px;height:18px;font-size:18px;line-height:1;font-style:normal;flex:none';
  b.append(ic, document.createTextNode(text));
  b.addEventListener('mouseenter', () => (b.style.background = th.hover));
  b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
  return b;
}

/** アイコンだけのボタン (44px 角)。名前は aria-label と title に入れる */
export function iconButton(th: PickerTheme, label: string, icon: string, tone: 'normal' | 'danger' = 'normal'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  const color = tone === 'danger' ? '#f4212e' : th.fg;
  b.style.cssText = `box-sizing:border-box;margin:0;display:flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;padding:0;background:transparent;color:${color};border:0;border-radius:8px;cursor:pointer;font:inherit`;
  const ic = document.createElement('i');
  ic.className = `ti ${icon}`;
  ic.setAttribute('aria-hidden', 'true');
  ic.style.cssText = 'display:block;position:static;margin:0;padding:0;width:20px;height:20px;font-size:20px;line-height:1;font-style:normal;flex:none';
  b.append(ic);
  b.addEventListener('mouseenter', () => (b.style.background = th.hover));
  b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
  return b;
}

/** 区切り線 */
export function divider(th: PickerTheme): HTMLElement {
  const d = document.createElement('div');
  d.style.cssText = `box-sizing:border-box;height:0;margin:4px 0;border:0;border-top:.5px solid ${th.border}`;
  return d;
}

export function createFolderPicker(opts: {
  folders: Folder[];
  selected: Set<string>;
  theme: PickerTheme;
  /** チェックの変化 (新規作成フォルダの自動選択を含む) のたびに呼ばれる */
  onChange: (selected: Set<string>) => void | Promise<void>;
  /**
   * x.com のポップオーバー用の追加機能 (v28): 保存状態の見出し、絞り込み欄 (8 つ以上)、「最近使った」(6 つ以上)。
   * 渡さなければ有効にしない (manager の「フォルダを変更」は見た目を変えない)。recentIds は新しい順。存在しないフォルダは飛ばす
   */
  extras?: { recentIds: string[] };
}): FolderPicker {
  const { selected, theme: th, onChange } = opts;
  const el = document.createElement('div');

  // 先頭に常に「未分類」の行を出す (フォルダが 1 つもなくても、チェックを入れるだけで保存できる)。
  // 「未分類」は他のフォルダと同時には選べない。最後のチェックを外したときは「未分類」に戻る (保存の解除ではない)。
  const boxes = new Map<string, HTMLInputElement>();
  /** 行ごとの見た目の更新 (チェックの塗り / 選択中の行の薄い背景 / 印の data-checked) */
  const paints = new Map<string, () => void>();
  const sync = () => {
    boxes.forEach((cb, id) => (cb.checked = selected.has(id)));
    paints.forEach((p) => p());
    paintStatus();
  };
  const normalize = (changed: string, on: boolean) => {
    if (on && changed === INBOX_ID) selected.clear();
    if (on) selected.add(changed);
    else selected.delete(changed);
    if (on && changed !== INBOX_ID) selected.delete(INBOX_ID);
    if (selected.size === 0) selected.add(INBOX_ID);
    sync();
  };

  const folders = [...opts.folders];
  const extras = opts.extras;
  const userFolderCount = () => folders.filter((f) => f.id !== INBOX_ID).length;
  let query = '';

  // 見出し (保存状態) と絞り込み欄。一覧の再描画で消えないよう、一覧とは別の要素に置く
  const headEl = document.createElement('div');
  const statusEl = document.createElement('div');
  statusEl.style.cssText = `box-sizing:border-box;padding:2px 8px 6px;font-size:13px;opacity:.8;white-space:nowrap;color:${th.fg}`;
  const filterEl = document.createElement('input');
  const paintStatus = () => {
    if (!extras) return;
    const ids = [...selected];
    const n = ids.filter((id) => id !== INBOX_ID).length;
    statusEl.textContent = ids.length === 0 ? '' : n === 0 ? `✓ ${t('savedInInbox')}` : `✓ ${t('savedInFolders', n)}`;
    statusEl.style.display = ids.length === 0 ? 'none' : 'block';
  };
  if (extras) {
    filterEl.type = 'text';
    filterEl.placeholder = t('folderFilter');
    filterEl.setAttribute('aria-label', t('folderFilter'));
    filterEl.style.cssText = `box-sizing:border-box;display:block;width:100%;margin:0 0 4px;padding:6px 8px;font:inherit;color:${th.fg};background:transparent;border:.5px solid ${th.border};border-radius:8px;outline:none`;
    filterEl.addEventListener('focus', () => (filterEl.style.outline = `2px solid ${th.accent}`));
    filterEl.addEventListener('blur', () => (filterEl.style.outline = 'none'));
    filterEl.addEventListener('input', () => {
      query = foldText(filterEl.value.trim());
      render();
    });
    headEl.append(statusEl, filterEl);
  }
  const showFilter = () => !!extras && userFolderCount() >= FILTER_MIN_FOLDERS;
  const listEl = document.createElement('div');
  el.append(headEl, listEl);

  // ↑↓ で行を移動 (絞り込み欄から ↓ で最初の行へ)。Space の切り替えはチェックボックスの既存の動作
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const target = e.target as HTMLElement;
    const rows = [...listEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    const i = rows.indexOf(target as HTMLInputElement);
    if (target !== filterEl && i < 0) return;
    e.preventDefault();
    if (target === filterEl) return void (e.key === 'ArrowDown' && rows[0]?.focus());
    if (e.key === 'ArrowDown') rows[Math.min(i + 1, rows.length - 1)].focus();
    else if (i > 0) rows[i - 1].focus();
    else if (showFilter()) filterEl.focus();
  });

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
    headEl.style.display = 'none';
    listEl.style.display = 'none';
    menu.el.hidden = false;
    menu.el.style.display = 'grid';
    menu.focus();
  };
  const closeMenu = () => {
    menu.el.hidden = true;
    menu.el.style.display = 'none';
    headEl.style.display = '';
    listEl.style.display = '';
    render();
    addBtn.focus();
  };

  // 「フォルダを追加」: 一覧の下の区切り線のあと、他の下部の操作と同じ形のボタン
  const addBtn = flatButton(th, t('addFolder'), 'ti-folder-plus');
  addBtn.addEventListener('click', openMenu);

  const render = () => {
    listEl.replaceChildren();
    boxes.clear();
    paints.clear();
    filterEl.style.display = showFilter() ? 'block' : 'none';
    const all = [inboxOf(folders), ...folders.filter((f) => f.id !== INBOX_ID)];
    const heading = (text: string) => {
      const h = document.createElement('div');
      h.textContent = text;
      h.style.cssText = `box-sizing:border-box;padding:6px 8px 2px;font-size:12px;opacity:.7;white-space:nowrap;color:${th.fg}`;
      listEl.append(h);
    };
    let shown = all;
    let recent: Folder[] = [];
    if (query) {
      shown = all.filter((f) => foldText(displayName(f)).includes(query));
    } else if (extras && userFolderCount() >= RECENT_MIN_FOLDERS) {
      recent = (extras.recentIds)
        .map((id) => folders.find((f) => f.id === id && f.id !== INBOX_ID))
        .filter((f): f is Folder => !!f)
        .slice(0, 3);
      if (recent.length) {
        const ids = new Set(recent.map((f) => f.id));
        shown = all.filter((f) => !ids.has(f.id));
      }
    }
    if (recent.length) {
      heading(t('folderRecent'));
      for (const f of recent) addRow(f);
      heading(t('folderAll', userFolderCount()));
    }
    for (const f of shown) addRow(f);
    listEl.append(divider(th), addBtn);
  };
  const addRow = (f: Folder) => {
    {
      const label = document.createElement('label');
      label.style.cssText = 'box-sizing:border-box;margin:0;display:flex;gap:8px;align-items:center;min-height:32px;padding:4px 8px;border-radius:8px;cursor:pointer';
      let hovered = false;
      const ico = document.createElement('i');
      ico.className = `ti ${f.icon}`;
      ico.style.cssText = `display:block;position:static;margin:0;padding:0;font-size:18px;line-height:1;font-style:normal;color:${f.color ?? th.fg}`;
      // 自前のチェック (角の丸い四角。選択中はアクセント色で塗り、白いチェック)。実際の入力は input type=checkbox のまま
      // (キーボードとスクリーンリーダーの操作はそのまま)。appearance:none で見た目だけを変える
      const box = document.createElement('span');
      box.style.cssText = 'box-sizing:border-box;position:relative;display:block;width:18px;height:18px;flex:none;margin:0;padding:0';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(f.id);
      cb.style.cssText = `box-sizing:border-box;-webkit-appearance:none;appearance:none;position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border-radius:5px;cursor:pointer;color:${th.fg}`;
      const tick = document.createElement('i');
      tick.className = 'ti ti-check';
      tick.setAttribute('aria-hidden', 'true');
      tick.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;margin:0;padding:0;font-size:13px;line-height:1;font-style:normal;color:#fff;pointer-events:none';
      box.append(cb, tick);
      const paintRow = () => {
        const on = selected.has(f.id);
        label.setAttribute('data-checked', String(on));
        cb.style.border = `1.5px solid ${on ? th.accent : th.fg}`;
        cb.style.opacity = on ? '1' : '.6';
        cb.style.background = on ? th.accent : 'transparent';
        tick.style.display = on ? 'flex' : 'none';
        label.style.background = on || hovered ? th.hover : '';
      };
      label.addEventListener('mouseenter', () => {
        hovered = true;
        paintRow();
      });
      label.addEventListener('mouseleave', () => {
        hovered = false;
        paintRow();
      });
      boxes.set(f.id, cb);
      paints.set(f.id, paintRow);
      cb.addEventListener('change', () => {
        normalize(f.id, cb.checked);
        void onChange(selected);
      });
      cb.addEventListener('focus', () => (cb.style.outline = `2px solid ${th.accent}`));
      cb.addEventListener('blur', () => (cb.style.outline = 'none'));
      const name = document.createElement('span');
      name.textContent = displayName(f);
      name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      label.append(ico, name, box);
      listEl.append(label);
      paintRow();
    }
  };
  el.append(menu.el);
  render();
  paintStatus();
  return { el, sync, focusFilter: () => (showFilter() ? (filterEl.focus(), true) : false) };
}
