/**
 * 「フォルダを作成」メニュー (素の DOM)。x.com のポップオーバー / manager の「フォルダを変更」/ サイドパネルの保存で、
 * フォルダ選択 (folderPicker.ts) の中に、一覧と切り替えて開く。名前・アイコン・色を決めて「作成」を押すとフォルダを作る。
 * アイコンと色の選択肢は models.ts のもの (manager の編集パネルと同じ: アイコンは先頭の 8 種、色は色なし + COLORS)。
 * manager の FolderEdit は Preact なので、DOM 版をここに別に持つ (選択肢は共有)。
 */
import { COLORS, FOLDER_ICON, ICONS, displayName, type Folder } from './models';
import { createFolder, StorageError } from './storage';
import { t } from './strings';
import { ACCENT_FILL } from './tokens';
import type { PickerTheme } from './folderPicker';

export interface FolderCreateMenu {
  el: HTMLElement;
  /** 開く前の状態 (入力を空に、アイコンと色を初期値に、エラーを消す) に戻す */
  reset: () => void;
  focus: () => void;
}

/** 同名 (前後の空白と大文字小文字を無視) のフォルダがあるか */
export const hasSameName = (folders: Folder[], name: string): boolean => {
  const n = name.trim().toLocaleLowerCase();
  return n !== '' && folders.some((f) => displayName(f).trim().toLocaleLowerCase() === n);
};

export function createFolderMenu(opts: {
  theme: PickerTheme;
  /** 同名の判定に使う、いまあるフォルダ */
  existing: () => Folder[];
  onCreated: (folder: Folder) => void | Promise<void>;
  /** 「キャンセル」と「← 戻る」 */
  onClose: () => void;
}): FolderCreateMenu {
  const th = opts.theme;
  const el = document.createElement('form');
  el.setAttribute('aria-label', t('createFolder'));
  el.noValidate = true;
  el.style.cssText = 'display:grid;gap:8px';

  let icon: string = FOLDER_ICON;
  let color: string | undefined;

  const btnCss = `font:inherit;min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;border:.5px solid ${th.border};background:transparent;color:${th.fg}`;
  const mk = (text: string, type: 'button' | 'submit' = 'button') => {
    const b = document.createElement('button');
    b.type = type;
    b.textContent = text;
    b.style.cssText = btnCss;
    return b;
  };

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;align-items:center';
  const back = mk(`← ${t('back')}`);
  back.style.cssText = btnCss + ';border:0;padding:4px 8px';
  const title = document.createElement('strong');
  title.textContent = t('createFolder');
  title.style.cssText = 'flex:1;min-width:0';
  head.append(back, title);

  const input = document.createElement('input');
  input.placeholder = t('newFolderPlaceholder');
  input.setAttribute('aria-label', t('name'));
  input.autocomplete = 'off';
  input.style.cssText = `min-width:0;box-sizing:border-box;width:100%;background:transparent;color:${th.fg};border:.5px solid ${th.border};border-radius:8px;padding:4px 8px;min-height:32px;font:inherit`;

  const row = (label: string) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = 'min-width:48px;opacity:.75;font-size:13px';
    r.append(l);
    return r;
  };
  const mark = (b: HTMLElement, on: boolean) => {
    b.setAttribute('aria-pressed', String(on));
    b.style.outline = on ? `2px solid ${th.accent}` : 'none';
    b.style.outlineOffset = '1px';
  };

  const iconRow = row(t('icon'));
  const iconBtns = new Map<string, HTMLButtonElement>();
  for (const i of ICONS.slice(0, 8)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', i);
    b.style.cssText = `width:32px;height:32px;padding:0;border-radius:8px;cursor:pointer;border:.5px solid ${th.border};background:transparent;color:${th.fg};font-size:18px;line-height:1`;
    const ic = document.createElement('i');
    ic.className = `ti ${i}`;
    b.append(ic);
    b.addEventListener('click', () => {
      icon = i;
      paint();
    });
    iconBtns.set(i, b);
    iconRow.append(b);
  }

  const colorRow = row(t('color'));
  const swatches = new Map<string | undefined, HTMLButtonElement>();
  for (const c of [undefined, ...COLORS]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', c ?? t('colorNone'));
    if (c === undefined) b.title = t('colorNone');
    // 色なし: 斜線の入った枠 (manager の編集パネルの「色なし」と同じ見た目)
    b.style.cssText = `width:20px;height:20px;padding:0;border-radius:50%;cursor:pointer;border:.5px solid ${th.border};background:${c ?? `linear-gradient(135deg,transparent 45%,${th.fg} 46%,${th.fg} 54%,transparent 55%)`}`;
    b.addEventListener('click', () => {
      color = c;
      paint();
    });
    swatches.set(c, b);
    colorRow.append(b);
  }

  const error = document.createElement('div');
  error.setAttribute('role', 'alert');
  error.style.cssText = 'display:none;color:#f4212e;font-size:13px;overflow-wrap:anywhere';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  const cancel = mk(t('cancel'));
  const create = mk(t('create'), 'submit');
  create.style.cssText = `font:inherit;min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;border:0;background:${ACCENT_FILL};color:#fff`;
  actions.append(cancel, create);

  const paint = () => {
    iconBtns.forEach((b, i) => mark(b, i === icon));
    swatches.forEach((b, c) => mark(b, c === color));
    const empty = input.value.trim() === '';
    create.disabled = empty; // 空のときは「作成」を押せない
    create.style.opacity = empty ? '.5' : '1';
    create.style.cursor = empty ? 'not-allowed' : 'pointer';
  };
  const showError = (msg: string) => {
    error.textContent = msg;
    error.style.display = msg ? 'block' : 'none';
  };
  input.addEventListener('input', () => {
    showError('');
    paint();
  });

  let busy = false;
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || input.value.trim() === '') return;
    if (hasSameName(opts.existing(), input.value)) return showError(t('errDuplicateFolder'));
    busy = true;
    try {
      const folder = await createFolder({ name: input.value, icon, color });
      await opts.onCreated(folder);
    } catch (err) {
      if (!(err instanceof StorageError)) throw err;
      showError(err.message);
    } finally {
      busy = false;
    }
  });
  back.addEventListener('click', () => opts.onClose());
  cancel.addEventListener('click', () => opts.onClose());

  el.append(head, input, iconRow, colorRow, error, actions);
  const reset = () => {
    input.value = '';
    icon = FOLDER_ICON;
    color = undefined;
    showError('');
    paint();
  };
  reset();
  return { el, reset, focus: () => input.focus() };
}
