/**
 * 「フォルダを作成」メニュー (素の DOM)。x.com のポップオーバー / manager の「フォルダを変更」/ サイドパネルの保存で、
 * フォルダ選択 (folderPicker.ts) の中に、一覧と切り替えて開く。名前・アイコン・色を決めて「作成」を押すとフォルダを作る。
 * アイコンと色の選択肢は models.ts のもの (manager の編集パネルと同じ: アイコンは先頭の 8 種、色は色なし + COLORS)。
 * manager の FolderEdit は Preact なので、DOM 版をここに別に持つ (選択肢は共有)。
 */
import { COLORS, FOLDER_ICON, MAIN_ICONS, colorLabel, displayName, iconLabel, type Folder } from './models';
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
  /** false なら作成済みのフォルダを保持し、次の送信でこの処理だけを再試行する */
  onCreated: (folder: Folder) => void | boolean | Promise<void | boolean>;
  /** 「キャンセル」と「← 戻る」 */
  onClose: () => void;
}): FolderCreateMenu {
  const th = opts.theme;
  const el = document.createElement('form');
  el.setAttribute('aria-label', t('createFolder'));
  el.noValidate = true;
  el.style.cssText = 'box-sizing:border-box;margin:0;display:grid;gap:12px;min-width:0';

  let icon: string = FOLDER_ICON;
  let color: string | undefined;

  // x.com 側の CSS (button / i の余白・基準線・フォントなど) に引きずられないよう、部品ごとに明示する (v19)
  const RESET = 'box-sizing:border-box;margin:0;line-height:1.4;font:inherit;-webkit-appearance:none;appearance:none';
  const btnCss = `${RESET};min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;border:.5px solid ${th.border};background:transparent;color:${th.fg}`;
  const mk = (text: string, type: 'button' | 'submit' = 'button') => {
    const b = document.createElement('button');
    b.type = type;
    b.textContent = text;
    b.style.cssText = btnCss;
    return b;
  };

  const head = document.createElement('div');
  head.style.cssText = `${RESET};display:flex;gap:8px;align-items:center`;
  const back = mk(`← ${t('back')}`);
  back.style.cssText = btnCss + ';border:0;padding:4px 8px';
  const title = document.createElement('strong');
  title.textContent = t('createFolder');
  title.style.cssText = `${RESET};flex:1;min-width:0;font-weight:700`;
  head.append(back, title);

  const input = document.createElement('input');
  input.placeholder = t('newFolderPlaceholder');
  input.setAttribute('aria-label', t('name'));
  input.autocomplete = 'off';
  input.style.cssText = `${RESET};min-width:0;width:100%;background:transparent;color:${th.fg};border:.5px solid ${th.border};border-radius:8px;padding:4px 8px;min-height:32px`;

  /** ラベルは、並べる列の上に置く (列の左に置くと、幅が足りずに折り返す) */
  const group = (label: string) => {
    const g = document.createElement('div');
    g.style.cssText = `${RESET};display:grid;gap:6px;min-width:0`;
    const l = document.createElement('div');
    l.textContent = label;
    l.style.cssText = `${RESET};font-size:12px;opacity:.75`;
    g.append(l);
    return g;
  };
  const mark = (b: HTMLElement, on: boolean) => {
    b.setAttribute('aria-pressed', String(on));
  };

  // アイコン 8 個: 幅いっぱいを 8 等分した 1 行。ボタンは正方形で、中のアイコンを中央に置く
  const iconGroup = group(t('icon'));
  const iconGrid = document.createElement('div');
  iconGrid.style.cssText = `${RESET};display:grid;grid-template-columns:repeat(8,1fr);gap:4px;width:100%`;
  const iconBtns = new Map<string, HTMLButtonElement>();
  for (const i of MAIN_ICONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', iconLabel(i));
    b.dataset.icon = i;
    b.style.cssText = `${RESET};display:grid;place-items:center;aspect-ratio:1;width:100%;min-width:0;min-height:0;padding:0;border-radius:8px;cursor:pointer;border:.5px solid transparent;background:transparent;color:${th.fg}`;
    const ic = document.createElement('i');
    ic.className = `ti ${i}`;
    ic.style.cssText = 'display:block;box-sizing:border-box;margin:0;padding:0;width:18px;height:18px;font-size:18px;line-height:1;font-style:normal;position:static;vertical-align:baseline';
    b.append(ic);
    b.addEventListener('click', () => {
      icon = i;
      paint();
    });
    iconBtns.set(i, b);
    iconGrid.append(b);
  }
  iconGroup.append(iconGrid);

  // 色 (色なし + 8 色の 9 個): 幅を 9 等分した 1 行。丸の大きさは、幅に合わせて 20〜24px
  const colorGroup = group(t('color'));
  const colorGrid = document.createElement('div');
  colorGrid.style.cssText = `${RESET};display:grid;grid-template-columns:repeat(9,1fr);gap:6px;width:100%;align-items:center;justify-items:center`;
  const swatches = new Map<string | undefined, HTMLButtonElement>();
  for (const c of [undefined, ...COLORS]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', c ? colorLabel(c) : t('colorNone'));
    b.dataset.color = c ?? '';
    if (c === undefined) b.title = t('colorNone');
    // 色なし: 斜線の入った枠 (manager の編集パネルの「色なし」と同じ見た目)
    b.style.cssText = `${RESET};display:block;width:clamp(20px,100%,24px);aspect-ratio:1;min-height:0;padding:0;border-radius:50%;cursor:pointer;border:.5px solid ${th.border};background:${c ?? `linear-gradient(135deg,transparent 45%,${th.fg} 46%,${th.fg} 54%,transparent 55%)`}`;
    b.addEventListener('click', () => {
      color = c;
      paint();
    });
    swatches.set(c, b);
    colorGrid.append(b);
  }
  colorGroup.append(colorGrid);

  // 名前・アイコン・色を決めたあとの見え方 (1 行)。名前が空のときは薄くして「フォルダ名」を出す
  const preview = document.createElement('div');
  preview.setAttribute('aria-hidden', 'true');
  preview.style.cssText = `${RESET};display:flex;gap:8px;align-items:center;min-height:32px;padding:4px 8px;border-radius:8px;background:${th.hover}`;
  const prevIcon = document.createElement('i');
  const prevName = document.createElement('span');
  prevName.style.cssText = `${RESET};flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
  preview.append(prevIcon, prevName);

  const error = document.createElement('div');
  error.setAttribute('role', 'alert');
  error.style.cssText = `${RESET};display:none;color:#f4212e;font-size:13px;overflow-wrap:anywhere`;

  const actions = document.createElement('div');
  actions.style.cssText = `${RESET};display:flex;gap:8px;justify-content:flex-end`;
  const cancel = mk(t('cancel'));
  const create = mk(t('create'), 'submit');
  create.style.cssText = `${RESET};min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;border:0;background:${ACCENT_FILL};color:#fff`;
  actions.append(cancel, create);

  const paint = () => {
    iconBtns.forEach((b, i) => {
      const on = i === icon;
      mark(b, on);
      // 選択中: アクセント色の枠 + 薄い背景
      b.style.borderColor = on ? th.accent : 'transparent';
      b.style.background = on ? th.hover : 'transparent';
      b.style.boxShadow = on ? `0 0 0 1px ${th.accent} inset` : 'none';
    });
    swatches.forEach((b, c) => {
      const on = c === color;
      mark(b, on);
      // 選択中: 二重のリング (内側にすき間を空けた外側の輪)
      b.style.outline = on ? `2px solid ${th.accent}` : 'none';
      b.style.outlineOffset = '2px';
    });
    const name = input.value.trim();
    prevIcon.className = `ti ${icon}`;
    prevIcon.style.cssText = `display:block;position:static;margin:0;padding:0;width:18px;height:18px;font-size:18px;line-height:1;font-style:normal;color:${color ?? th.fg}`;
    prevName.textContent = name || t('newFolderPlaceholder');
    prevName.style.opacity = name ? '1' : '.5';
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
  let pending: Folder | undefined;
  const keepCreated = (folder?: Folder) => {
    pending = folder;
    // 作成後の再試行で、表示中の下書きと作成済みフォルダの値がずれないようにする。
    input.readOnly = !!folder;
    iconBtns.forEach(b => { b.disabled = !!folder; });
    swatches.forEach(b => { b.disabled = !!folder; });
  };
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || input.value.trim() === '') return;
    if (!pending && hasSameName(opts.existing(), input.value)) return showError(t('errDuplicateFolder'));
    busy = true;
    try {
      const folder = pending ?? await createFolder({ name: input.value, icon, color });
      keepCreated(await opts.onCreated(folder) === false ? folder : undefined);
    } catch (err) {
      if (!(err instanceof StorageError)) throw err;
      showError(err.message);
    } finally {
      busy = false;
    }
  });
  back.addEventListener('click', () => opts.onClose());
  cancel.addEventListener('click', () => opts.onClose());

  el.append(head, input, iconGroup, colorGroup, preview, error, actions);
  const reset = () => {
    keepCreated();
    input.value = '';
    icon = FOLDER_ICON;
    color = undefined;
    showError('');
    paint();
  };
  reset();
  return { el, reset, focus: () => input.focus() };
}
