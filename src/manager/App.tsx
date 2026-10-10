import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '../shared/Icon';
import { ALL_FOLDER_ID, INBOX_ID, UNKNOWN_ACCOUNT_ID, accountLabel, displayName, isBuiltinFolder, userFoldersOf, type Account, type Bookmark, type Folder } from '../shared/models';
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
  onSettingsChanged,
  setCollectOffer,
  clearCollectRun,
  staleResult,
  DEFAULT_AUTO_COLLECT,
  type AutoCollectSettings,
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
import { Card, type RowHandlers } from './Cards';
import { BulkMenu } from './BulkMenu';
import { refreshCacheView } from './cacheView';
import { afterPostsRemoved, deleteAccountDataAndCache } from '../shared/cacheops';
import { ImageViewer, VideoGuide } from './Viewer';
import { AccountSwitcher, AssignDialog, resolveViewAccount } from './Accounts';
import { FolderEdit } from './FolderEdit';
import { inboxOf } from '../shared/folderPicker';
import { SaveCurrent } from './SaveCurrent';
import { Triage } from './Triage';
import { SearchContext } from './PostText';
import { SettingsPage } from './Settings';
import { clearStorageError, reportStorageError, useStorageError } from './errorBus';
import { AutoCollectDialog, OfferBanner, ProgressBanner, startAutoCollect, useCollectRun, watchStart } from './AutoCollect';
import { currentVersion } from '../shared/version';
import { REPO_URL } from '../shared/links';
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

/** ポップアップからの入口: #inbox (未分類で開く) と #q=<検索語> (検索語を入れて開く)。読み取ったらハッシュを消す。ほかのハッシュは触らない */
export function takeEntryHash(): { inbox?: boolean; triage?: boolean; q?: string } | null {
  const h = location.hash;
  let out: { inbox?: boolean; triage?: boolean; q?: string } | null = null;
  if (h === '#inbox') out = { inbox: true };
  else if (h === '#triage') out = { inbox: true, triage: true };
  else if (h.startsWith('#q=')) {
    try {
      out = { q: decodeURIComponent(h.slice(3)) };
    } catch {
      out = { q: '' };
    }
  }
  if (out) history.replaceState(null, '', location.pathname + location.search);
  return out;
}

/** 「未分類」は保存データにまだ無くても常にスマートビューに出す。アイコンは受け皿らしく inbox に統一する */
const inboxView = (stored?: Folder): Folder => ({ id: INBOX_ID, name: stored?.name ?? '', icon: 'ti-inbox', order: -1, color: stored?.color });
const recentView = (): Folder => ({ id: RECENT_ID, name: t('recent7'), icon: 'ti-clock', order: -1 });

/** 一覧に最初に描くポストの数と、末尾に近づいたときに増やす数 (ビューごと。サイドパネルは 30)。調整しやすいように定数にしてある */
export const PAGE_SIZE: Record<ViewMode, number> = { post: 30, list: 60, grid: 60 };
export const PAGE_SIZE_SIDEPANEL = 30;
/** 末尾のこの件数手前まで来たら、↓ キーで先に増やす */
const KEY_LOOKAHEAD = 5;
/** 「すべて表示」で、描画 1 回ごとに増やす件数 */
const SHOW_ALL_STEP = 100;

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
  /** サイドパネルの「絞り込み」(4 つの条件を畳んだもの) を開いているか */
  const [filterOpen, setFilterOpen] = useState(false);
  /** お知らせの帯が複数あるとき、いま出している帯の番号 (「他に N 件」で切り替える) */
  const [noticeIdx, setNoticeIdx] = useState(0);
  /** 自動取り込みの開始の指示が、x.com のブックマークの一覧で受け取られなかった */
  const [startMissed, setStartMissed] = useState(false);
  /** 未分類の仕分けモード (v29): 始めた時点のキュー。#triage で開かれたときは、データが読めてから始める */
  const [triage, setTriage] = useState<Bookmark[] | null>(null);
  const [triageMulti, setTriageMulti] = useState(false);
  const [triageWanted, setTriageWanted] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [dragOver, setDragOver] = useState<{ id: string; kind: 'folder' | 'posts' } | null>(null);
  // dragover 中は getData が保護されるため、同じ行へのドロップ判定には dragstart の ID を使う。
  const draggedFolder = useRef<string | null>(null);
  const clearDrag = () => {
    draggedFolder.current = null;
    setDragOver(null);
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') clearDrag(); };
    document.addEventListener('dragend', clearDrag);
    document.addEventListener('keydown', cancel);
    return () => {
      document.removeEventListener('dragend', clearDrag);
      document.removeEventListener('keydown', cancel);
    };
  }, []);
  const [showHow, setShowHow] = useState(false);
  const [bannerOn, setBannerOn] = useState(false);
  /** 更新した直後の最初の起動だけ出すお知らせ (更新後のバージョン) */
  const [updated, setUpdated] = useState<string | null>(null);
  const storageError = useStorageError();
  /** ブックマークの自動取り込み (v15): 設定、確認ダイアログ、「あとで」(この画面を開いている間だけ案内を隠す)、取り込みの状態 */
  const [autoCfg, setAutoCfg] = useState<AutoCollectSettings>(DEFAULT_AUTO_COLLECT);
  const [autoOpen, setAutoOpen] = useState(location.hash === '#autocollect');
  const [offerLater, setOfferLater] = useState(false);
  const collectRun = useCollectRun();
  const [runClosed, setRunClosed] = useState(0);
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
    const entry = takeEntryHash(); // ポップアップからの入口 (#inbox / #q=…)。読んだらハッシュを消す。lastFolderId より優先する
    void (async () => {
      const [s, last, accs] = await Promise.all([getSettings(), getLastSeenAccount(), listAccounts(), refreshCacheView()]).then((r) => [r[0], r[1], r[2]] as const);
      lastRef.current = last;
      setLastSeen(last);
      setAutoCfg(s.autoCollect);
      applyView(resolveViewAccount(s.viewAccount, last, accs));
      await Promise.all([reload(), loadHint()]);
      const ver = currentVersion();
      if (await noteRunVersion(ver)) setUpdated(ver);
      if (entry?.triage) setTriageWanted(true);
      setCurrent(entry?.inbox ? INBOX_ID : entry?.q !== undefined ? ALL_FOLDER_ID : s.lastFolderId);
      if (entry?.q !== undefined) {
        setSearch(entry.q);
        setSearchOpen(true);
      }
      setView(s.viewMode);
      setSort(s.sortKey);
      setReady(true);
    })().catch(() => {
      reportStorageError(); // 読み込めなかったことを画面に出す (空の画面のままにしない)
      setReady(true);
    });
    const onHash = () => {
      const e = takeEntryHash();
      if (e?.inbox) {
        chooseView(INBOX_ID);
        if (e.triage) setTriageWanted(true);
      }
      else if (e?.q !== undefined) {
        chooseView(ALL_FOLDER_ID);
        setSearch(e.q);
        setSearchOpen(true);
      }
      if (location.hash === '#autocollect') setAutoOpen(true); // x.com の「自動で取り込む…」から開かれた
    };
    window.addEventListener('hashchange', onHash);
    const offs = [() => window.removeEventListener('hashchange', onHash), onSettingsChanged((c) => setAutoCfg(c.autoCollect)), onDataChanged(() => void reload()), onImportHintChanged(() => void loadHint()), onLastSeenAccountChanged(() => void onLastSeen())]; // 別タブ (x.com) での保存・取り込み・アカウント切替も反映
    return () => offs.forEach((o) => o());
  }, []);

  // スクロールしているのは画面全体 (window)。一覧と設定が同じスクロールを共有するので、画面・フォルダ・並べ替え・検索・絞り込みを替えたときに位置を決める。
  // 保存データが変わっただけの再読み込み (自動取り込み中など) では、この依存が変わらないので、位置は動かさない。位置は保存データに入れない
  const pageRef = useRef(page);
  pageRef.current = page;
  const listScroll = useRef<{ folder: string; y: number } | null>(null);
  const scrollPrev = useRef({ page, mounted: false });
  useEffect(() => {
    const onScroll = () => {
      if (pageRef.current === 'bookmarks') listScroll.current = { folder: currentRef.current, y: window.scrollY };
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const currentRef = useRef(current);
  currentRef.current = current;
  const filtersKey = JSON.stringify(filters);
  useLayoutEffect(() => {
    const prev = scrollPrev.current;
    scrollPrev.current = { page, mounted: true };
    if (!prev.mounted) return;
    const saved = listScroll.current;
    // 設定から一覧へ戻ったとき: 同じフォルダなら、移る前の位置へ。フォルダが変わっていたら先頭
    const y = page === 'bookmarks' && prev.page === 'settings' && saved && saved.folder === current ? saved.y : 0;
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [page, current, sort, search, filtersKey]);

  // 最後に開いたフォルダ / 表示形式 / 並べ替えを chrome.storage.local に保存 (localStorage は使わない)
  const chooseView = (id: string) => {
    setCurrent(id);
    setPage('bookmarks');
    setSelected(new Set());
    setFilters({});
    setEditing(null);
    setCreatingFolder(false);
    setMenu(null);
    setFilterOpen(false);
    void updateSettings({ lastFolderId: id }).catch(() => {});
  };
  const chooseMode = (m: ViewMode) => {
    setView(m);
    void updateSettings({ viewMode: m }).catch(() => {});
  };
  const chooseSort = (s: SortKey) => {
    setSort(s);
    void updateSettings({ sortKey: s }).catch(() => {});
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
    if (prev !== null) void updateSettings({ viewAccount: '' }).catch(() => {}); // 別のアカウントに切り替えた: 手動の選択は解く
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
    void updateSettings({ viewAccount: id === lastRef.current?.id ? '' : id }).catch(() => {}); // x.com でログイン中のアカウントは「選んでいない」と同じ (追従する)
    switchTo(id);
  };
  const afterAccountChange = async (removedOrMovedId: string, nextId?: string) => {
    if (viewRef.current === removedOrMovedId) {
      const accs = await listAccounts();
      const id = nextId ?? resolveViewAccount('', lastRef.current, accs.filter((a) => a.account.id !== removedOrMovedId));
      void updateSettings({ viewAccount: id === lastRef.current?.id ? '' : id }).catch(() => {});
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
  const userFolders = userFoldersOf(folders);
  const smartViews: Folder[] = [folders[0] ?? { id: ALL_FOLDER_ID, name: '', icon: 'ti-bookmarks', order: -1 }, inboxView(storedInbox), recentView()];
  const allViews = [...smartViews, ...userFolders];
  const curFolder = allViews.find((f) => f.id === current) ?? smartViews[0];
  /** バッジ・チップ・ピッカー用。「未分類」の見た目を統一する */
  const folderOf = useCallback((id: string) => (id === INBOX_ID ? inboxView(storedInbox) : folders.find((f) => f.id === id)), [folders]); // 保存データが変わるまで同じ関数 (Card の memo のため)
  const pickerFolders = [inboxView(storedInbox), ...userFolders];

  const now = Date.now();
  const shown = useMemo(
    () => queryBookmarks(bookmarks, { folderId: curFolder.id, search, sort, filters, now }),
    [bookmarks, curFolder.id, search, sort, filters],
  );
  // 一覧の ID。shown が変わるときだけ作り直す。tabbableId は一覧の側で 1 回だけ決める (カードごとに全件を走査しない)
  const shownIds = useMemo(() => shown.map((b) => b.tweetId), [shown]);
  const shownSet = useMemo(() => new Set(shownIds), [shownIds]);
  // 段階表示: 描くのは shown の先頭から renderCount 件。選択・検索・件数の表示・全選択は、全件 (shown / shownIds) のまま
  const pageSize = surface === 'sidepanel' ? PAGE_SIZE_SIDEPANEL : PAGE_SIZE[view];
  const resetKey = `${curFolder.id}|${search}|${sort}|${filtersKey}|${view}|${pageSize}`;
  const [rcState, setRcState] = useState({ key: resetKey, n: pageSize });
  // フォルダ・検索・並べ替え・絞り込み・表示を替えると初期値に戻る。保存データが変わっただけでは戻らない (スクロール位置が飛ぶため)
  const renderCount = rcState.key === resetKey ? rcState.n : pageSize;
  const growTo = (n: number) => setRcState({ key: resetKey, n: Math.min(shown.length, Math.max(renderCount, n)) });
  const visible = useMemo(() => shown.slice(0, renderCount), [shown, renderCount]);
  const remaining = shown.length - visible.length;
  // 「すべて表示」(v36): 一度に全件を描くと固まるので、描画 1 回ごとに SHOW_ALL_STEP 件ずつ増やす。
  // 始めたときの resetKey を覚え、フォルダ・検索・並べ替えなどが替わって resetKey が変わったら、続きはやめる
  const [expandKey, setExpandKey] = useState<string | null>(null);
  const expanding = expandKey === resetKey && remaining > 0;
  const tabbableId = focusId && shownSet.has(focusId) && shownIds.indexOf(focusId) < renderCount ? focusId : shownIds[0];
  const viewName = curFolder.id === RECENT_ID ? curFolder.name : displayName(curFolder);
  // 件数は保存データが変わるまで使い回す (左のメニューと見出しで、描画のたびに全件を数え直さない。「最近の 7 日」の境目は、保存データが変わるまで動かない)
  const countCache = useMemo(() => new Map<string, number>(), [bookmarks]);
  const count = (id: string) => {
    let n = countCache.get(id);
    if (n === undefined) countCache.set(id, (n = countFolder(bookmarks, id, now)));
    return n;
  };
  const authors = useMemo(() => authorHandles(bookmarks), [bookmarks]);
  /** 仕分けモードが「削除されたポストを飛ばす」ために見る ID。保存データが変わらない再描画では、同じ Set を渡す */
  const liveIds = useMemo(() => new Set(bookmarks.map((b) => b.tweetId)), [bookmarks]);
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
  const unknownOn = unknownCount > 0 && viewId !== UNKNOWN_ACCOUNT_ID && !!lastSeen && page === 'bookmarks';
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
    try {
      const undo = await op;
      await reload();
      const n = Object.keys(undo).length;
      if (n > 0) setToast({ key: Date.now(), message: t(msgKey, n), undo });
    } catch {
      // 保存の失敗 (容量・保存のエラー): 通知を出し、画面は読み直して実際の状態に合わせる
      setToast({ key: Date.now(), message: t('errorStorage') });
      await reload().catch(() => {});
    }
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

  /** 描画のあとでフォーカスする行 (未描画の行へ ↓ で移るとき) */
  const pendingFocus = useRef<string | null>(null);
  const focusPending = () => {
    const id = pendingFocus.current;
    if (!id) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].find((r) => r.dataset.row === id);
    if (row) {
      pendingFocus.current = null;
      row.focus();
    }
  };
  useLayoutEffect(focusPending); // 描画のたびに、待っている行があれば試す

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
      const nextIdx = Math.min(shownIds.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      const next = shownIds[nextIdx];
      if (next) {
        // 次が未描画、または末尾の手前に来たときは、先に描く件数を増やす (描画のあとでフォーカスする)
        if (nextIdx >= renderCount - KEY_LOOKAHEAD && remaining > 0) growTo(nextIdx + pageSize);
        setFocusId(next);
        pendingFocus.current = next;
        focusPending();
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
    clearDrag();
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

  const editNode = (f: Folder) => {
    if (editing !== f.id) return null;
    return (
      <Dropdown fixed onClose={() => setEditing(null)} label={t('folderMore')} class="menu-edit">
        <FolderEdit
          folder={f}
          existing={[inboxOf(folders), ...folders]}
          onSaved={() => { setEditing(null); void reload(); }}
          onRequestDelete={() => { setEditing(null); setConfirmState({ kind: 'folder', id: f.id }); }}
        />
      </Dropdown>
    );
  };

  const viewRow = (f: Folder, opts: { smart?: boolean } = {}) => {
    const reorderable = !opts.smart;
    const n = count(f.id);
    const label = f.id === RECENT_ID ? f.name : displayName(f);
    return (
      <div
        key={f.id}
        class={`fr${f.id === curFolder.id && page === 'bookmarks' ? ' on' : ''}${dragOver?.id === f.id ? dragOver.kind === 'folder' ? ' drop-before' : ' drop' : ''}`}
        role="button"
        tabIndex={0}
        aria-current={f.id === curFolder.id && page === 'bookmarks' ? 'true' : undefined}
        title={virtual(f.id) ? undefined : t('dragHint')}
        draggable={reorderable && editing !== f.id}
        onDragStart={(e) => {
          draggedFolder.current = f.id;
          setDragOver(null);
          e.dataTransfer?.setData(MIME_FOLDER, f.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          const types = e.dataTransfer?.types ?? [];
          const kind = types.includes(MIME_POSTS) ? 'posts' : 'folder';
          if (!folderDroppable(f, types) || (kind === 'folder' && draggedFolder.current === f.id)) {
            setDragOver(null);
            return;
          }
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = kind === 'folder' || e.altKey ? 'move' : 'copy';
          setDragOver({ id: f.id, kind });
        }}
        onDragLeave={(e) => {
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
          setDragOver((d) => (d?.id === f.id ? null : d));
        }}
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
                setCreatingFolder(false);
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

  const newFolder = () => {
    setEditing(null);
    setMenu(null);
    setCreatingFolder(true);
  };
  const createNode = creatingFolder && (
    <Dropdown fixed onClose={() => setCreatingFolder(false)} label={t('newFolder')} class="menu-edit">
      <FolderEdit
        onCancel={() => setCreatingFolder(false)}
        existing={[inboxOf(folders), ...folders]}
        onSaved={(f) => {
          setCreatingFolder(false);
          if (f) void reload().then(() => chooseView(f.id));
        }}
      />
    </Dropdown>
  );

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

  const importOn = bannerOn && page === 'bookmarks' && !compact;
  /**
   * お知らせの帯は、いちばん大事な 1 本だけを出し、残りは「他に N 件」で次の帯に切り替える (v19-B)。
   * 優先順: アカウント未設定の割り当て → ブックマークの取り込みの案内。自動取り込みの進捗は状態の表示なので、この対象ではない。
   */
  const noticeKinds = [...(unknownOn ? (['unknown'] as const) : []), ...(importOn ? (['import'] as const) : [])];
  const noticeKind = noticeKinds.length ? noticeKinds[noticeIdx % noticeKinds.length] : null;
  const moreBtn =
    noticeKinds.length > 1 ? (
      <button class="banner-more" aria-label={t('noticeMore', noticeKinds.length - 1)} onClick={() => setNoticeIdx((i) => i + 1)}>
        {t('noticeMore', noticeKinds.length - 1)} <Icon name="ti-chevron-down" />
      </button>
    ) : null;
  const noticeBand =
    noticeKind === 'unknown' ? (
      <div class="banner" role="region" aria-label={t('accountUnknownName')}>
        <Icon name="ti-user-question" />
        <span class="banner-text">{t('accountUnknownBanner', unknownCount)}</span>
        <button class="banner-btn" onClick={() => setAssignFrom(UNKNOWN_ACCOUNT_ID)}>
          {t('accountAssign')}
        </button>
        {moreBtn}
      </div>
    ) : noticeKind === 'import' ? (
      <div class="banner" role="region" aria-label={t('importHow')}>
        <Icon name="ti-download" />
        <span class="banner-text">{t('importBanner', pending)}</span>
        <button class="banner-btn" onClick={() => setShowHow(true)}>
          {t('importHow')}
        </button>
        {moreBtn}
        <button class="icon-btn" aria-label={t('dismiss')} title={t('dismiss')} onClick={dismissBanner}>
          <Icon name="ti-x" />
        </button>
      </div>
    ) : null;

  /** 絞り込みの 4 つの条件 (画像あり / 動画あり / リンクあり / 投稿者)。管理画面では常に見えて、サイドパネルでは「絞り込み」に畳む */
  const filterItems = (
    <>
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
    </>
  );

  const bulkMenu =
    selected.size > 0 ? (
      <BulkMenu
        count={selected.size}
        addFolders={pickerFolders}
        removeFolders={removableFolders}
        onAdd={(id) => void run(addToFolders(bulkIds, [id]), 'toastAdded')}
        onRemove={(id) => void run(removeFromFolders(bulkIds, [id]), 'toastRemoved')}
        onDelete={() => setConfirmState({ kind: 'posts', ids: bulkIds })}
        onClear={clearSelection}
      />
    ) : null;
  /** 管理画面: 絞り込みの行。複数選択のボタンは右端に置く (行はいつもあるので、選択のたびに一覧はずれない) */
  const chips = (
    <div class="chips" role="group" aria-label={t('filterAuthor')}>
      {filterItems}
      {bulkMenu}
    </div>
  );
  const filterCount = (['image', 'video', 'link', 'handle'] as const).filter((k) => !!filters[k]).length;
  /** サイドパネル: 「絞り込み」ボタン。押すと 4 つの条件が開く。選んでいるあいだは件数のバッジを出す */
  const filterButton = (
    <span class="menu-anchor">
      <button
        class={`chip filter fbtn${filterCount ? ' on' : ''}`}
        aria-haspopup="true"
        aria-expanded={filterOpen}
        aria-label={t('filterButton')}
        title={t('filterButton')}
        onClick={() => setFilterOpen(!filterOpen)}
      >
        <Icon name="ti-adjustments-horizontal" /> <span class="fbtn-label">{t('filterButton')}</span>
        {filterCount > 0 && <span class="count-badge">{filterCount}</span>}
      </button>
      {filterOpen && (
        <Dropdown fixed onClose={() => setFilterOpen(false)} label={t('filterButton')} class="menu-filter">
          <div class="chips" role="group" aria-label={t('filterButton')}>
            {filterItems}
          </div>
        </Dropdown>
      )}
    </span>
  );

  const searching = search.trim() !== '' || hasActiveFilters(filters);
  /** 始めた時点の未分類を、いまの並び順で固定した列にして、仕分けモードを始める。0 件なら完了のダイアログを出す */
  const startTriage = async () => {
    try {
      // 取り込み完了の直後でも、最後に保存された分が入るよう、始める直前に保存データを読み直す (state が古いことがある)
      const [fresh, settings] = await Promise.all([listBookmarks(), getSettings()]);
      setBookmarks(fresh);
      const queue = queryBookmarks(fresh, { folderId: INBOX_ID, search: '', sort, filters: {}, now: Date.now() });
      setTriageMulti(settings.triageMulti === true);
      setTriage(queue);
    } catch {
      reportStorageError(); // 読み込めなかったときは始めない
    }
  };
  useEffect(() => {
    if (!triageWanted || !ready) return;
    setTriageWanted(false);
    void startTriage();
  }, [triageWanted, ready]);
  const clearAll = () => {
    setSearch('');
    setFilters({});
  };
  const empty =
    shown.length === 0 &&
    (bookmarks.length === 0 ? (
      <div class="empty-state">
        <Icon name="ti-bookmarks" />
        <div class="empty-title">{t('onboardTitle')}</div>
        <ol class="onboard">
          <li>
            <span class="onboard-n" aria-hidden="true">1</span>
            <span class="onboard-text">{t('onboardStep1')}</span>
          </li>
          <li>
            <span class="onboard-n" aria-hidden="true">2</span>
            <span class="onboard-text">{t('onboardStep2')}</span>
            <button class="onboard-btn" onClick={() => (autoCfg.enabled && lastSeen ? setAutoOpen(true) : setShowHow(true))}>
              {t('onboardImport')}
            </button>
          </li>
        </ol>
      </div>
    ) : searching ? (
      <div class="empty-state">
        <Icon name="ti-search" />
        <div class="empty-title">{t('notFoundTitle')}</div>
        <div>{t('notFoundHint')}</div>
        <button onClick={clearAll}>
          {t('clearFilters')}
        </button>
      </div>
    ) : (
      <p class="empty">{t('empty')}</p>
    ));

  // 行の操作は、親が 1 度だけ作る安定したオブジェクト (Card の memo のため)。中身は、描画のたびに最新の関数に差し替える
  const latest = useRef<RowHandlers>(null as unknown as RowHandlers);
  latest.current = {
    select: (id, shift) => toggleSelect(id, shift),
    focus: (id) => setFocusId(id),
    removeFromFolder: (id, fid) => void run(removeFromFolders([id], [fid]), 'toastRemoved'),
    togglePicker: (id) => setPicker(picker === id ? null : id),
    del: (id) => setConfirmState({ kind: 'posts', ids: [id] }),
    dragStart: (id, e) => {
      const ids = selected.has(id) ? [...selected] : [id];
      e.dataTransfer?.setData(MIME_POSTS, JSON.stringify(ids));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
    },
    openImage: (id, index) => setViewer({ kind: 'image', tweetId: id, index }),
    openVideo: (id) => setViewer({ kind: 'video', tweetId: id }),
  };
  const rowHandlers = useMemo<RowHandlers>(
    () => ({
      select: (id, shift) => latest.current.select(id, shift),
      focus: (id) => latest.current.focus(id),
      removeFromFolder: (id, fid) => latest.current.removeFromFolder(id, fid),
      togglePicker: (id) => latest.current.togglePicker(id),
      del: (id) => latest.current.del(id),
      dragStart: (id, e) => latest.current.dragStart(id, e),
      openImage: (id, index) => latest.current.openImage(id, index),
      openVideo: (id) => latest.current.openVideo(id),
    }),
    [],
  );
  // 末尾の手前 (画面の高さの 1.5 倍) に入ったら、1 回分増やす。IntersectionObserver が無い環境では、「すべて表示」のボタンで増やす
  // 末尾の要素は、コールバック ref + 状態で持つ。useRef だと、データを読んだ描画ではまだ DOM が無く (ready 前)、
  // 一覧が描かれたあとも依存の値が変わらないので、効果が再実行されず、30 件で止まった (v36)
  useEffect(() => {
    if (!expanding) return;
    const raf = requestAnimationFrame(() => growTo(renderCount + SHOW_ALL_STEP));
    return () => cancelAnimationFrame(raf);
  }, [expanding, renderCount, resetKey, shown]);
  useEffect(() => {
    if (expandKey !== null && (expandKey !== resetKey || remaining <= 0)) setExpandKey(null);
  }, [expandKey, resetKey, remaining]);
  const [sentinel, setSentinel] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = sentinel;
    // 「すべて表示」で増やしている間は付けない (1 フレームごとに作り直して測り直すのは無駄。終われば expanding が変わり、付け直す)
    if (!el || remaining <= 0 || expanding) return;
    // IntersectionObserver だけに頼らない。実機で「すべて」が 30 件で止まったのは、末尾の要素が効果より遅れて現れ、効果が再実行されなかったため (v36 で直した。
    // sentinel を状態にして依存に入れている)。念のため、scroll / resize と、描画のたびに、末尾までの距離も測る。
    // どちらで増やしても、増やす先は今の renderCount が基準 (同じ値を入れるだけなので、二重には増えない)
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && r.top === 0) return; // まだ配置されていない (測れない)
      if (r.top < window.innerHeight * 2) growTo(renderCount + pageSize);
    };
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        check();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll(); // 増やしたあとも、まだ末尾が近ければ続けて増やす
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && growTo(renderCount + pageSize), { rootMargin: `${Math.round(window.innerHeight * 1.5)}px 0px` });
      io.observe(el);
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [sentinel, renderCount, remaining, resetKey, expanding]);
  const rows = (
    <SearchContext.Provider value={search}>
    <div class={`rows view-${view}${compact ? ' compact' : ''}`} ref={listRef} onKeyDown={onListKeyDown} role="list">
      {visible.map((b) => (
        <Card
          key={b.tweetId}
          b={b}
          view={view}
          compact={compact}
          selected={selected.has(b.tweetId)}
          selectionActive={selected.size > 0}
          tabbable={b.tweetId === tabbableId}
          folderOf={folderOf}
          pickerOpen={picker === b.tweetId}
          h={rowHandlers}
          pickerNode={
            picker === b.tweetId ? (
              <Dropdown fixed onClose={() => setPicker(null)} label={t('changeFolder')} class="menu-wide">
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
    {remaining > 0 && (
      <div class="list-more">
        <span ref={setSentinel} class="list-sentinel" aria-hidden="true" />
        <span class="muted">{t('listRemaining', remaining)}</span>
        <button type="button" disabled={expanding} onClick={() => setExpandKey(resetKey)}>
          {t('listShowAll')}
        </button>
      </div>
    )}
    </SearchContext.Provider>
  );

  // 案内を出す条件: 自動取り込みを使う設定、判定できたアカウントを表示していて、そのアカウントのデータが 0 件、案内を閉じていない。
  // 出すだけで、自動では始まらない (「始める」を押して確認ダイアログで同意したときだけ動く)
  const runActive = !!collectRun && ['countdown', 'running', 'paused', 'limit'].includes(collectRun.status);
  const offerShown =
    page === 'bookmarks' && autoCfg.enabled && !!lastSeen && viewId === lastSeen.id && bookmarks.length === 0 && !autoCfg.offers[lastSeen.id] && !offerLater && !runActive;
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
      {collectRun && collectRun.updatedAt !== runClosed && autoCfg.enabled && !staleResult(collectRun) && (
        <ProgressBanner
          run={collectRun}
          onTriage={() => {
            chooseView(INBOX_ID);
            if (!compact) setTriageWanted(true);
          }}
          onClose={() => {
            setRunClosed(collectRun.updatedAt);
            // 終わった状態 (done / stopped) は、保存してある記録も消す。進行中の状態は消さない
            if (collectRun.status === 'done' || collectRun.status === 'stopped') void clearCollectRun().catch(() => {});
          }}
        />
      )}
      {startMissed && (
        <div class="banner" role="status">
          <Icon name="ti-info-circle" />
          <span class="banner-text">{t('acStartMissed')}</span>
          <button class="icon-btn" aria-label={t('dismiss')} title={t('dismiss')} onClick={() => setStartMissed(false)}>
            <Icon name="ti-x" />
          </button>
        </div>
      )}
      {offerShown && lastSeen && (
        <OfferBanner
          accountName={accountLabel(lastSeen)}
          onStart={() => setAutoOpen(true)}
          onLater={() => setOfferLater(true)}
          onNever={() => void setCollectOffer(lastSeen.id, 'dismissed')}
        />
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
      {noticeBand}
      {compact ? null : chips}
      {empty}
      {rows}
    </>
  );

  const dialogs = (
    <>
      {triage && (
        <Triage
          multi={triageMulti}
          queue={triage}
          live={liveIds}
          folders={userFolders}
          pickerFolders={pickerFolders}
          onChanged={() => reload()}
          onClose={() => setTriage(null)}
        />
      )}
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
      {viewerBookmark && viewer?.kind === 'image' && viewerBookmark.snapshot.media.length > 0 && (
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
      {autoOpen && autoCfg.enabled && (
        <AutoCollectDialog
          accountName={lastSeen ? accountLabel(lastSeen) : null}
          speed={autoCfg.speed}
          cap={autoCfg.cap}
          onCancel={() => {
            setAutoOpen(false);
            if (location.hash === '#autocollect') history.replaceState(null, '', location.pathname + location.search);
          }}
          onStart={(speed, cap) => {
            setAutoOpen(false);
            if (location.hash === '#autocollect') history.replaceState(null, '', location.pathname + location.search);
            if (lastSeen) void startAutoCollect({ accountId: lastSeen.id, speed, cap }).then((id) => void watchStart(id, () => setStartMissed(true))).catch(() => {});
          }}
        />
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
        onAutoCollect={() => setAutoOpen(true)}
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
                onClick={() => { setCreatingFolder(false); setMenu(menu === 'folders' ? null : 'folders'); }}
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
                  <button class="menu-item" onClick={newFolder}>
                    <Icon name="ti-plus" /> {t('newFolder')}
                  </button>
                  <button class="menu-item" onClick={() => { setMenu(null); setPage('settings'); }}>
                    <Icon name="ti-settings" /> {t('settings')}
                  </button>
                </Dropdown>
              )}
              {createNode}
            </span>
            <button class="icon-btn bordered" aria-label={t('searchShow')} title={t('search')} aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)}>
              <Icon name="ti-search" />
            </button>
            {switchIcons}
          </div>
          {searchOpen && searchBox}
          {page === 'bookmarks' && (
            <div class="tools">
              {sortMenu}
              {filterButton}
              <span class="grow" />
              {/* 選んでいるあいだは、表示切り替えの場所に「N 件選択中 ⌄」を出す (幅 340px に収めるため。一覧は下にずれない) */}
              {bulkMenu ?? viewSeg}
            </div>
          )}
          {surface === 'sidepanel' && <SaveCurrent folders={pickerFolders} blockedReason={saveBlocked} onSaved={() => void reload()} />}
        </header>
        <main class="pbody">
          {page === 'settings' ? (
            settingsPage
          ) : (
            body
          )}
        </main>
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
        <div class="menu-anchor folder-create-anchor">
          <div class="fr add" role="button" tabIndex={0} onClick={newFolder} onKeyDown={(e) => e.key === 'Enter' && newFolder()}>
            <Icon name="ti-plus" />
            {t('newFolder')}
          </div>
          {createNode}
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
        {/* GitHub のリポジトリ (v25: 設定の中から、ここへ移した。どの画面にいても見える)。狭いときは、ロゴだけにして、名前は aria-label に残す */}
        <a class="gh-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t('githubLinkAria')} title={t('githubLinkAria')}>
          <Icon name="ti-brand-github" />
          <span class="gh-text">GitHub</span>
          <Icon name="ti-external-link" />
        </a>
      </aside>
      <main class="main">
        {surface === 'sidepanel' && <SaveCurrent folders={pickerFolders} blockedReason={saveBlocked} onSaved={() => void reload()} />}
        {page === 'settings' ? (
          settingsPage
        ) : (
          <>
            <div class="top">
              <Icon name={curFolder.icon} color={curFolder.color} />
              <span class="bar-name">{viewName}</span>
              <span class="muted bar-count">{searching ? t('itemCountOf', count(curFolder.id), shown.length) : t('itemCount', count(curFolder.id))}</span>
              {curFolder.id === INBOX_ID && count(INBOX_ID) > 0 && (
                <button class="triage-start" onClick={() => void startTriage()}>
                  <Icon name="ti-bolt" /> {t('triageStart')}
                </button>
              )}
              {searching && (
                <button class="bar-clear" onClick={clearAll}>
                  {t('clearFilters')}
                </button>
              )}
              {searchBox}
              {sortMenu}
              {viewSeg}
              {switchIcons}
            </div>
            {body}
          </>
        )}
      </main>
      {dialogs}
    </div>
  );
}
