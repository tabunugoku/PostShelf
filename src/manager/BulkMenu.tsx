import { useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import type { Bookmark, Folder } from '../shared/models';
import { t } from '../shared/strings';
import { Dropdown, FolderPickerHost } from './ui';

/** 管理画面とサイドパネル共通の一括操作。フォルダの行だけを全ポストに追加 / 解除する。 */
export function BulkMenu(props: {
  count: number;
  folders: Folder[];
  bookmarks: Bookmark[];
  onToggle: (folderId: string, on: boolean) => Promise<void>;
  onDelete: () => void;
  onSelectAll: () => void;
  allSelected: boolean;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'folders'>('main');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const states = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of props.bookmarks) for (const id of new Set(b.folderIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return {
      selected: [...counts].filter(([, n]) => n === props.bookmarks.length).map(([id]) => id),
      partial: new Set([...counts].filter(([, n]) => n < props.bookmarks.length).map(([id]) => id)),
    };
  }, [props.bookmarks]);
  const close = () => { setOpen(false); setView('main'); };
  const toggle = async (id: string, on: boolean) => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try { await props.onToggle(id, on); }
    finally { busy.current = false; setSaving(false); }
  };
  return (
    <span class="menu-anchor bulk-anchor">
      <button class="bulk-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <strong>{t('selectedCount', props.count)}</strong><Icon name="ti-chevron-down" />
      </button>
      {open && <Dropdown onClose={close} label={t('bulkMenuLabel')} class={view === 'folders' ? 'menu-bulk menu-wide' : 'menu-bulk'}>
        {view === 'main' ? <>
          <button class="menu-item" onClick={() => setView('folders')}><Icon name="ti-folder-plus" /> {t('changeFolder')}</button>
          <button class="menu-item danger-text" onClick={() => { close(); props.onDelete(); }}><Icon name="ti-trash" /> {t('delete')}</button>
          <button class="menu-item" disabled={props.allSelected} onClick={() => { close(); props.onSelectAll(); }}><Icon name="ti-checks" /> {t('selectAll')}</button>
          <button class="menu-item" onClick={() => { close(); props.onClear(); }}><Icon name="ti-x" /> {t('clearSelection')}</button>
        </> : <>
          <button class="menu-item" onClick={() => setView('main')}><Icon name="ti-arrow-left" /> {t('back')}</button>
          <fieldset class="bulk-picker" disabled={saving}>
            <FolderPickerHost folders={props.folders} selected={states.selected} partial={states.partial} onToggle={toggle} onChange={() => {}} />
          </fieldset>
        </>}
      </Dropdown>}
    </span>
  );
}
