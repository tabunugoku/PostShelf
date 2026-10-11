import { useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '../shared/Icon';
import type { Bookmark, Folder } from '../shared/models';
import { t } from '../shared/strings';
import { Dropdown, FolderPickerHost } from './ui';

type FolderStates = { selected: string[]; partial: Set<string> };

/** 管理画面とサイドパネル共通の一括操作。フォルダの下書きは確定するまで保存しない。 */
export function BulkMenu(props: {
  count: number;
  folders: Folder[];
  bookmarks: Bookmark[];
  onConfirm: (addIds: string[], removeIds: string[]) => Promise<boolean>;
  onDelete: () => void;
  onSelectAll: () => void;
  allSelected: boolean;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'folders'>('main');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<FolderStates>({ selected: [], partial: new Set() });
  const draftRef = useRef(draft);
  const original = useRef(draft);
  const busy = useRef(false);
  const states = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of props.bookmarks) for (const id of new Set(b.folderIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return {
      selected: [...counts].filter(([, n]) => n === props.bookmarks.length).map(([id]) => id),
      partial: new Set([...counts].filter(([, n]) => n < props.bookmarks.length).map(([id]) => id)),
    };
  }, [props.bookmarks]);
  const discard = () => { setView('main'); setError(''); };
  const close = () => { if (!busy.current) { setOpen(false); discard(); } };
  const folders = () => {
    original.current = states;
    draftRef.current = { selected: [...states.selected], partial: new Set(states.partial) };
    setDraft(draftRef.current); setError(''); setView('folders');
  };
  const toggle = (id: string, on: boolean) => {
    if (busy.current) return;
    const selected = new Set(draftRef.current.selected);
    const partial = new Set(draftRef.current.partial);
    partial.delete(id);
    if (on) selected.add(id); else selected.delete(id);
    draftRef.current = { selected: [...selected], partial };
    setDraft(draftRef.current);
  };
  const confirm = async () => {
    if (busy.current) return;
    const current = draftRef.current;
    const before = original.current;
    const addIds = current.selected.filter(id => !before.selected.includes(id));
    const removeIds = [...before.selected, ...before.partial].filter(id => !current.selected.includes(id) && !current.partial.has(id));
    if (!addIds.length && !removeIds.length) return close();
    busy.current = true; setSaving(true); setError('');
    try {
      if (await props.onConfirm(addIds, removeIds)) {
        busy.current = false; close();
      } else setError(t('errorStorage'));
    } catch { setError(t('errorStorage')); }
    finally { busy.current = false; setSaving(false); }
  };
  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const checkbox = target instanceof HTMLInputElement && target.type === 'checkbox';
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || target.closest('button,a[href],form')
      || (!checkbox && target.closest('input,textarea,select,[contenteditable=true]'))) return;
    e.preventDefault();
    if (!e.repeat) void confirm();
  };
  return (
    <span class="menu-anchor bulk-anchor">
      <button class="bulk-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <strong>{t('selectedCount', props.count)}</strong><Icon name="ti-chevron-down" />
      </button>
      {open && <Dropdown onClose={close} label={t('bulkMenuLabel')} class={view === 'folders' ? 'menu-bulk menu-wide' : 'menu-bulk'}>
        {view === 'main' ? <>
          <button class="menu-item" onClick={folders}><Icon name="ti-folder-plus" /> {t('changeFolder')}</button>
          <button class="menu-item danger-text" onClick={() => { close(); props.onDelete(); }}><Icon name="ti-trash" /> {t('delete')}</button>
          <button class="menu-item" disabled={props.allSelected} onClick={() => { close(); props.onSelectAll(); }}><Icon name="ti-checks" /> {t('selectAll')}</button>
          <button class="menu-item" onClick={() => { close(); props.onClear(); }}><Icon name="ti-x" /> {t('clearSelection')}</button>
        </> : <div onKeyDown={onKey}>
          <button class="menu-item" disabled={saving} onClick={discard}><Icon name="ti-arrow-left" /> {t('back')}</button>
          <fieldset class="bulk-picker" disabled={saving}>
            <FolderPickerHost folders={props.folders} selected={draft.selected} partial={draft.partial} onToggle={toggle} onChange={() => {}} />
          </fieldset>
          {error && <div class="error" role="alert">{error}</div>}
          <div class="bulk-actions"><button class="primary triage-confirm" aria-keyshortcuts="Enter" disabled={saving} onClick={() => void confirm()}>{t('triageConfirm')}</button></div>
        </div>}
      </Dropdown>}
    </span>
  );
}
