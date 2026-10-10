import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { createFolderMenu } from '../shared/folderCreateMenu';
import { INBOX_ID, displayName, type Bookmark, type Folder } from '../shared/models';
import { addToFolders, removeFromFolders, setBookmarkFolders } from '../shared/storage';
import { updateRecentFolders } from '../shared/settings';
import { formatDate, t } from '../shared/strings';
import { MediaImg } from './MediaImg';
import { PostText } from './PostText';
import { Dropdown, FolderPickerHost } from './ui';

/** 数字キーに割り当てるフォルダの数 (残りは「他のフォルダ」から選ぶ) */
export const TRIAGE_KEYS = 9;
const FOCUSABLE = 'button:not([disabled]),a[href],input,[tabindex="0"]';
const THEME = { fg: 'var(--text-primary)', border: 'var(--border-strong)', hover: 'var(--fill-ghost-hover)', accent: 'var(--fill-accent)' };

/** キーボードで押された数字 (1〜9)。Shift を押していると e.key は記号になるので e.code で見る */
export function digitOf(e: { code: string }): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : null;
}

/**
 * 未分類の「仕分けモード」(v29)。始めた時点の未分類を 1 件ずつ大きく見せて、数字キー 1 つでフォルダに入れる。
 * キュー (queue) は始めた時点で固定する。途中で保存データが変わっても並びは変えず、削除されたポスト (live に無い) は飛ばす。
 * キーは、ダイアログの要素だけが受ける (window には付けない)。
 */
export function Triage(props: {
  /** 始めた時点の設定。オフなら従来の即時保存 */
  multi?: boolean;
  queue: Bookmark[];
  /** いま保存されているポストの ID (キューのポストが削除されたかの判定) */
  live: Set<string>;
  /** ユーザーのフォルダ (並び順) */
  folders: Folder[];
  /** フォルダ選択の「未分類」入りの一覧 */
  pickerFolders: Folder[];
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { queue } = props;
  const [index, setIndex] = useState(0);
  const [assigned, setAssigned] = useState<Record<string, string[]>>(() => Object.fromEntries(queue.map((b) => [b.tweetId, b.folderIds])));
  const [sorted, setSorted] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ tweetId: string; ids: Set<string> } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const previousMenus = useRef({ creating, more });
  /** choose の実行中 (await のあいだ) は、次の choose を受けない */
  const busy = useRef(false);
  const latest = useRef({ index, finished, more, creating });
  latest.current = { index, finished, more, creating };
  const cur = queue[index];
  const multi = props.multi === true;
  const savedIds = (b: Bookmark) => (assigned[b.tweetId] ?? []).filter(id => id !== INBOX_ID);
  const marks = cur && draft?.tweetId === cur.tweetId ? draft.ids : new Set(cur ? savedIds(cur) : []);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    const prev = previousMenus.current;
    previousMenus.current = { creating, more };
    // 入力欄ごとメニューが外れるとフォーカスは body に落ちる。残っているボタンのフォーカスは保つ。
    if ((prev.creating && !creating) || (prev.more && !more)) {
      if (!root.current?.contains(document.activeElement)) root.current?.focus();
    }
  }, [creating, more]);

  const isLive = (i: number) => props.live.has(queue[i].tweetId);
  const step = (from: number, d: 1 | -1): number | null => {
    for (let i = from + d; i >= 0 && i < queue.length; i += d) if (isLive(i)) return i;
    return null;
  };
  const next = () => {
    setDraft(null);
    const i = step(index, 1);
    if (i === null) setFinished(true);
    else setIndex(i);
  };
  const back = () => {
    setDraft(null);
    const i = step(index, -1);
    if (i !== null) setIndex(i);
  };
  // 開いた時点で削除済みのポストにいる場合 (キューの先頭が消えていた等) は、次の生きているポストへ
  useEffect(() => {
    if (!finished && cur && !isLive(index)) {
      const i = step(index, 1);
      if (i === null) setFinished(true);
      else setIndex(i);
    }
  }, [props.live, index, finished]);

  const mark = (b: Bookmark, ids: string[]) => {
    setAssigned((a) => ({ ...a, [b.tweetId]: ids }));
    setSorted((s) => {
      const n = new Set(s);
      if (ids.some((id) => id !== INBOX_ID)) n.add(b.tweetId);
      else n.delete(b.tweetId);
      return n;
    });
  };
  /** そのフォルダに入れる (入っていれば外す)。stay: 同じポストに留まる */
  const choose = async (folderId: string, stay: boolean) => {
    if (!cur || finished || busy.current) return;
    if (multi) {
      setDraft(prev => {
        const ids = new Set(prev?.tweetId === cur.tweetId ? prev.ids : savedIds(cur));
        if (ids.has(folderId)) ids.delete(folderId);
        else ids.add(folderId);
        return { tweetId: cur.tweetId, ids };
      });
      return;
    }
    busy.current = true;
    const b = cur;
    const has = (assigned[b.tweetId] ?? []).includes(folderId);
    try {
      if (has) await removeFromFolders([b.tweetId], [folderId]);
      else await addToFolders([b.tweetId], [folderId]);
      const base = (assigned[b.tweetId] ?? []).filter((id) => id !== INBOX_ID);
      const ids = has ? base.filter((id) => id !== folderId) : [...base, folderId];
      mark(b, ids.length ? ids : [INBOX_ID]);
      if (!has) void updateRecentFolders([folderId]).catch(() => {}); // 「最近使った」(失敗しても仕分けは続ける)
      setError('');
      void props.onChanged();
      if (!stay && !has) next();
    } catch {
      setError(t('errorStorage'));
    } finally {
      busy.current = false;
    }
  };

  const confirm = async () => {
    if (!cur || finished || busy.current) return;
    busy.current = true;
    try {
      const ids = [...marks];
      const before = savedIds(cur);
      if (ids.length !== before.length || ids.some(id => !before.includes(id))) {
        await setBookmarkFolders(cur.tweetId, ids, cur.snapshot);
        const added = ids.filter(id => !before.includes(id));
        if (added.length) void updateRecentFolders(added).catch(() => {});
        mark(cur, ids.length ? ids : [INBOX_ID]);
        void props.onChanged();
      }
      setError('');
      setMore(false);
      next();
    } catch {
      setError(t('errorStorage'));
    } finally {
      busy.current = false;
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const s = latest.current;
      if (s.creating) setCreating(false);
      else if (s.more) setMore(false);
      else props.onClose();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!items.length) return e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const nx = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[nx].focus();
      return;
    }
    // 通常の入力・ボタン・リンクの Enter はブラウザに任せる。チェックからは確定できる。
    const target = e.target as HTMLElement;
    const checkbox = target instanceof HTMLInputElement && target.type === 'checkbox';
    if (multi && e.key === 'Enter' && !creating && !finished && !e.ctrlKey && !e.metaKey && !e.altKey
      && (!typing || checkbox) && !target.closest('button,a[href]')) {
      e.preventDefault();
      if (!e.repeat) void confirm();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || finished || creating || more) return; // 入力欄・開いているメニューの中では、キーを奪わない
    const d = digitOf(e);
    if (e.repeat && (d !== null || e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'n' || e.key === 'N')) {
      e.preventDefault(); // 押しっぱなしの繰り返しは、続くポストに効かせない
      return;
    }
    if (d !== null) {
      const f = props.folders[d - 1];
      if (d <= TRIAGE_KEYS && f) {
        e.preventDefault();
        void choose(f.id, e.shiftKey);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!multi || !busy.current) next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!multi || !busy.current) back();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      setCreating(true);
    }
  };

  const keyed = props.folders.slice(0, TRIAGE_KEYS);
  const hasMore = props.folders.length > TRIAGE_KEYS;
  const total = queue.length;
  return (
    <div class="overlay" onClick={props.onClose}>
      <div
        ref={root}
        class="dialog dialog-wide triage"
        role="dialog"
        aria-modal="true"
        aria-labelledby="triage-title"
        tabIndex={-1}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
      >
        {finished || !cur ? (
          <>
            <h2 id="triage-title" class="dialog-title">{t('triageDone')}</h2>
            <p role="status">{t('triageDoneSub', sorted.size)}</p>
            <div class="dialog-actions">
              <button class="primary" autoFocus onClick={props.onClose}>
                {t('dismiss')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div class="triage-top">
              <h2 id="triage-title" class="dialog-title">{t('triageStart')}</h2>
              <span class="muted triage-progress">{t('triageProgress', index + 1, total)}</span>
            </div>
            <div class="triage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1} aria-label={t('triageStart')}>
              <i style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
            <article class="triage-post" aria-live="polite">
              <div class="triage-meta">
                <b>{cur.snapshot.author}</b> <span class="muted">{cur.snapshot.handle}</span>
                {cur.snapshot.createdAt && <span class="muted"> · {formatDate(cur.snapshot.createdAt)}</span>}
              </div>
              <PostText key={cur.tweetId} s={cur.snapshot} />
              {cur.snapshot.media[0] && (
                <div class="triage-media">
                  <MediaImg tweetId={cur.tweetId} name="1" src={cur.snapshot.media[0]} alt="" loading="eager" />
                </div>
              )}
            </article>
            {error && (
              <p class="error" role="alert">
                {error}
              </p>
            )}
            <div class="triage-folders">
              {keyed.map((f, i) => {
                const on = multi ? marks.has(f.id) : (assigned[cur.tweetId] ?? []).includes(f.id);
                return (
                  <button key={f.id} class={`triage-folder${on ? ' on' : ''}`} aria-pressed={on} onClick={(e) => void choose(f.id, e.shiftKey)}>
                    <kbd>{i + 1}</kbd>
                    {on ? <Icon name="ti-check" /> : <Icon name={f.icon} color={f.color} />}
                    <span class="triage-folder-name">{displayName(f)}</span>
                  </button>
                );
              })}
              {hasMore && (
                <span class="menu-anchor">
                  <button class="triage-folder" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(!more)}>
                    <span class="triage-folder-name">{t('triageOtherFolders')}</span>
                    <Icon name="ti-chevron-down" />
                  </button>
                  {more && (
                    <Dropdown fixed onClose={() => setMore(false)} label={t('triageOtherFolders')} class="menu-wide menu-over">
                      <div onKeyDown={multi ? (e) => { if (e.key === 'Enter') onKey(e); } : undefined}>
                        <FolderPickerHost
                          folders={props.pickerFolders}
                          selected={multi ? [...marks] : assigned[cur.tweetId] ?? []}
                          onChange={async (sel, source) => {
                            if (!cur || finished || busy.current) return;
                            if (multi && source !== 'created') {
                              setDraft({ tweetId: cur.tweetId, ids: new Set([...sel].filter(id => id !== INBOX_ID)) });
                              return;
                            }
                            busy.current = true;
                            try {
                              const ids = [...sel];
                              // 最後のチェックを外して戻る「未分類」は、新しい分類には数えない。
                              const added = ids.filter((id) => id !== INBOX_ID && !(assigned[cur.tweetId] ?? []).includes(id));
                              await setBookmarkFolders(cur.tweetId, ids, cur.snapshot);
                              if (added.length) void updateRecentFolders(added).catch(() => {});
                              mark(cur, ids);
                              setError('');
                              void props.onChanged();
                              if (added.length && (source !== 'created' || multi)) {
                                setMore(false);
                                next();
                              }
                            } catch {
                              setError(t('errorStorage'));
                            } finally {
                              busy.current = false;
                            }
                          }}
                        />
                      </div>
                    </Dropdown>
                  )}
                </span>
              )}
              <button class="triage-folder" aria-keyshortcuts="N" onClick={() => setCreating(true)}>
                <kbd>N</kbd>
                <Icon name="ti-folder-plus" />
                <span class="triage-folder-name">{t('newFolder')}</span>
              </button>
            </div>
            {creating && (
              <NewFolder
                existing={props.pickerFolders}
                onCreated={async (f) => {
                  if (latest.current.finished) return;
                  try {
                    await addToFolders([cur.tweetId], [f.id]);
                    void updateRecentFolders([f.id]).catch(() => {});
                    mark(cur, [...(assigned[cur.tweetId] ?? []).filter((id) => id !== INBOX_ID), f.id]);
                    setCreating(false);
                    setError('');
                    void props.onChanged();
                    if (multi) next();
                  } catch {
                    setError(t('errorStorage'));
                  }
                }}
                onClose={() => setCreating(false)}
              />
            )}
            <div class="dialog-actions triage-actions">
              <span class="muted triage-hint">{t(multi ? 'triageMultiDesc' : 'triageHint')}</span>
              <span class="grow" />
              {multi && <button class="primary triage-confirm" aria-keyshortcuts="Enter" onClick={() => void confirm()}><kbd>Enter</kbd> {t('triageConfirm')}</button>}
              <button disabled={step(index, -1) === null} aria-keyshortcuts="ArrowLeft" onClick={() => { if (!multi || !busy.current) back(); }}>
                {t('triageBack')}
              </button>
              <button aria-keyshortcuts="ArrowRight" onClick={() => { if (!multi || !busy.current) next(); }}>
                {t('triageSkip')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 既存の「フォルダを作成」メニューを、ダイアログの中に置く */
function NewFolder(props: { existing: Folder[]; onCreated: (f: Folder) => void | Promise<void>; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const menu = createFolderMenu({ theme: THEME, existing: () => latest.current.existing, onCreated: (f) => latest.current.onCreated(f), onClose: () => latest.current.onClose() });
    host.current?.replaceChildren(menu.el);
    menu.focus();
  }, []);
  return <div ref={host} class="picker-host triage-new" />;
}
