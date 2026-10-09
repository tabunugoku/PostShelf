import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { requestNativeSync, requestSnapshot, watchActivePost, type ActivePost } from '../shared/activeTab';
import { INBOX_ID, displayName, type Folder, type Snapshot } from '../shared/models';
import { getAccountScope, getBookmark, removeBookmark, setBookmarkFolders } from '../shared/storage';
import { getSettings, onSettingsChanged, updateRecentFolders } from '../shared/settings';
import { requestCache, requestFullText, requestPrune } from '../shared/cacheRequest';
import { t } from '../shared/strings';
import { Dropdown, FolderPickerHost } from './ui';

/** チップに出すフォルダの数 (残りは「他の N つ」から選ぶ) */
export const CHIP_COUNT = 4;

/** チップに出すフォルダ: 「最近使った」を先頭に、足りなければ並び順で補う。「未分類」は出さない */
export function chipFolders(folders: Folder[], recentIds: string[]): Folder[] {
  const users = folders.filter((f) => f.id !== INBOX_ID);
  const recent = recentIds.map((id) => users.find((f) => f.id === id)).filter((f): f is Folder => !!f);
  const rest = users.filter((f) => !recent.includes(f));
  return [...recent, ...rest].slice(0, CHIP_COUNT);
}

/**
 * 保存の状態。ポスト (tweetId + tabId) ごとに 1 つ作り、Current に持たせる (v35)。
 * コンポーネント全体で共有すると、保存中にポストが切り替わったとき、前のポストの保存の途中が新しいポストの選択を見て、前のポストへ書き込んでしまう。
 */
interface SaveState {
  /** 最新の選択 (押した瞬間に更新) */
  sel: string[];
  /** 最後に保存できた選択 */
  saved: string[];
  /** すでに保存してあるか */
  exists: boolean;
  /** 保存の途中か */
  saving: Promise<void> | null;
  removing: boolean;
  removed: boolean;
}

interface Current {
  st: SaveState;
  tweetId: string;
  snapshot: Snapshot;
  tabId: number;
  selected: string[];
  /** すでに PostShelf に保存してある (画像のキャッシュと全文の取得は、保存したときに要求済み) */
  saved: boolean;
}

/**
 * サイドパネル上部に固定する「いま開いているポスト」の枠 (v29)。
 * アクティブタブが x.com/*\/status/* のときだけ表示。ポストの抜粋と、フォルダのチップ (1 タップで保存) を出す。
 * スナップショットは、タブが変わったとき・ポストが変わったときに、そのタブの content script から取る。取れなければ短いエラーを出して何も保存しない。
 */
export function SaveCurrent(props: { folders: Folder[]; onSaved: () => void; /** 保存できない理由 (アカウントを判定できない / 表示中のアカウントが違う)。あるときはチップの代わりにこれを出す */ blockedReason?: string }) {
  const [post, setPost] = useState<ActivePost | null>(null);
  const [cur, setCur] = useState<Current | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [more, setMore] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const tweetRef = useRef('');
  /** いま表示しているポストの保存の状態。前のポストの保存の途中の分は、自分の状態だけを見る */
  const stRef = useRef<SaveState | null>(null);
  useEffect(() => watchActivePost((p) => setPost((old) => (old?.tabId === p?.tabId && old?.tweetId === p?.tweetId ? old : p))), []);
  useEffect(() => {
    const load = () => void getSettings().then((s) => setRecent(s.recentFolderIds ?? []));
    load();
    return onSettingsChanged(load);
  }, []);
  const key = post ? `${post.tabId}:${post.tweetId}` : '';
  useEffect(() => {
    tweetRef.current = key;
    stRef.current = null;
    setCur(null);
    setError('');
    setDone('');
    setMore(false);
    if (!post || props.blockedReason) return;
    void (async () => {
      const r = await requestSnapshot(post);
      if (tweetRef.current !== key) return; // 取っている間に別のポストへ移った
      if (!r) return void setError(t('saveCurrentFail'));
      const prev = await getBookmark(r.tweetId);
      if (tweetRef.current !== key) return;
      const st: SaveState = { sel: prev?.folderIds ?? [], saved: prev?.folderIds ?? [], exists: !!prev, saving: null, removing: false, removed: false };
      stRef.current = st;
      setCur({ st, tweetId: r.tweetId, snapshot: r.snapshot, tabId: post.tabId, selected: prev?.folderIds ?? [], saved: !!prev });
    })();
  }, [key, !!props.blockedReason]);
  if (!post) return null; // x.com 以外のタブ / ポスト以外のページでは出さない

  const frame = (children: preact.ComponentChildren) => (
    <section class="active-post" aria-label={t('activePostTitle')}>
      {children}
    </section>
  );
  if (props.blockedReason)
    return frame(
      <div class="pfoot-note error" role="alert">
        {props.blockedReason}
      </div>,
    );

  /** フォルダ名の並び。区切りは言語ごとの規則 (Intl.ListFormat)。使えない環境では ', ' */
  const joinNames = (names: string[]): string => {
    try {
      return new Intl.ListFormat(chrome.i18n.getUILanguage(), { style: 'narrow', type: 'conjunction' }).format(names);
    } catch {
      return names.join(', ');
    }
  };
  const sameSel = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
  /** 保存する (チェックの切り替えの結果)。全フォルダを外しても、保存は残る (「未分類」になる)。保存の解除は、ごみ箱だけ */
  const commit = async (c: Current, sel: string[]) => {
    const st = c.st;
    await setBookmarkFolders(c.tweetId, sel, c.snapshot);
    // 画像のキャッシュと全文の取得は、保存の状態が変わったとき (新しく保存したとき) だけ要求する
    if (!st.exists) {
      st.exists = true;
      requestCache(c.tweetId, getAccountScope());
      if (c.snapshot.truncated) requestFullText(c.tweetId, getAccountScope()); // たたまれた状態で保存した (v24)
    }
    await requestNativeSync(c.tabId, c.tweetId, true);
    const added = sel.filter((id) => !st.saved.includes(id));
    if (added.length) void updateRecentFolders(added).catch(() => {}); // 「最近使った」(失敗しても保存は成功)
    const names = sel.length ? sel.map((id) => props.folders.find((f) => f.id === id)).filter((f): f is Folder => !!f).map(displayName) : [displayName(props.folders.find((f) => f.id === INBOX_ID) ?? { id: INBOX_ID, name: '', icon: '', order: 0 })];
    if (stRef.current === st) {
      setDone(t('activeSaved', joinNames(names)));
      setError('');
    }
    props.onSaved();
  };
  /**
   * 保存を直列に流す。押した瞬間に最新の選択 (st.sel) とチップの表示を更新し、保存は前の分が終わってから、そのときの最新の選択で行う
   * (連打は最後の状態にまとまる)。失敗したら、最後に保存できた状態に戻してエラーを出す。
   */
  const flushSave = (c: Current) => {
    const st = c.st; // 始めたときの状態だけを見る。ポストが切り替わっても、押された選択はこのポストへ最後まで保存する (切り替わったあとの画面の更新はしない)
    if (st.saving) return st.saving;
    st.saving = (async () => {
      while (!st.removed && (!sameSel(st.sel, st.saved) || !st.exists)) {
        const target = [...st.sel];
        try {
          await commit(c, target);
          st.saved = target;
        } catch {
          st.sel = [...st.saved];
          if (stRef.current === st) {
            setCur((old) => (old && old.st === st ? { ...old, selected: st.sel } : old));
            setError(t('errorStorage'));
          }
          break;
        }
      }
    })().finally(() => { st.saving = null; });
    return st.saving;
  };
  const select = (c: Current, next: string[]) => {
    if (c.st.removing) return;
    c.st.removed = false; // 削除後の明示的な選択でのみ再保存する
    c.st.sel = next;
    setCur((old) => (old && old.st === c.st ? { ...old, selected: next, saved: true } : old));
    void flushSave(c);
  };
  const toggle = (c: Current, id: string) => {
    const now = c.st.sel;
    select(c, now.includes(id) ? now.filter((x) => x !== id && x !== INBOX_ID) : [...now.filter((x) => x !== INBOX_ID), id]);
  };
  const remove = async (c: Current) => {
    const st = c.st;
    if (st.removing) return;
    st.removing = true;
    try {
      await st.saving; // 最新の選択まで保存し終えてから削除する
      await removeBookmark(c.tweetId);
      st.removed = true;
      st.sel = [];
      st.saved = [];
      st.exists = false;
      requestPrune();
      await requestNativeSync(c.tabId, c.tweetId, false);
      if (stRef.current === st) {
        setCur({ ...c, selected: [], saved: false });
        setDone('');
        setError('');
      }
      props.onSaved();
    } catch {
      if (stRef.current === st) setError(t('errorStorage'));
    } finally {
      st.removing = false;
    }
  };

  const chips = chipFolders(props.folders, recent);
  const users = props.folders.filter((f) => f.id !== INBOX_ID);
  const rest = users.length - chips.length;
  const delLabel = t('removeFromPostShelf');
  return frame(
    <>
      <div class="ap-head">
        <b>{t('activePostTitle')}</b>
        {cur?.saved && (
          <button class="icon-btn ap-del" aria-label={delLabel} title={delLabel} onClick={() => void remove(cur)}>
            <Icon name="ti-trash" />
          </button>
        )}
      </div>
      {cur && (
        <div class="ap-excerpt">
          <span class="muted">{cur.snapshot.author} </span>
          {cur.snapshot.text}
        </div>
      )}
      {cur && (
        <div class="ap-chips">
          {chips.map((f) => {
            const on = cur.selected.includes(f.id);
            return (
              <button key={f.id} class={`ap-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggle(cur, f.id)}>
                {on ? <Icon name="ti-check" /> : <Icon name={f.icon} color={f.color} />}
                <span class="ap-chip-name">{displayName(f)}</span>
              </button>
            );
          })}
          {rest > 0 && (
            <span class="menu-anchor">
              <button class="ap-chip" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(!more)}>
                <span class="ap-chip-name">{t('activeMoreFolders', rest)}</span>
                <Icon name="ti-chevron-down" />
              </button>
              {more && (
                <Dropdown onClose={() => setMore(false)} label={t('activeMoreFolders', rest)} class="menu-wide">
                  <FolderPickerHost folders={props.folders} selected={cur.selected} onChange={(sel) => select(cur, [...sel].filter((id) => id !== INBOX_ID))} />
                </Dropdown>
              )}
            </span>
          )}
        </div>
      )}
      {error ? (
        <div class="pfoot-note error" role="alert">
          {error}
        </div>
      ) : (
        done && (
          <div class="pfoot-note muted" role="status">
            ✓ {done}
          </div>
        )
      )}
    </>,
  );
}
