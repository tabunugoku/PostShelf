import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '../shared/Icon';
import { ALL_FOLDER_ID, INBOX_ID, displayName, isBuiltinFolder, type Bookmark, type Folder } from '../shared/models';
import {
  RECENT_ID,
  authorHandles,
  countFolder,
  hasActiveFilters,
  queryBookmarks,
  type Filters,
  type SortKey,
} from '../shared/query';
import { t } from '../shared/strings';
import {
  dismissImportHint,
  getImportHint,
  getSettings,
  onImportHintChanged,
  shouldShowImportHint,
  updateSettings,
  type ViewMode,
} from '../shared/settings';
import { hasSidePanel, openManagerTab, openSidePanel } from '../shared/panel';
import {
  addToFolders,
  createFolder,
  deleteBookmarks,
  deleteFolder,
  getBookmark,
  listBookmarks,
  listFolders,
  moveToFolder,
  onDataChanged,
  removeFromFolders,
  reorderFolders,
  restoreBookmarks,
  type BookmarkUndo,
} from '../shared/storage';
import { MIME_FOLDER, MIME_POSTS, moveBefore, pruneSelection, rangeIds } from './selection';
import { Confirm, Dropdown, FolderMenu, FolderPickerHost, InfoDialog, SortMenu, Toast } from './ui';
import { Card } from './Cards';
import { FolderEdit } from './FolderEdit';
import { SaveCurrent } from './SaveCurrent';
import { SettingsPage } from './Settings';
import { useCompact } from './useCompact';

const sorts = (): [SortKey, string][] => [
  ['savedDesc', t('sortSavedDesc')],
  ['savedAsc', t('sortSavedAsc')],
  ['postedDesc', t('sortPostedDesc')],
  ['postedAsc', t('sortPostedAsc')],
];

type ConfirmState = { kind: 'posts'; ids: string[] } | { kind: 'folder'; id: string } | null;
type ToastState = { key: number; message: string; undo: BookmarkUndo } | null;

/** 「未分類」は保存データにまだ無くても常にスマートビューに出す。アイコンは受け皿らしく inbox に統一する */
const inboxView = (stored?: Folder): Folder => ({ id: INBOX_ID, name: stored?.name ?? '', icon: 'ti-inbox', order: -1, color: stored?.color });
const recentView = (): Folder => ({ id: RECENT_ID, name: t('recent7'), icon: 'ti-clock', order: -1 });

export function App({ surface = 'tab' }: { surface?: 'tab' | 'sidepanel' }) {
  const compact = useCompact();
  const SORTS = sorts();
  const [ready, setReady] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [current, setCurrent] = useState(ALL_FOLDER_ID);
  const [view, setView] = useState<ViewMode>('post');
  const [sort, setSort] = useState<SortKey>('savedDesc');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState<'bookmarks' | 'settings'>(location.hash === '#settings' ? 'settings' : 'bookmarks');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [menu, setMenu] = useState<'add' | 'remove' | 'author' | 'folders' | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);
  const [bannerOn, setBannerOn] = useState(false);
  const [pending, setPending] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    const [f, b] = await Promise.all([listFolders(), listBookmarks()]);
    setFolders(f);
    setBookmarks(b);
    const existing = new Set(b.map((x) => x.tweetId));
    setSelected((s) => pruneSelection(s, existing));
  };
  const loadHint = async () => {
    const h = await getImportHint();
    setPending(h.pending);
    setBannerOn(shouldShowImportHint(h));
  };
  useEffect(() => {
    void (async () => {
      const [s] = await Promise.all([getSettings(), reload(), loadHint()]);
      setCurrent(s.lastFolderId);
      setView(s.viewMode);
      setSort(s.sortKey);
      setReady(true);
    })();
    const offs = [onDataChanged(() => void reload()), onImportHintChanged(() => void loadHint())]; // 別タブ (x.com) での保存・取り込みも反映
    return () => offs.forEach((o) => o());
  }, []);

  // 最後に開いたフォルダ / 表示形式 / 並べ替えを chrome.storage.local に保存 (localStorage は使わない)
  const chooseView = (id: string) => {
    setCurrent(id);
    setPage('bookmarks');
    setSelected(new Set());
    setFilters({});
    setEditing(null);
    setMenu(null);
    void updateSettings({ lastFolderId: id });
  };
  const chooseMode = (m: ViewMode) => {
    setView(m);
    void updateSettings({ viewMode: m });
  };
  const chooseSort = (s: SortKey) => {
    setSort(s);
    void updateSettings({ sortKey: s });
  };

  // 取り込み案内バナーの「閉じる」: 閉じた時点の件数を保存し、件数が増えるまで出さない
  const dismissBanner = () => {
    setBannerOn(false);
    void dismissImportHint();
  };

  // 取り消しトースト: 5 秒で消える
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast?.key]);

  const storedInbox = folders.find((f) => f.id === INBOX_ID);
  const userFolders = folders.filter((f) => !isBuiltinFolder(f.id) && f.id !== INBOX_ID);
  const smartViews: Folder[] = [folders[0] ?? { id: ALL_FOLDER_ID, name: '', icon: 'ti-bookmarks', order: -1 }, inboxView(storedInbox), recentView()];
  const allViews = [...smartViews, ...userFolders];
  const curFolder = allViews.find((f) => f.id === current) ?? smartViews[0];
  /** バッジ・チップ・ピッカー用。「未分類」の見た目を統一する */
  const folderOf = (id: string) => (id === INBOX_ID ? inboxView(storedInbox) : folders.find((f) => f.id === id));
  const pickerFolders = [inboxView(storedInbox), ...userFolders];

  const now = Date.now();
  const shown = useMemo(
    () => queryBookmarks(bookmarks, { folderId: curFolder.id, search, sort, filters, now }),
    [bookmarks, curFolder.id, search, sort, filters],
  );
  const shownIds = shown.map((b) => b.tweetId);
  const viewName = curFolder.id === RECENT_ID ? curFolder.name : displayName(curFolder);
  const count = (id: string) => countFolder(bookmarks, id, now);
  const authors = useMemo(() => authorHandles(bookmarks), [bookmarks]);

  /** 一括操作を実行し、件数が変わったら取り消し付きトーストを出す */
  const run = async (op: Promise<BookmarkUndo>, msgKey: string) => {
    const undo = await op;
    await reload();
    const n = Object.keys(undo).length;
    if (n > 0) setToast({ key: Date.now(), message: t(msgKey, n), undo });
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
  const virtual = (id: string) => id === ALL_FOLDER_ID || id === RECENT_ID;
  const onFolderDrop = async (target: Folder, e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const posts = e.dataTransfer?.getData(MIME_POSTS);
    const dragged = e.dataTransfer?.getData(MIME_FOLDER);
    if (posts && !virtual(target.id)) {
      const ids = JSON.parse(posts) as string[];
      if (e.altKey) await run(moveToFolder(ids, virtual(current) ? null : current, target.id), 'toastMoved');
      else await run(addToFolders(ids, [target.id]), 'toastAdded');
    } else if (dragged && !virtual(target.id) && target.id !== INBOX_ID) {
      const order = userFolders.map((f) => f.id);
      await reorderFolders(moveBefore(order, dragged, target.id));
      await reload();
    }
  };
  const folderDroppable = (f: Folder, types: readonly string[]) =>
    (types.includes(MIME_POSTS) && !virtual(f.id)) || (types.includes(MIME_FOLDER) && !virtual(f.id) && f.id !== INBOX_ID);

  const bulkIds = [...selected];
  const removableFolders = [inboxView(storedInbox), ...userFolders].filter((f) => bookmarks.some((b) => selected.has(b.tweetId) && b.folderIds.includes(f.id)));

  const editNode = (f: Folder) =>
    editing === f.id && (
      <Dropdown onClose={() => setEditing(null)} label={t('folderMore')} class="menu-wide">
        <FolderEdit folder={f} onSaved={() => void reload()} onRequestDelete={() => { setEditing(null); setConfirmState({ kind: 'folder', id: f.id }); }} />
      </Dropdown>
    );

  const viewRow = (f: Folder, opts: { smart?: boolean } = {}) => {
    const reorderable = !opts.smart;
    const n = count(f.id);
    const label = f.id === RECENT_ID ? f.name : displayName(f);
    return (
      <div
        key={f.id}
        class={`fr${f.id === curFolder.id && page === 'bookmarks' ? ' on' : ''}${dragOver === f.id ? ' drop' : ''}`}
        role="button"
        tabIndex={0}
        aria-current={f.id === curFolder.id && page === 'bookmarks' ? 'true' : undefined}
        title={virtual(f.id) ? undefined : t('dragHint')}
        draggable={reorderable && editing !== f.id}
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
        onClick={() => chooseView(f.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            chooseView(f.id);
          }
        }}
      >
        <Icon name={f.icon} color={f.color} />
        <span class="fr-name">{label}</span>
        {f.id === INBOX_ID && n > 0 ? <span class="badge">{n}</span> : <span class="n">{n}</span>}
        {reorderable && (
          <span class="menu-anchor more" onClick={(e) => e.stopPropagation()}>
            <button
              class="icon-btn more-btn"
              aria-label={`${t('folderMore')}: ${label}`}
              title={t('folderMore')}
              aria-expanded={editing === f.id}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(editing === f.id ? null : f.id);
              }}
            >
              <Icon name="ti-dots" />
            </button>
            {editNode(f)}
          </span>
        )}
      </div>
    );
  };

  const newFolder = async () => {
    const f = await createFolder({ name: t('newFolder') });
    await reload();
    chooseView(f.id);
    setEditing(f.id);
  };

  // ---- 共通パーツ ----
  const searchBox = (
    <label class="search">
      <Icon name="ti-search" />
      <input
        type="search"
        placeholder={t('searchPlaceholder')}
        aria-label={t('search')}
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
      />
    </label>
  );
  const viewSeg = (
    <div class="seg" role="group" aria-label={t('viewLabel')}>
      {(
        [
          ['post', 'ti-layout-list', t('postView')],
          ['list', 'ti-list', t('listView')],
          ['grid', 'ti-layout-grid', t('gridView')],
        ] as const
      ).map(([m, icon, label]) => (
        <button class={view === m ? 'on' : ''} aria-pressed={view === m} aria-label={label} title={label} onClick={() => chooseMode(m)}>
          <Icon name={icon} />
        </button>
      ))}
    </div>
  );
  const sortMenu = <SortMenu label={t('sortLabel')} value={sort} options={SORTS} onChange={chooseSort} />;
  /** サイドパネルの「タブで開く」。タブ側の「サイドパネルで開く」はサイドバー下部 (広い) に置く */
  const switchIcons =
    surface === 'sidepanel' ? (
      <button class="icon-btn bordered" aria-label={t('openInTab')} title={t('openInTab')} onClick={() => void openManagerTab()}>
        <Icon name="ti-external-link" />
      </button>
    ) : null;

  const banner = bannerOn && page === 'bookmarks' && !compact && (
    <div class="banner" role="region" aria-label={t('importHow')}>
      <Icon name="ti-download" />
      <span>{t('importBanner', pending)}</span>
      <button class="banner-btn" onClick={() => setShowHow(true)}>
        {t('importHow')}
      </button>
      <button class="icon-btn" aria-label={t('dismiss')} title={t('dismiss')} onClick={dismissBanner}>
        <Icon name="ti-x" />
      </button>
    </div>
  );

  const chips = (
    <div class="chips" role="group" aria-label={t('filterAuthor')}>
      {(
        [
          ['image', 'ti-photo', t('filterImage')],
          ['video', 'ti-video', t('filterVideo')],
          ['link', 'ti-link', t('filterLink')],
        ] as const
      ).map(([k, icon, label]) => (
        <button class={`chip filter${filters[k] ? ' on' : ''}`} aria-pressed={!!filters[k]} onClick={() => setFilters({ ...filters, [k]: !filters[k] })}>
          <Icon name={icon} /> {label}
        </button>
      ))}
      <span class="menu-anchor">
        <button
          class={`chip filter${filters.handle ? ' on' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menu === 'author'}
          onClick={() => setMenu(menu === 'author' ? null : 'author')}
        >
          <Icon name="ti-user" /> {filters.handle ?? t('filterAuthor')}
          {filters.handle && (
            <span
              role="button"
              aria-label={t('clearFilters')}
              class="x"
              onClick={(e) => {
                e.stopPropagation();
                setFilters({ ...filters, handle: undefined });
              }}
            >
              <Icon name="ti-x" />
            </span>
          )}
        </button>
        {menu === 'author' && (
          <Dropdown onClose={() => setMenu(null)} label={t('filterAuthor')} class="menu-scroll">
            {authors.map((a) => (
              <button
                class="menu-item"
                aria-pressed={filters.handle === a.handle}
                onClick={() => {
                  setFilters({ ...filters, handle: filters.handle === a.handle ? undefined : a.handle });
                  setMenu(null);
                }}
              >
                <span class="fr-name">{a.handle}</span>
                <span class="n">{a.count}</span>
              </button>
            ))}
          </Dropdown>
        )}
      </span>
    </div>
  );

  const bulk = selected.size > 0 && (
    <div class="bulk" role="toolbar">
      <strong>{t('selectedCount', selected.size)}</strong>
      <span class="menu-anchor">
        <button onClick={() => setMenu(menu === 'add' ? null : 'add')}>
          <Icon name="ti-folder-plus" /> {t('bulkAdd')}
        </button>
        {menu === 'add' && (
          <FolderMenu
            label={t('bulkAdd')}
            folders={pickerFolders}
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
  );

  const searching = search.trim() !== '' || hasActiveFilters(filters);
  const empty =
    shown.length === 0 &&
    (bookmarks.length === 0 ? (
      <div class="empty-state">
        <Icon name="ti-bookmarks" />
        <div class="empty-title">{t('noPostsTitle')}</div>
        <div>{t('noPostsHint')}</div>
      </div>
    ) : searching ? (
      <div class="empty-state">
        <Icon name="ti-search" />
        <div class="empty-title">{t('notFoundTitle')}</div>
        <div>{t('notFoundHint')}</div>
        <button
          onClick={() => {
            setSearch('');
            setFilters({});
          }}
        >
          {t('clearFilters')}
        </button>
      </div>
    ) : (
      <p class="empty">{t('empty')}</p>
    ));

  const rows = (
    <div class={`rows view-${view}${compact ? ' compact' : ''}`} ref={listRef} onKeyDown={onListKeyDown} role="list">
      {shown.map((b) => (
        <Card
          key={b.tweetId}
          b={b}
          view={view}
          compact={compact}
          selected={selected.has(b.tweetId)}
          selectionActive={selected.size > 0}
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
                  folders={pickerFolders}
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
  );

  const body = (
    <>
      {banner}
      {chips}
      {bulk}
      {empty}
      {rows}
    </>
  );

  const dialogs = (
    <>
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
              if (current === c.id) chooseView(ALL_FOLDER_ID);
              await reload();
            }
          }}
        />
      )}
      {showHow && <InfoDialog title={t('importHowTitle')} body={t('importHowSteps')} onClose={() => setShowHow(false)} />}
      {toast && <Toast message={toast.message} onUndo={() => void doUndo()} />}
    </>
  );

  if (!ready) return <div class={`app surface-${surface}`} />;

  const settingsPage = <SettingsPage onChanged={() => void reload()} />;

  // ===== 狭いレイアウト (サイドパネル向け): 1 つのフォルダボタン + 検索 + 横スクロールのチップ =====
  if (compact) {
    return (
      <div class={`app layout-narrow surface-${surface}`}>
        <header class="phead">
          <div class="row">
            <span class="menu-anchor grow">
              <button
                class="folder-btn"
                aria-haspopup="menu"
                aria-expanded={menu === 'folders'}
                aria-label={`${t('chooseFolderMenu')}: ${viewName}`}
                onClick={() => setMenu(menu === 'folders' ? null : 'folders')}
              >
                <span class="fb-main">
                  <Icon name={page === 'settings' ? 'ti-settings' : curFolder.icon} color={page === 'settings' ? undefined : curFolder.color} />
                  <span class="fr-name">{page === 'settings' ? t('settings') : viewName}</span>
                  {page === 'bookmarks' && <span class="muted">{shown.length === count(curFolder.id) ? count(curFolder.id) : `${shown.length}/${count(curFolder.id)}`}</span>}
                </span>
                <Icon name="ti-chevron-down" />
              </button>
              {menu === 'folders' && (
                <Dropdown onClose={() => setMenu(null)} label={t('chooseFolderMenu')} class="menu-wide menu-left">
                  {allViews.map((f) => (
                    <button class={`menu-item${f.id === curFolder.id && page === 'bookmarks' ? ' current' : ''}`} onClick={() => chooseView(f.id)}>
                      <Icon name={f.icon} color={f.color} />
                      <span class="fr-name">{f.id === RECENT_ID ? f.name : displayName(f)}</span>
                      <span class="n">{count(f.id)}</span>
                    </button>
                  ))}
                  <button class="menu-item" onClick={() => { setMenu(null); void newFolder(); }}>
                    <Icon name="ti-plus" /> {t('newFolder')}
                  </button>
                  <button class="menu-item" onClick={() => { setMenu(null); setPage('settings'); }}>
                    <Icon name="ti-settings" /> {t('settings')}
                  </button>
                </Dropdown>
              )}
            </span>
            <button class="icon-btn bordered" aria-label={t('searchShow')} title={t('search')} aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>
              <Icon name="ti-search" />
            </button>
            {switchIcons}
          </div>
          {searchOpen && searchBox}
          <div class="scroll" role="group" aria-label={t('foldersHeading')}>
            {allViews.map((f) => (
              <button class={`chip${f.id === curFolder.id && page === 'bookmarks' ? ' on' : ''}`} aria-pressed={f.id === curFolder.id && page === 'bookmarks'} onClick={() => chooseView(f.id)}>
                <Icon name={f.icon} color={f.color} />
                {f.id === RECENT_ID ? f.name : displayName(f)}
                {f.id === INBOX_ID && count(f.id) > 0 && <span class="badge">{count(f.id)}</span>}
              </button>
            ))}
          </div>
        </header>
        <main class="pbody">
          {page === 'settings' ? (
            settingsPage
          ) : (
            <>
              <div class="tools">
                {sortMenu}
                {viewSeg}
              </div>
              {body}
            </>
          )}
        </main>
        {surface === 'sidepanel' && <SaveCurrent folders={pickerFolders} onSaved={() => void reload()} />}
        {dialogs}
      </div>
    );
  }

  // ===== 広いレイアウト (タブ): サイドバー + メイン =====
  return (
    <div class={`app layout-wide surface-${surface}`}>
      <aside class="side">
        <div class="sec">{t('smartViews')}</div>
        {smartViews.map((f) => viewRow(f, { smart: true }))}
        <div class="sec">{t('foldersSection')}</div>
        {userFolders.map((f) => viewRow(f))}
        <div class="fr add" role="button" tabIndex={0} onClick={() => void newFolder()} onKeyDown={(e) => e.key === 'Enter' && void newFolder()}>
          <Icon name="ti-plus" />
          {t('newFolder')}
        </div>
        <div class="grow" />
        {surface === 'tab' && hasSidePanel() && (
          <div class="fr add" role="button" tabIndex={0} onClick={() => void openSidePanel()} onKeyDown={(e) => e.key === 'Enter' && void openSidePanel()}>
            <Icon name="ti-layout-sidebar-right" />
            {t('openSidePanel')}
          </div>
        )}
        <div class={`fr add${page === 'settings' ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => setPage('settings')} onKeyDown={(e) => e.key === 'Enter' && setPage('settings')}>
          <Icon name="ti-settings" />
          {t('settings')}
        </div>
      </aside>
      <main class="main">
        {page === 'settings' ? (
          settingsPage
        ) : (
          <>
            <div class="top">
              <Icon name={curFolder.icon} color={curFolder.color} />
              <span class="bar-name">{viewName}</span>
              <span class="muted bar-count">{t('itemCount', count(curFolder.id))}</span>
              {searchBox}
              {sortMenu}
              {viewSeg}
              {switchIcons}
            </div>
            {body}
          </>
        )}
      </main>
      {surface === 'sidepanel' && <SaveCurrent folders={pickerFolders} onSaved={() => void reload()} />}
      {dialogs}
    </div>
  );
}
