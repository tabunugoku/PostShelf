import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '../shared/Icon';
import { INBOX_ID, displayName, type Bookmark, type Folder } from '../shared/models';
import { formatDate, t } from '../shared/strings';
import type { ViewMode } from '../shared/settings';
import { Dropdown } from './ui';
import { MediaImg } from './MediaImg';

export interface CardProps {
  b: Bookmark;
  view: ViewMode;
  /** 狭いレイアウト (サイドパネル): 操作は右端の「⋮」に集約し、複数選択は「⋮」か長押しで始める */
  compact: boolean;
  selected: boolean;
  /** いずれかのポストが選択されている (選択中はチェックボックスを常に出す) */
  selectionActive: boolean;
  tabbable: boolean;
  folderOf: (id: string) => Folder | undefined;
  pickerOpen: boolean;
  pickerNode: ComponentChildren;
  onSelect: (shift: boolean) => void;
  onFocus: () => void;
  onRemoveFromFolder: (folderId: string) => void;
  onTogglePicker: () => void;
  onDelete: () => void;
  onDragStart: (e: DragEvent) => void;
  /** 画像をクリック (index は 0 始まり)。ビューアを開く */
  onOpenImage: (index: number) => void;
  /** 動画のサムネイルをクリック。X で再生する案内を開く */
  onOpenVideo: () => void;
}

const initials = (name: string) => [...name.trim()].slice(0, 2).join('').toUpperCase();

/** 長押し (500ms) で選択を始める。長押しが成立したら直後の click は無視する */
function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fired = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button,a,input')) return;
      fired.current = false;
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, 500);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onPointerMove: cancel,
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}

function Actions(props: CardProps) {
  const { b } = props;
  const s = b.snapshot;
  const [more, setMore] = useState(false);
  if (props.compact) {
    return (
      <span class="row-actions compact">
        <span class="menu-anchor">
          <button class="icon-btn" aria-label={t('cardMenu')} title={t('cardMenu')} aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}>
            <Icon name="ti-dots-vertical" />
          </button>
          {more && (
            <Dropdown onClose={() => setMore(false)} label={t('cardMenu')} class="menu-card">
              <button class="menu-item" onClick={() => { setMore(false); props.onTogglePicker(); }}>
                <Icon name="ti-folder-plus" /> {t('changeFolder')}
              </button>
              <a class="menu-item" href={s.url} target="_blank" rel="noopener noreferrer" onClick={() => setMore(false)}>
                <Icon name="ti-external-link" /> {t('openOnX')}
              </a>
              <button class="menu-item" onClick={() => { setMore(false); props.onSelect(false); }}>
                <Icon name="ti-checkbox" /> {t('selectMode')}
              </button>
              <button class="menu-item danger-text" onClick={() => { setMore(false); props.onDelete(); }}>
                <Icon name="ti-trash" /> {t('deletePost')}
              </button>
            </Dropdown>
          )}
          {props.pickerNode}
        </span>
      </span>
    );
  }
  return (
    <span class="row-actions">
      <span class="menu-anchor">
        <button class="icon-btn" aria-label={t('changeFolder')} title={t('changeFolder')} aria-expanded={props.pickerOpen} onClick={props.onTogglePicker}>
          <Icon name="ti-folder-plus" />
        </button>
        {props.pickerNode}
      </span>
      <a class="icon-btn" href={s.url} target="_blank" rel="noopener noreferrer" title={t('openOnX')} aria-label={t('openOnX')}>
        <Icon name="ti-external-link" />
      </a>
      <button class="icon-btn" aria-label={t('deletePost')} title={t('deletePost')} onClick={props.onDelete}>
        <Icon name="ti-trash" />
      </button>
    </span>
  );
}

/**
 * 画像 / 動画サムネイルのボタン。選択モード (いずれかのポストが選択されている) 中は、クリックで選択を切り替える (ビューアは開かない)。
 * hover / フォーカスで「拡大」のヒント。フォーカスリングは CSS (.ph:focus-visible)。
 */
function MediaTile(props: { card: CardProps; kind: 'image' | 'video'; index?: number; total?: number; extra?: number }) {
  const { card } = props;
  const s = card.b.snapshot;
  const i = props.index ?? 0;
  const label = props.kind === 'image' ? t('viewImage', i + 1, props.total ?? 1) : t('videoOpenLabel');
  const click = (e: MouseEvent) => {
    if (card.selectionActive) {
      e.preventDefault();
      card.onSelect(e.shiftKey);
    } else if (props.kind === 'image') card.onOpenImage(i);
    else card.onOpenVideo();
  };
  return (
    <button class={`ph${props.kind === 'video' ? ' v' : ''}`} aria-label={label} title={label} onClick={click}>
      {props.kind === 'image' ? (
        <MediaImg tweetId={card.b.tweetId} name={String(i + 1)} src={s.media[i]} alt="" loading="lazy" />
      ) : (
        <>
          {s.videoPoster && <MediaImg tweetId={card.b.tweetId} name="video-thumb" src={s.videoPoster} alt="" loading="lazy" />}
          <span class="play" aria-hidden="true" />
          <span class="badge">{t('videoBadge')}</span>
        </>
      )}
      {props.kind === 'image' && !card.selectionActive && <span class="hint">{t('zoomHint')}</span>}
      {props.extra ? <span class="more">+{props.extra}</span> : null}
    </button>
  );
}

function FolderChips(props: { b: Bookmark; folderOf: CardProps['folderOf']; removable: boolean; onRemove: (id: string) => void }) {
  const { b, folderOf } = props;
  return (
    <div class="act">
      {b.folderIds.map((id) => {
        const f = folderOf(id);
        if (!f) return null;
        const only = b.folderIds.length === 1 && id === INBOX_ID; // 未分類しか無いときは外す意味がない
        const label = t('removeFromFolder', displayName(f));
        return props.removable && !only ? (
          <button class="tag chip" title={label} aria-label={label} onClick={() => props.onRemove(id)}>
            <Icon name={f.icon} color={f.color} /> {displayName(f)} <Icon name="ti-x" />
          </button>
        ) : (
          <span class="tag">
            <Icon name={f.icon} color={f.color} /> {displayName(f)}
          </span>
        );
      })}
    </div>
  );
}

export function Card(props: CardProps) {
  const { b, view, compact } = props;
  const s = b.snapshot;
  const long = useLongPress(() => props.onSelect(false));
  const first = props.folderOf(b.folderIds[0]);
  const showCheck = !compact || props.selectionActive;
  const check = showCheck ? (
    <input
      type="checkbox"
      class="sel"
      aria-label={t('selectPost')}
      checked={props.selected}
      onClick={(e) => props.onSelect((e as MouseEvent).shiftKey)}
      onChange={() => {}}
    />
  ) : null;
  const cls = `${view === 'list' ? 'mini' : view === 'grid' ? 'gc' : 'post'}${props.selected ? ' selected' : ''}${compact ? ' compact' : ''}`;
  const common = {
    'data-row': b.tweetId,
    class: cls,
    role: 'listitem',
    tabIndex: props.tabbable ? 0 : -1,
    draggable: !compact,
    onDragStart: props.onDragStart,
    onFocus: props.onFocus,
    ...(compact ? long : {}),
  } as JSX.HTMLAttributes<HTMLElement>;

  if (view === 'list') {
    return (
      <div {...(common as unknown as JSX.HTMLAttributes<HTMLDivElement>)}>
        {check}
        {first ? <Icon name={first.icon} color={first.color} /> : <Icon name="ti-bookmark" />}
        <span class="handle">{s.handle}</span>
        <span class="t">{s.text}</span>
        <Actions {...props} />
      </div>
    );
  }
  if (view === 'grid') {
    return (
      <article {...common}>
        {check}
        {s.media[0] ? (
          <div class="cover-wrap">
            <MediaTile card={props} kind="image" index={0} total={s.media.length} />
          </div>
        ) : s.hasVideo ? (
          <div class="cover-wrap">
            <MediaTile card={props} kind="video" />
          </div>
        ) : null}
        <div class="gc-head">
          <strong>{s.author}</strong> <span class="muted">{s.handle}</span>
        </div>
        <div class="gc-text">{s.text}</div>
        <FolderChips b={b} folderOf={props.folderOf} removable={false} onRemove={props.onRemoveFromFolder} />
        <Actions {...props} />
      </article>
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
        {s.media.length > 0 ? (
          <div class={`media m${Math.min(s.media.length, 4)}`}>
            {s.media.slice(0, 4).map((_, i) => (
              <MediaTile card={props} kind="image" index={i} total={s.media.length} extra={i === 3 && s.media.length > 4 ? s.media.length - 4 : 0} />
            ))}
          </div>
        ) : s.hasVideo ? (
          <div class="media m1">
            <MediaTile card={props} kind="video" />
          </div>
        ) : null}
        <FolderChips b={b} folderOf={props.folderOf} removable onRemove={props.onRemoveFromFolder} />
      </div>
      <Actions {...props} />
    </article>
  );
}
