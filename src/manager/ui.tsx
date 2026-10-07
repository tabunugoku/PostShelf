import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { createFolderPicker } from '../shared/folderPicker';
import { displayName, type Folder } from '../shared/models';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';

/** アプリ内の確認ダイアログ (window.confirm は使わない)。Esc / 外側クリック / キャンセルで閉じ、フォーカスを元に戻す */
export function Confirm(props: { message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="overlay" onClick={props.onCancel}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-describedby="confirm-msg" onClick={(e) => e.stopPropagation()}>
        <p id="confirm-msg">{props.message}</p>
        <div class="dialog-actions">
          <button ref={cancelRef} onClick={props.onCancel}>
            {t('cancel')}
          </button>
          <button class="danger-solid" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 「元に戻す」付きトースト (表示時間は呼び出し側のタイマーで制御) */
export function Toast(props: { message: string; onUndo: () => void }) {
  return (
    <div class="toast" role="status">
      <span>{props.message}</span>
      <button onClick={props.onUndo}>{t('undo')}</button>
    </div>
  );
}

/** 外側クリック / Esc で閉じるドロップダウンの枠 */
export function Dropdown(props: { onClose: () => void; children: ComponentChildren; label?: string; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, []);
  return (
    <div ref={ref} class={`menu ${props.class ?? ''}`} role="dialog" aria-label={props.label}>
      {props.children}
    </div>
  );
}

/** フォルダを 1 つ選ぶメニュー (一括「フォルダに追加」「フォルダから外す」用) */
export function FolderMenu(props: { folders: Folder[]; onPick: (id: string) => void; onClose: () => void; label: string }) {
  return (
    <Dropdown onClose={props.onClose} label={props.label}>
      {props.folders.length === 0 && <div class="menu-empty">{t('noFolders')}</div>}
      {props.folders.map((f) => (
        <button class="menu-item" onClick={() => props.onPick(f.id)}>
          <Icon name={f.icon} color={f.color} />
          <span class="fr-name">{displayName(f)}</span>
        </button>
      ))}
    </Dropdown>
  );
}

/**
 * x.com のポップオーバーと共通のチェックボックス式フォルダ選択 (src/shared/folderPicker.ts) を Preact に載せる。
 * 配色は manager の CSS 変数を渡す。
 */
export function FolderPickerHost(props: { folders: Folder[]; selected: string[]; onChange: (selected: Set<string>) => void | Promise<void> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const picker = createFolderPicker({
      folders: props.folders,
      selected: new Set(props.selected),
      theme: { fg: 'var(--text-primary)', border: 'var(--border-strong)', hover: 'var(--fill-ghost-hover)', accent: 'var(--fill-accent)' },
      onChange: props.onChange,
    });
    host.current?.replaceChildren(picker.el);
  }, []);
  return <div ref={host} class="picker-host" />;
}
