import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '../shared/Icon';
import {
  ALL_FOLDER_ID,
  COLORS,
  ICONS,
  INBOX_ID,
  displayName,
  isBuiltinFolder,
  supportsColor,
  type Bookmark,
  type Folder,
} from '../shared/models';
import { countFolder, queryBookmarks, type SortKey } from '../shared/query';
import { formatDate, t } from '../shared/strings';
import { getSettings, updateSettings, type ButtonMode } from '../shared/settings';
import {
  addToFolders,
  createFolder,
  deleteBookmarks,
  deleteFolder,
  exportData,
  getBookmark,
  importData,
  listBookmarks,
  listFolders,
  moveToFolder,
  onDataChanged,
  removeFromFolders,
  reorderFolders,
  restoreBookmarks,
  updateFolder,
  type BookmarkUndo,
} from '../shared/storage';
import { MIME_FOLDER, MIME_POSTS, moveBefore, pruneSelection, rangeIds } from './selection';
import { Confirm, Dropdown, FolderMenu, FolderPickerHost, Toast } from './ui';

const sorts = (): [SortKey, string][] => [
  ['savedDesc', t('sortSavedDesc')],
  ['savedAsc', t('sortSavedAsc')],
  ['postedDesc', t('sortPostedDesc')],
  ['postedAsc', t('sortPostedAsc')],
];

type ConfirmState = { kind: 'posts'; ids: string[] } | { kind: 'folder'; id: string } | null;
type ToastState = { key: number; message: string; undo: BookmarkUndo } | null;

export function App() {
  const SORTS = sorts();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [current, setCurrent] = useState(ALL_FOLDER_ID);
  const [view, setView] = useState<'post' | 'list'>('post');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('savedDesc');
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState<'bookmarks' | 'settings'>(location.hash === '#settings' ? 'settings' : 'bookmarks');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [menu, setMenu] = useState<'add' | 'remove' | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    const [f, b] = await Promise.all([listFolders(), listBookmarks()]);
    setFolders(f);
    setBookmarks(b);
    const existing = new Set(b.map((x) => x.tweetId));
    setSelected((s) => pruneSelection(s, existing));
  };
  useEffect(() => {
    void reload();
    return onDataChanged(() => void reload()); // 別タブ (x.com) での保存も反映
  }, []);

  // 取り消しトースト: 5 秒で消える
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast?.key]);

  const folder = folders.find((f) => f.id === current) ?? folders[0];
  const shown = useMemo(() => queryBookmarks(bookmarks, { folderId: current, search, sort }), [bookmarks, current, search, sort]);
  const shownIds = shown.map((b) => b.tweetId);
  const folderOf = (id: string) => folders.find((f) => f.id === id);
  const realFolders = folders.filter((f) => !isBuiltinFolder(f.id));

  /** 一括操作を実行し、件数が変わったら取り消し付きトーストを出す */
  const run = async (op: Promise<BookmarkUndo>, msgKey: string, withUndo = true) => {
    const undo = await op;
    await reload();
    const n = Object.keys(undo).length;
    if (n > 0 && withUndo) setToast({ key: Date.now(), message: t(msgKey, n), undo });
    else if (n > 0) setToast({ key: Date.now(), message: t(msgKey, n), undo: {} });
  };
  const doUndo = async () => {
    if (!toast) return;
    await restoreBookmarks(toast.undo);
    setToast(null);
    await reload();
  };

  const clearSelection = () => {
    setSelected(new Set());
    setAnchor(null);
  };
  const toggleSelect = (id: string, shift: boolean) => {
    if (shift && anchor) {
      setSelected((s) => new Set([...s, ...rangeIds(shownIds, anchor, id)]));
    } else {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      setAnchor(id);
    }
    setFocusId(id);
  };
  const targetIds = (): string[] => (selected.size ? [...selected] : focusId ? [focusId] : []);

  const onListKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest('input,select,textarea')) return; // 入力欄の操作は邪魔しない
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(shownIds)); // 検索結果内を全選択
      return;
    }
    const curId = el.closest<HTMLElement>('[data-row]')?.dataset.row ?? focusId; // 操作中の行 (無ければ最後にフォーカスした行)
    const idx = curId ? shownIds.indexOf(curId) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = shownIds[Math.min(shownIds.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        setFocusId(next);
        [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].find((r) => r.dataset.row === next)?.focus();
      }
    } else if (e.key === ' ' && el.hasAttribute('data-row') && curId) {
      e.preventDefault();
      toggleSelect(curId, false);
    } else if (e.key === 'Delete' && el.hasAttribute('data-row')) {
      const ids = targetIds();
      if (ids.length) setConfirmState({ kind: 'posts', ids });
    } else if (e.key === 'Escape' && selected.size) {
      clearSelection();
    }
  };

  // ドラッグ&ドロップ: ポスト → フォルダ行 (追加 / Alt で移動)、フォルダ → フォルダ行 (並べ替え)
  const onFolderDrop = async (target: Folder, e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const posts = e.dataTransfer?.getData(MIME_POSTS);
    const dragged = e.dataTransfer?.getData(MIME_FOLDER);
    if (posts && !isBuiltinFolder(target.id)) {
      const ids = JSON.parse(posts) as string[];
      if (e.altKey) await run(moveToFolder(ids, current, target.id), 'toastMoved');
      else await run(addToFolders(ids, [target.id]), 'toastAdded');
    } else if (dragged && !isBuiltinFolder(target.id) && target.id !== INBOX_ID) {
      const order = realFolders.filter((f) => f.id !== INBOX_ID).map((f) => f.id);
      await reorderFolders(moveBefore(order, dragged, target.id));
      await reload();
    }
  };
  const folderDroppable = (f: Folder, types: readonly string[]) =>
    (types.includes(MIME_POSTS) && !isBuiltinFolder(f.id)) ||
    (types.includes(MIME_FOLDER) && !isBuiltinFolder(f.id) && f.id !== INBOX_ID);

  const bulkIds = [...selected];
  const removableFolders = realFolders.filter((f) => bookmarks.some((b) => selected.has(b.tweetId) && b.folderIds.includes(f.id)));

  return (
    <div class="ps">
      <aside class="side">
        <div class="side-title">{t('foldersHeading')}</div>
        {folders.map((f) => {
          const reorderable = !isBuiltinFolder(f.id) && f.id !== INBOX_ID;
          return (
            <div
              key={f.id}
              class={`fr${f.id === current && page === 'bookmarks' ? ' on' : ''}${dragOver === f.id ? ' drop' : ''}`}
              role="button"
              tabIndex={0}
              aria-current={f.id === current && page === 'bookmarks' ? 'true' : undefined}
              title={isBuiltinFolder(f.id) ? undefined : t('dragHint')}
              draggable={reorderable}
              onDragStart={(e) => {
                e.dataTransfer?.setData(MIME_FOLDER, f.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!folderDroppable(f, e.dataTransfer?.types ?? [])) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = e.altKey ? 'move' : 'copy';
                setDragOver(f.id);
              }}
              onDragLeave={() => setDragOver((d) => (d === f.id ? null : d))}
              onDrop={(e) => void onFolderDrop(f, e)}
              onClick={() => {
                setCurrent(f.id);
                setEditing(false);
                setPage('bookmarks');
                clearSelection();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).click();
                }
              }}
            >
              <Icon name={f.icon} color={f.color} />
              <span class="fr-name">{displayName(f)}</span>
              <span class="n">{countFolder(bookmarks, f.id)}</span>
            </div>
          );
        })}
        <div
          class="fr add"
          role="button"
          tabIndex={0}
          onClick={async () => {
            const f = await createFolder({ name: t('newFolder') });
            await reload();
            setCurrent(f.id);
            setEditing(true);
            setPage('bookmarks');
          }}
        >
          <Icon name="ti-plus" />
          {t('newFolder')}
        </div>
        <div
          class={`fr${page === 'settings' ? ' on' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => setPage('settings')}
        >
          <Icon name="ti-settings" />
          {t('settings')}
        </div>
        <div class="io">
          <button onClick={() => downloadJson(exportData)}>{t('exportBtn')}</button>
          <label class="file-btn">
            {t('importBtn')}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                if (!file) return;
                try {
                  alert(t('importDone', await importData(JSON.parse(await file.text()))));
                } catch {
                  alert(t('importFail'));
                }
                input.value = '';
                await reload();
              }}
            />
          </label>
        </div>
      </aside>
      <main class="main">
        {page === 'settings' ? (
          <SettingsPage />
        ) : (
          <>
            <div class="bar">
              {folder && <Icon name={folder.icon} color={folder.color} />}
              {folder && <span class="bar-name">{displayName(folder)}</span>}
              {folder && !isBuiltinFolder(folder.id) && (
                <button class="icon-only" aria-label={t('edit')} title={t('edit')} onClick={() => setEditing(!editing)}>
                  <Icon name="ti-edit" />
                </button>
              )}
              <div class="seg">
                <button class={view === 'post' ? 'on' : ''} aria-pressed={view === 'post'} onClick={() => setView('post')}>
                  {t('postView')}
                </button>
                <button class={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                  {t('listView')}
                </button>
              </div>
            </div>
            <div class="tools">
              <input
                type="search"
                placeholder={t('search')}
                aria-label={t('search')}
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
              />
              <select aria-label={t('sortLabel')} value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
                {SORTS.map(([k, l]) => (
                  <option value={k}>{l}</option>
                ))}
              </select>
            </div>
            {selected.size > 0 && (
              <div class="bulk" role="toolbar">
                <strong>{t('selectedCount', selected.size)}</strong>
                <span class="menu-anchor">
                  <button onClick={() => setMenu(menu === 'add' ? null : 'add')}>
                    <Icon name="ti-folder-plus" /> {t('bulkAdd')}
                  </button>
                  {menu === 'add' && (
                    <FolderMenu
                      label={t('bulkAdd')}
                      folders={realFolders}
                      onClose={() => setMenu(null)}
                      onPick={(id) => {
                        setMenu(null);
                        void run(addToFolders(bulkIds, [id]), 'toastAdded');
                      }}
                    />
                  )}
                </span>
                <span class="menu-anchor">
                  <button onClick={() => setMenu(menu === 'remove' ? null : 'remove')}>
                    <Icon name="ti-folder-minus" /> {t('bulkRemove')}
                  </button>
                  {menu === 'remove' && (
                    <FolderMenu
                      label={t('bulkRemove')}
                      folders={removableFolders}
                      onClose={() => setMenu(null)}
                      onPick={(id) => {
                        setMenu(null);
                        void run(removeFromFolders(bulkIds, [id]), 'toastRemoved');
                      }}
                    />
                  )}
                </span>
                <button class="danger" onClick={() => setConfirmState({ kind: 'posts', ids: bulkIds })}>
                  <Icon name="ti-trash" /> {t('delete')}
                </button>
                <button class="bulk-clear" onClick={clearSelection}>
                  {t('clearSelection')}
                </button>
              </div>
            )}
            {editing && folder && !isBuiltinFolder(folder.id) && (
              <EditPanel
                key={folder.id}
                folder={folder}
                onDone={async () => {
                  setEditing(false);
                  await reload();
                }}
                onRequestDelete={() => setConfirmState({ kind: 'folder', id: folder.id })}
              />
            )}
            {shown.length === 0 && <p class="empty">{t('empty')}</p>}
            <div class="rows" ref={listRef} onKeyDown={onListKeyDown} role="list">
              {shown.map((b) => (
                <Row
                  key={b.tweetId}
                  b={b}
                  view={view}
                  selected={selected.has(b.tweetId)}
                  tabbable={focusId && shownIds.includes(focusId) ? focusId === b.tweetId : b.tweetId === shownIds[0]}
                  folderOf={folderOf}
                  pickerOpen={picker === b.tweetId}
                  onSelect={(shift) => toggleSelect(b.tweetId, shift)}
                  onFocus={() => setFocusId(b.tweetId)}
                  onRemoveFromFolder={(fid) => void run(removeFromFolders([b.tweetId], [fid]), 'toastRemoved')}
                  onTogglePicker={() => setPicker(picker === b.tweetId ? null : b.tweetId)}
                  onDelete={() => setConfirmState({ kind: 'posts', ids: [b.tweetId] })}
                  onDragStart={(e) => {
                    const ids = selected.has(b.tweetId) ? [...selected] : [b.tweetId];
                    e.dataTransfer?.setData(MIME_POSTS, JSON.stringify(ids));
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
                  }}
                  pickerNode={
                    picker === b.tweetId ? (
                      <Dropdown onClose={() => setPicker(null)} label={t('changeFolder')} class="menu-wide">
                        <FolderPickerHost
                          folders={realFolders}
                          selected={b.folderIds}
                          onChange={async (sel) => {
                            const cur = new Set((await getBookmark(b.tweetId))?.folderIds ?? []);
                            const add = [...sel].filter((id) => !cur.has(id));
                            const rem = [...cur].filter((id) => !sel.has(id));
                            if (add.length) await addToFolders([b.tweetId], add);
                            if (rem.length) await removeFromFolders([b.tweetId], rem);
                            await reload();
                          }}
                        />
                      </Dropdown>
                    ) : null
                  }
                />
              ))}
            </div>
          </>
        )}
      </main>
      {confirmState && (
        <Confirm
          message={confirmState.kind === 'posts' ? t('confirmDeletePosts', confirmState.ids.length) : t('confirmDelete')}
          confirmLabel={t('delete')}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => {
            const c = confirmState;
            setConfirmState(null);
            if (c.kind === 'posts') {
              await run(deleteBookmarks(c.ids), 'toastDeleted');
              setSelected((s) => new Set([...s].filter((id) => !c.ids.includes(id))));
            } else {
              await deleteFolder(c.id);
              if (current === c.id) setCurrent(ALL_FOLDER_ID);
              setEditing(false);
              await reload();
            }
          }}
        />
      )}
      {toast && <Toast message={toast.message} onUndo={() => void doUndo()} />}
    </div>
  );
}

function SettingsPage() {
  const [sync, setSync] = useState(false);
  const [bmode, setBmode] = useState<ButtonMode>('separate');
  useEffect(() => {
    void getSettings().then((s) => {
      setSync(s.syncNative);
      setBmode(s.buttonMode);
    });
  }, []);
  return (
    <section>
      <div class="bar">
        <Icon name="ti-settings" />
        <span class="bar-name">{t('settings')}</span>
      </div>
      <label class="setting">
        <input
          type="checkbox"
          role="switch"
          checked={sync}
          onChange={async (e) => setSync((await updateSettings({ syncNative: (e.target as HTMLInputElement).checked })).syncNative)}
        />
        <span>
          <strong>{t('syncNativeLabel')}</strong>
          <span class="muted setting-desc">{t('syncNativeDesc')}</span>
        </span>
      </label>
      <fieldset class="setting-group">
        <legend>{t('buttonModeHeading')}</legend>
        {(['separate', 'replace'] as const).map((m) => (
          <label class="setting">
            <input
              type="radio"
              name="buttonMode"
              checked={bmode === m}
              onChange={async () => setBmode((await updateSettings({ buttonMode: m })).buttonMode)}
            />
            <span>{t(m === 'separate' ? 'buttonModeSeparate' : 'buttonModeReplace')}</span>
          </label>
        ))}
        <p class="muted setting-desc">{t('buttonModeNote')}</p>
      </fieldset>
    </section>
  );
}

function Row(props: {
  b: Bookmark;
  view: 'post' | 'list';
  selected: boolean;
  tabbable: boolean;
  folderOf: (id: string) => Folder | undefined;
  pickerOpen: boolean;
  pickerNode: JSX.Element | null;
  onSelect: (shift: boolean) => void;
  onFocus: () => void;
  onRemoveFromFolder: (folderId: string) => void;
  onTogglePicker: () => void;
  onDelete: () => void;
  onDragStart: (e: DragEvent) => void;
}) {
  const { b, view, folderOf } = props;
  const s = b.snapshot;
  const first = folderOf(b.folderIds[0]);
  const actions = (
    <span class="row-actions">
      <span class="menu-anchor">
        <button class="icon-btn" aria-label={t('changeFolder')} title={t('changeFolder')} aria-expanded={props.pickerOpen} onClick={props.onTogglePicker}>
          <Icon name="ti-folders" />
        </button>
        {props.pickerNode}
      </span>
      <button class="icon-btn" aria-label={t('deletePost')} title={t('deletePost')} onClick={props.onDelete}>
        <Icon name="ti-trash" />
      </button>
      <a class="icon-btn" href={s.url} target="_blank" rel="noopener noreferrer" title={t('openOnX')} aria-label={t('openOnX')}>
        <Icon name="ti-external-link" />
      </a>
    </span>
  );
  const check = (
    <input
      type="checkbox"
      class="sel"
      aria-label={t('selectPost')}
      checked={props.selected}
      onClick={(e) => props.onSelect((e as MouseEvent).shiftKey)}
      onChange={() => {}}
    />
  );
  const cls = `${view === 'post' ? 'post' : 'mini'}${props.selected ? ' selected' : ''}`;
  const common = {
    'data-row': b.tweetId,
    class: cls,
    role: 'listitem',
    tabIndex: props.tabbable ? 0 : -1,
    draggable: true,
    onDragStart: props.onDragStart,
    onFocus: props.onFocus,
  } as const;
  if (view === 'list') {
    return (
      <div {...common}>
        {check}
        {first ? <Icon name={first.icon} color={first.color} /> : <Icon name="ti-bookmark" />}
        <span class="handle">{s.handle}</span>
        <span class="t">{s.text}</span>
        {actions}
      </div>
    );
  }
  return (
    <article {...common}>
      {check}
      {s.avatar ? <img class="av" src={s.avatar} alt="" /> : <span class="av">{initials(s.author)}</span>}
      <div class="post-body">
        <div class="post-head">
          <strong>{s.author}</strong> <span class="muted">{s.handle}</span>
          {s.createdAt && <span class="muted"> · {formatDate(s.createdAt)}</span>}
        </div>
        <div class="text">{s.text}</div>
        {s.media.length > 0 && (
          <div class="media">
            {s.media.map((m) => (
              <img src={m} alt="" loading="lazy" />
            ))}
          </div>
        )}
        <div class="act">
          {b.folderIds.map((id) => {
            const f = folderOf(id);
            if (!f) return null;
            const only = b.folderIds.length === 1 && id === INBOX_ID; // 未分類しか無いときは外す意味がない
            const label = t('removeFromFolder', displayName(f));
            return only ? (
              <span class="tag" style={f.color ? { color: f.color } : undefined}>
                <Icon name={f.icon} /> {displayName(f)}
              </span>
            ) : (
              <button class="tag chip" style={f.color ? { color: f.color } : undefined} title={label} aria-label={label} onClick={() => props.onRemoveFromFolder(id)}>
                <Icon name={f.icon} /> {displayName(f)} <Icon name="ti-x" />
              </button>
            );
          })}
        </div>
      </div>
      {actions}
    </article>
  );
}

const initials = (name: string) => [...name.trim()].slice(0, 2).join('').toUpperCase();

function EditPanel({ folder, onDone, onRequestDelete }: { folder: Folder; onDone: () => void; onRequestDelete: () => void }) {
  const [name, setName] = useState(displayName(folder));
  const [icon, setIcon] = useState(folder.icon);
  const [color, setColor] = useState<string | undefined>(folder.color);
  const [error, setError] = useState('');
  const colorOk = supportsColor(icon);

  const save = async () => {
    try {
      await updateFolder(folder.id, { name, icon, color: colorOk ? (color ?? null) : null });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section class="edit">
      <div class="erow">
        <span class="elabel">{t('name')}</span>
        <input class="grow" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </div>
      <div class="erow wrap">
        <span class="elabel">{t('icon')}</span>
        {ICONS.slice(0, 8).map((i) => (
          <button class={`ic${i === icon ? ' on' : ''}`} aria-label={i} onClick={() => setIcon(i)}>
            <Icon name={i} />
          </button>
        ))}
      </div>
      <div class={`erow${colorOk ? '' : ' disabled'}`} title={colorOk ? '' : t('colorOnlyFolder')}>
        <span class="elabel">{t('color')}</span>
        {COLORS.map((c) => (
          <button
            class={`sw${c === color ? ' on' : ''}`}
            style={{ background: c }}
            aria-label={c}
            disabled={!colorOk}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      {error && <p class="error">{error}</p>}
      <div class="erow">
        <button class="primary" onClick={save}>{t('save')}</button>
        <button onClick={() => onDone()}>{t('cancel')}</button>
        <button class="danger" onClick={onRequestDelete}>
          {t('delete')}
        </button>
      </div>
    </section>
  );
}

async function downloadJson(make: typeof exportData): Promise<void> {
  const blob = new Blob([JSON.stringify(await make(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `postshelf-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
