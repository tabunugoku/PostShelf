import { useRef, useState } from 'preact/hooks';
import { Component, type ComponentChildren, type JSX } from 'preact';
import { Icon } from '../shared/Icon';
import { INBOX_ID, displayName, type Bookmark, type Folder } from '../shared/models';
import { formatDate, t } from '../shared/strings';
import type { ViewMode } from '../shared/settings';
import { Dropdown } from './ui';
import { MediaImg } from './MediaImg';
import { PostText } from './PostText';
import { QuoteBlock } from './QuoteBlock';
import { VideoTileContent } from './VideoTile';
import { MediaGrid } from './MediaGrid';
import type { Snapshot } from '../shared/models';

/**
 * 動画と画像の札 (v20-A)。判定は、保存してある snapshot.hasVideo と snapshot.media.length だけ (新しい取得はしない)。
 * 動画のポストには、画像の枚数の札を付けない (media に動画のサムネイルが入っていても、枚数に数えない)。
 * hasVideo が無い (v7 より前に保存した) ポストは、動画かどうか分からないので、動画の札は付かない。X の GIF は動画として扱われ、「動画」になる。
 */
export function mediaKindOf(s: Snapshot): { kind: 'video' } | { kind: 'images'; count: number } | null {
  if (s.hasVideo === true) return { kind: 'video' };
  return s.media.length >= 2 ? { kind: 'images', count: s.media.length } : null;
}

/** リスト表示の、行の右端の札 (動画は青い塗り、画像は枠だけの控えめな見た目) */
function MediaMark({ s }: { s: Snapshot }) {
  const k = mediaKindOf(s);
  if (!k) return null;
  if (k.kind === 'video')
    return (
      <span class="mk v" role="img" aria-label={t('videoBadge')}>
        <Icon name="ti-video" /> {t('videoBadge')}
      </span>
    );
  return (
    <span class="mk" role="img" aria-label={t('mediaImages', k.count)}>
      <Icon name="ti-photo" /> {k.count}
    </span>
  );
}

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
            <Dropdown fixed onClose={() => setMore(false)} label={t('cardMenu')} class="menu-card">
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
function MediaTile(props: { card: CardProps; kind: 'image' | 'video'; index?: number; total?: number; extra?: number; /** 画像が 2 枚以上のとき、右下に「重なり + 枚数」の札を出す (グリッドの表紙) */ countBadge?: boolean }) {
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
        <VideoTileContent>
          {s.videoPoster && <MediaImg tweetId={card.b.tweetId} name="video-thumb" src={s.videoPoster} alt="" loading="lazy" />}
        </VideoTileContent>
      )}
      {props.kind === 'image' && !card.selectionActive && <span class="hint">{t('zoomHint')}</span>}
      {props.countBadge && (props.total ?? 0) >= 2 && !card.b.snapshot.hasVideo && (
        <span class="cnt" role="img" aria-label={t('mediaImages', props.total ?? 0)}>
          <Icon name="ti-stack-2" /> {props.total}
        </span>
      )}
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

/** 行の操作。ポストの ID を引数に取る。親が 1 度だけ作る安定したオブジェクト (中身は最新の状態を見る) なので、Card の memo が効く */
export interface RowHandlers {
  select(id: string, shift: boolean): void;
  focus(id: string): void;
  removeFromFolder(id: string, folderId: string): void;
  togglePicker(id: string): void;
  del(id: string): void;
  dragStart(id: string, e: DragEvent): void;
  openImage(id: string, index: number): void;
  openVideo(id: string): void;
}
type HandlerKeys = 'onSelect' | 'onFocus' | 'onRemoveFromFolder' | 'onTogglePicker' | 'onDelete' | 'onDragStart' | 'onOpenImage' | 'onOpenVideo';
export type CardOuterProps = Omit<CardProps, HandlerKeys> & { h: RowHandlers };

/**
 * 再描画を減らす (memo)。値の props (ポスト・選択・表示形式など) と h (安定) が変わらないカードは、描き直さない。
 * preact/compat は入力イベントの扱いを変えるので使わず、shouldComponentUpdate の薄い包みにする。
 */
export class Card extends Component<CardOuterProps> {
  shouldComponentUpdate(next: CardOuterProps): boolean {
    const a = this.props as unknown as Record<string, unknown>;
    const b = next as unknown as Record<string, unknown>;
    for (const k in b) if (a[k] !== b[k]) return true;
    for (const k in a) if (!(k in b)) return true;
    return false;
  }
  render(props: CardOuterProps) {
    return <CardView {...props} />;
  }
}

function CardView(outer: CardOuterProps) {
  const { h, ...rest } = outer;
  const id = outer.b.tweetId;
  const hasMedia = outer.b.snapshot.media.length > 0;
  const props: CardProps = {
    ...rest,
    onSelect: (shift) => h.select(id, shift),
    onFocus: () => h.focus(id),
    onRemoveFromFolder: (fid) => h.removeFromFolder(id, fid),
    onTogglePicker: () => h.togglePicker(id),
    onDelete: () => h.del(id),
    onDragStart: (e) => h.dragStart(id, e),
    onOpenImage: (index) => hasMedia && h.openImage(id, index),
    onOpenVideo: () => h.openVideo(id),
  };
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
        <MediaMark s={s} />
        <Actions {...props} />
      </div>
    );
  }
  if (view === 'grid') {
    return (
      <article {...common}>
        {check}
        {s.hasVideo === true ? (
          <div class="cover-wrap">
            <MediaTile card={props} kind="video" />
          </div>
        ) : s.media[0] ? (
          <div class="cover-wrap">
            <MediaTile card={props} kind="image" index={0} total={s.media.length} countBadge />
          </div>
        ) : null}
        <div class="gc-head">
          <strong>{s.author}</strong> <span class="muted">{s.handle}</span>
        </div>
        <div class="gc-text">{s.text}</div>
        <div class="gc-foot">
          <FolderChips b={b} folderOf={props.folderOf} removable={false} onRemove={props.onRemoveFromFolder} />
          <Actions {...props} />
        </div>
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
        <PostText s={s} />
        {s.quote && <QuoteBlock quote={s.quote} tweetId={b.tweetId} />}
        {s.hasVideo === true ? (
          <MediaGrid count={1}>
            <MediaTile card={props} kind="video" />
          </MediaGrid>
        ) : s.media.length > 0 ? (
          <MediaGrid count={s.media.length}>
            {s.media.slice(0, 4).map((_, i) => (
              <MediaTile card={props} kind="image" index={i} total={s.media.length} extra={i === 3 && s.media.length > 4 ? s.media.length - 4 : 0} />
            ))}
          </MediaGrid>
        ) : null}
        <FolderChips b={b} folderOf={props.folderOf} removable onRemove={props.onRemoveFromFolder} />
      </div>
      <Actions {...props} />
    </article>
  );
}
