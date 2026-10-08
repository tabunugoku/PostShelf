import { useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { displayName, type Folder } from '../shared/models';
import { t } from '../shared/strings';
import { Dropdown } from './ui';

/**
 * 複数選択の操作 (v19-B / v20-B): 「N 件選択中 ⌄」のボタンから、フォルダに追加 / フォルダから外す / 削除 / 選択解除を開く。
 * 何も選んでいないときは出さない (呼び出し側)。管理画面とサイドパネルで共有する。
 * 「フォルダに追加」「フォルダから外す」は、同じメニューの中で、フォルダの一覧に切り替わる (← 戻る)。
 */
export function BulkMenu(props: {
  count: number;
  addFolders: Folder[];
  removeFolders: Folder[];
  onAdd: (folderId: string) => void;
  onRemove: (folderId: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'add' | 'remove'>('main');
  const close = () => {
    setOpen(false);
    setView('main');
  };
  const folderList = (folders: Folder[], pick: (id: string) => void, label: string) => (
    <>
      <button class="menu-item" onClick={() => setView('main')}>
        <Icon name="ti-arrow-left" /> {label}
      </button>
      {folders.length === 0 && <div class="menu-empty">{t('noFolders')}</div>}
      {folders.map((f) => (
        <button
          class="menu-item"
          onClick={() => {
            close();
            pick(f.id);
          }}
        >
          <Icon name={f.icon} color={f.color} />
          <span class="fr-name">{displayName(f)}</span>
        </button>
      ))}
    </>
  );
  return (
    <span class="menu-anchor bulk-anchor">
      <button class="bulk-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <strong>{t('selectedCount', props.count)}</strong>
        <Icon name="ti-chevron-down" />
      </button>
      {open && (
        <Dropdown onClose={close} label={t('bulkMenuLabel')} class="menu-bulk">
          {view === 'main' && (
            <>
              <button class="menu-item" onClick={() => setView('add')}>
                <Icon name="ti-folder-plus" /> {t('bulkAdd')}
              </button>
              <button class="menu-item" onClick={() => setView('remove')}>
                <Icon name="ti-folder-minus" /> {t('bulkRemove')}
              </button>
              <button
                class="menu-item danger-text"
                onClick={() => {
                  close();
                  props.onDelete();
                }}
              >
                <Icon name="ti-trash" /> {t('delete')}
              </button>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  props.onClear();
                }}
              >
                <Icon name="ti-x" /> {t('clearSelection')}
              </button>
            </>
          )}
          {view === 'add' && folderList(props.addFolders, props.onAdd, t('bulkAdd'))}
          {view === 'remove' && folderList(props.removeFolders, props.onRemove, t('bulkRemove'))}
        </Dropdown>
      )}
    </span>
  );
}
