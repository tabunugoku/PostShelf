import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '../shared/Icon';
import { ALL_FOLDER_ID, INBOX_ID, UNKNOWN_ACCOUNT_ID, accountLabel, displayName, isBuiltinFolder, type Account, type Bookmark, type Folder } from '../shared/models';
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
  noteRunVersion,
  onImportHintChanged,
  shouldShowImportHint,
  updateSettings,
  type ViewMode,
} from '../shared/settings';
import { hasSidePanel, openManagerTab, openSidePanel } from '../shared/panel';
import {
  addToFolders,
  assignAccount,
  deleteAccountData,
  getLastSeenAccount,
  listAccounts,
  onLastSeenAccountChanged,
  setAccountScope,
  type AccountSummary,
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
import { refreshCacheView } from './cacheView';
import { afterPostsRemoved, deleteAccountDataAndCache } from '../shared/cacheops';
import { ImageViewer, VideoGuide } from './Viewer';
import { AccountSwitcher, AssignDialog, resolveViewAccount } from './Accounts';
import { FolderEdit } from './FolderEdit';
import { SaveCurrent } from './SaveCurrent';
import { SettingsPage } from './Settings';
import { clearStorageError, reportStorageError, useStorageError } from './errorBus';
import { currentVersion } from '../shared/version';
import { useCompact } from './useCompact';

const sorts = (): [SortKey, string][] => [
  ['savedDesc', t('sortSavedDesc')],
  ['savedAsc', t('sortSavedAsc')],
  ['postedDesc', t('sortPostedDesc')],
  ['postedAsc', t('sortPostedAsc')],
];

type ConfirmState = { kind: 'posts'; ids: string[] } | { kind: 'folder'; id: string } | { kind: 'account'; id: string } | null;
/** undo の無いトースト (アカウントの切替・割り当ての通知) もある */
type ToastState = { key: number; message: string; undo?: BookmarkUndo; /** 設定の初期化の取り消しなど、ポスト以外の「元に戻す」 */ action?: () => Promise<void> } | null;

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
  const [page, setPage] = useState<'bookmarks' | 'settings'>(location.hash === '#settings' || location.hash === '#diagnostics' ? 'settings' : 'bookmarks');
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
  /** 更新した直後の最初の起動だけ出すお知らせ (更新後のバージョン) */
  const [updated, setUpdated] = useState<string | null>(null);
  const storageError = useStorageError();
  const [pending, setPending] = useState(0);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [viewId, setViewId] = useState(UNKNOWN_ACCOUNT_ID);
  const [lastSeen, setLastSeen] = useState<Account | null>(null);
  const [assignFrom, setAssignFrom] = useState<string | null>(null);
  /** 画像ビューア / 動画の案内 (どのポストの何枚目か)。閉じたときのフォーカスは Viewer が元のボタンへ戻す */
  const [viewer, setViewer] = useState<{ kind: 'image'; tweetId: string; index: number } | { kind: 'video'; tweetId: string } | null>(null);
  const viewRef = useRef(UNKNOWN_ACCOUNT_ID);
  const lastRef = useRef<Account | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** 表示するアカウントを切り替える (保存層の対象も合わせる)。データの読み直しは呼び出し側 */
  const applyView = (id: string) => {
    viewRef.current = id;
    setAccountScope(id);
    setViewId(id);
  };
  const reload = async () => {
    const [f, b, accs] = await Promise.all([listFolders(), listBookmarks(), listAccounts()]);
    setFolders(f);
    setBookmarks(b);
    setAccounts(accs);
    const existing = new Set(b.map((x) => x.tweetId));
    setSelected((s) => pruneSelection(s, existing));
  };
  const loadHint = async () => {
    const h = await getImportHint(viewRef.current);
    setPending(h.pending);
    setBannerOn(shouldShowImportHint(h));
  };
  useEffect(() => {
    void (async () => {
      const [s, last, accs] = await Promise.all([getSettings(), getLastSeenAccount(), listAccounts(), refreshCacheView()]).then((r) => [r[0], r[1], r[2]] as const);
      lastRef.current = last;
      setLastSeen(last);
      applyView(resolveViewAccount(s.viewAccount, last, accs));
      await Promise.all([reload(), loadHint()]);
      const ver = currentVersion();
      if (await noteRunVersion(ver)) setUpdated(ver);
      setCurrent(s.lastFolderId);
      setView(s.viewMode);
      setSort(s.sortKey);
      setReady(true);
    })().catch(() => {
      reportStorageError(); // 読み込めなかったことを画面に出す (空の画面のままにしない)
      setReady(true);
    });
    const offs = [onDataChanged(() => void reload()), onImportHintChanged(() => void loadHint()), onLastSeenAccountChanged(() => void onLastSeen())]; // 別タブ (x.com) での保存・取り込み・アカウント切替も反映
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

  /** x.com で読み取ったアカウントが変わった。別のアカウントに切り替わったら、そのアカウントの表示に切り替えて知らせる */
  const onLastSeen = async () => {
    const next = await getLastSeenAccount();
    const prev = lastRef.current;
    lastRef.current = next;
    setLastSeen(next);
    if (!next || next.id === prev?.id) return;
    const s = await getSettings();
    if (prev === null && s.viewAccount) return; // 初めて読み取れた: 手動で選んだ表示があればそのまま
    if (prev !== null) void updateSettings({ viewAccount: '' }); // 別のアカウントに切り替えた: 手動の選択は解く
    switchTo(next.id);
    if (prev !== null) setToast({ key: Date.now(), message: t('accountSwitched', accountLabel(next)) });
  };
  /** 設定の初期化 / 取り消し / 全データ削除のあと、保存されている設定とデータから表示を作り直す (リロード不要) */
  const reapplySettings = async () => {
    const [s, accs] = await Promise.all([getSettings(), listAccounts()]);
    setView(s.viewMode);
    setSort(s.sortKey);
    lastRef.current = await getLastSeenAccount();
    setLastSeen(lastRef.current);
    applyView(resolveViewAccount(s.viewAccount, lastRef.current, accs));
    setCurrent(s.lastFolderId);
    setFilters({});
    setSelected(new Set());
    await Promise.all([reload(), loadHint()]);
  };
  /** 表示アカウントを切り替えて、データと表示状態を読み直す */
  const switchTo = (id: string) => {
    applyView(id);
    chooseView(ALL_FOLDER_ID);
    setSearch('');
    void Promise.all([reload(), loadHint()]);
  };
  const pickAccount = (id: string) => {
    void updateSettings({ viewAccount: id === lastRef.current?.id ? '' : id }); // x.com でログイン中のアカウントは「選んでいない」と同じ (追従する)
    switchTo(id);
  };
  const afterAccountChange = async (removedOrMovedId: string, nextId?: string) => {
    if (viewRef.current === removedOrMovedId) {
      const accs = await listAccounts();
      const id = nextId ?? resolveViewAccount('', lastRef.current, accs.filter((a) => a.account.id !== removedOrMovedId));
      void updateSettings({ viewAccount: id === lastRef.current?.id ? '' : id });
      switchTo(id);
    } else await reload();
  };

  // 取り込み案内バナーの「閉じる」: 閉じた時点の件数を保存し、件数が増えるまで出さない
  const dismissBanner = () => {
    setBannerOn(false);
    void dismissImportHint(viewRef.current);
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
  const viewerBookmark = viewer ? bookmarks.find((b) => b.tweetId === viewer.tweetId) : undefined;
  const assignSource = accounts.find((a) => a.account.id === assignFrom);
  const unknownCount = accounts.find((a) => a.account.id === UNKNOWN_ACCOUNT_ID)?.count ?? 0;
  const confirmMessage = (c: NonNullable<ConfirmState>) => {
    if (c.kind === 'posts') return t('confirmDeletePosts', c.ids.length);
    if (c.kind === 'account') {
      const a = accounts.find((x) => x.account.id === c.id);
      return t('accountDeleteConfirm', a ? accountLabel(a.account) : c.id, a?.count ?? 0);
    }
    return t('confirmDelete');
  };
  /** ログイン中のアカウントを判定できていて、「アカウント未設定」にデータが残っているとき、割り当てを案内する */
  const unknownBanner = unknownCount > 0 && viewId !== UNKNOWN_ACCOUNT_ID && lastSeen && page === 'bookmarks' && (
    <div class="banner" role="region" aria-label={t('accountUnknownName')}>
      <Icon name="ti-user-question" />
      <span>{t('accountUnknownBanner', unknownCount)}</span>
      <button class="banner-btn" onClick={() => setAssignFrom(UNKNOWN_ACCOUNT_ID)}>
        {t('accountAssign')}
      </button>
    </div>
  );
  const switcher = (
    <AccountSwitcher
      accounts={accounts}
      viewId={viewId}
      loggedInId={lastSeen?.id ?? null}
      onPick={pickAccount}
      onAssign={setAssignFrom}
      onDelete={(id) => setConfirmState({ kind: 'account', id })}
    />
  );
  /** サイドパネル下部の保存ボタンを出せない理由 (ログイン中のアカウントが分からない / 表示中と違う) */
  const saveBlocked = !lastSeen ? t('saveCurrentNoAccount') : lastSeen.id !== viewId ? t('saveCurrentWrongAccount', accountLabel(lastSeen)) : undefined;

  /** 一括操作を実行し、件数が変わったら取り消し付きトーストを出す */
  const run = async (op: Promise<BookmarkUndo>, msgKey: string) => {
    const undo = await op;
    await reload();
    const n = Object.keys(undo).length;
    if (n > 0) setToast({ key: Date.now(), message: t(msgKey, n), undo });
  };
  const doUndo = async () => {
    if (toast?.action) {
      const act = toast.action;
      setToast(null);
      await act();
      return;
    }
    if (!toast?.undo) return;
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
      <Dropdown fixed onClose={() => setEditing(null)} label={t('folderMore')} class="menu-edit">
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
          onOpenImage={(index) => setViewer({ kind: 'image', tweetId: b.tweetId, index })}
          onOpenVideo={() => setViewer({ kind: 'video', tweetId: b.tweetId })}
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

  const notices = (
    <>
      {storageError && (
        <div class="banner banner-error" role="alert">
          <Icon name="ti-alert-triangle" />
          <span>{t('errorStorage')}</span>
          <button class="icon-btn" aria-label={t('dismiss')} title={t('dismiss')} onClick={clearStorageError}>
            <Icon name="ti-x" />
          </button>
        </div>
      )}
      {updated && (
        <div class="banner" role="status">
          <Icon name="ti-circle-check" />
          <span>{t('updateNotice', updated)}</span>
          <button class="icon-btn" aria-label={t('dismiss')} title={t('dismiss')} onClick={() => setUpdated(null)}>
            <Icon name="ti-x" />
          </button>
        </div>
      )}
    </>
  );

  const body = (
    <>
      {notices}
      {unknownBanner}
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
          message={confirmMessage(confirmState)}
          confirmLabel={t('delete')}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => {
            const c = confirmState;
            setConfirmState(null);
            if (c.kind === 'posts') {
              await run(deleteBookmarks(c.ids), 'toastDeleted');
              void afterPostsRemoved(); // 対応する画像も消す (失敗してもポストの削除は成功。設定画面に整理が必要と出る)
              setSelected((s) => new Set([...s].filter((id) => !c.ids.includes(id))));
            } else if (c.kind === 'account') {
              await deleteAccountDataAndCache(c.id);
              await afterAccountChange(c.id);
            } else {
              await deleteFolder(c.id);
              if (current === c.id) chooseView(ALL_FOLDER_ID);
              await reload();
            }
          }}
        />
      )}
      {assignFrom && assignSource && (
        <AssignDialog
          from={assignSource}
          targets={accounts.filter((a) => a.account.id !== assignFrom && a.account.id !== UNKNOWN_ACCOUNT_ID)}
          defaultTo={lastSeen?.id ?? null}
          onCancel={() => setAssignFrom(null)}
          onConfirm={async (to) => {
            const from = assignFrom;
            setAssignFrom(null);
            const r = await assignAccount(from, to);
            setToast({ key: Date.now(), message: t('accountAssignDone', r.moved + r.merged) });
            await afterAccountChange(from, to);
          }}
        />
      )}
      {viewerBookmark && viewer?.kind === 'image' && (
        <ImageViewer
          tweetId={viewerBookmark.tweetId}
          urls={viewerBookmark.snapshot.media}
          index={Math.min(viewer.index, viewerBookmark.snapshot.media.length - 1)}
          postUrl={viewerBookmark.snapshot.url}
          onIndex={(index) => setViewer({ kind: 'image', tweetId: viewerBookmark.tweetId, index })}
          onClose={() => setViewer(null)}
        />
      )}
      {viewerBookmark && viewer?.kind === 'video' && (
        <VideoGuide tweetId={viewerBookmark.tweetId} poster={viewerBookmark.snapshot.videoPoster} postUrl={viewerBookmark.snapshot.url} onClose={() => setViewer(null)} />
      )}
      {showHow && <InfoDialog title={t('importHowTitle')} body={t('importHowSteps')} onClose={() => setShowHow(false)} />}
      {toast && <Toast message={toast.message} onUndo={toast.undo || toast.action ? () => void doUndo() : undefined} />}
    </>
  );

  if (!ready) return <div class={`app surface-${surface}`} />;

  const settingsPage = (
    <>
      {notices}
      <SettingsPage
        surface={surface}
        onChanged={() => void reload()}
        onApplied={() => void reapplySettings()}
        onNotice={(message, action) => setToast({ key: Date.now(), message, action })}
      />
    </>
  );

  // ===== 狭いレイアウト (サイドパネル向け): 1 つのフォルダボタン + 検索 + 横スクロールのチップ =====
  if (compact) {
    return (
      <div class={`app layout-narrow surface-${surface}`}>
        <header class="phead">
          {switcher}
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
        {surface === 'sidepanel' && <SaveCurrent folders={pickerFolders} blockedReason={saveBlocked} onSaved={() => void reload()} />}
        {dialogs}
      </div>
    );
  }

  // ===== 広いレイアウト (タブ): サイドバー + メイン =====
  return (
    <div class={`app layout-wide surface-${surface}`}>
      <aside class="side">
        {switcher}
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
      {surface === 'sidepanel' && <SaveCurrent folders={pickerFolders} blockedReason={saveBlocked} onSaved={() => void reload()} />}
      {dialogs}
    </div>
  );
}
