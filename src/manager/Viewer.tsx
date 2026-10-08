import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/Icon';
import { viewerCandidates } from '../shared/media';
import { t } from '../shared/strings';
import { MediaImg } from './MediaImg';

const FOCUSABLE = 'button:not([disabled]),a[href]';

/**
 * ビューアと動画の案内の共通の枠 (暗い背景の全面表示)。
 * role=dialog / aria-modal。開いたら閉じるボタンにフォーカスし、閉じたら元のボタンへ戻す。
 * Tab はダイアログの中で循環する。Esc と背景のクリックで閉じる。
 */
function Shell(props: { label: string; counter?: string; onClose: () => void; onKey?: (e: KeyboardEvent) => boolean; children: ComponentChildren }) {
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const latest = useRef(props); // キーボードの処理は最初の 1 回だけ登録するので、常に最新の props を参照する
  latest.current = props;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        latest.current.onClose();
      } else if (latest.current.onKey?.(e)) {
        e.preventDefault();
      } else if (e.key === 'Tab') {
        const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        e.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="viewer" ref={root} role="dialog" aria-modal="true" aria-label={props.label} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="viewer-bar">
        <span class="viewer-count">{props.counter}</span>
        <button ref={closeBtn} class="round" aria-label={t('viewerClose')} title={t('viewerClose')} onClick={props.onClose}>
          <Icon name="ti-x" />
        </button>
      </div>
      {props.children}
    </div>
  );
}

/** 画像の全面表示。保存済みの URL (小さいサイズ) を大きいサイズに差し替えて読む。読めなければ失敗の表示 */
export function ImageViewer(props: { tweetId: string; urls: string[]; index: number; postUrl: string; onIndex: (i: number) => void; onClose: () => void }) {
  const { urls, index } = props;
  const n = urls.length;
  const stored = urls[index];
  const cands = viewerCandidates(stored);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [small, setSmall] = useState(false);
  const [smallFailed, setSmallFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setSmall(false);
    setSmallFailed(false);
  }, [index]);
  const go = (d: number) => props.onIndex((index + d + n) % n); // 端で循環する
  const onKey = (e: KeyboardEvent) => {
    if (n > 1 && e.key === 'ArrowRight') return go(1), true;
    if (n > 1 && e.key === 'ArrowLeft') return go(-1), true;
    return false;
  };
  const showFail = failed && (!small || smallFailed);
  return (
    <Shell label={t('viewerLabel')} counter={`${index + 1} / ${n}`} onClose={props.onClose} onKey={onKey}>
      {n > 1 && (
        <>
          <button class="round nav l" aria-label={t('viewerPrev')} onClick={() => go(-1)}>
            <Icon name="ti-chevron-left" />
          </button>
          <button class="round nav r" aria-label={t('viewerNext')} onClick={() => go(1)}>
            <Icon name="ti-chevron-right" />
          </button>
        </>
      )}
      {showFail ? (
        <div class="viewer-center" role="alert">
          <div>
            <Icon name="ti-photo-off" />
            <b>{t('viewerFailTitle')}</b>
            <p>{t('viewerFailReason')}</p>
          </div>
        </div>
      ) : failed && small ? (
        <div class="viewer-img">
          <MediaImg key={`s${index}`} tweetId={props.tweetId} name={String(index + 1)} src={stored} alt="" onError={() => setSmallFailed(true)} />
        </div>
      ) : (
        <div class="viewer-img">
          <MediaImg key={`${index}-${attempt}`} tweetId={props.tweetId} name={String(index + 1)} src={cands[attempt]} cacheable={attempt === 0 && cands.length >= 1} alt="" onError={() => (attempt + 1 < cands.length ? setAttempt(attempt + 1) : setFailed(true))} />
        </div>
      )}
      <div class="viewer-foot">
        {!failed && (
          <a class="viewer-btn primary" href={cands[attempt]} target="_blank" rel="noopener noreferrer">
            {t('viewerOpenOriginal')}
          </a>
        )}
        <a class="viewer-btn" href={props.postUrl} target="_blank" rel="noopener noreferrer">
          {t('viewerOpenPost')}
        </a>
        {failed && !small && (
          <button class="viewer-btn" onClick={() => setSmall(true)}>
            {t('viewerShowSmall')}
          </button>
        )}
      </div>
    </Shell>
  );
}

/** 動画のクリック: 再生用のファイルは保存できないので、X で再生するよう案内する (サムネイルがあれば背景に出す) */
export function VideoGuide(props: { poster?: string; tweetId: string; postUrl: string; onClose: () => void }) {
  return (
    <Shell label={t('videoDialogTitle')} counter={t('videoBadge')} onClose={props.onClose}>
      <div class="viewer-img viewer-video">
        {props.poster && <MediaImg tweetId={props.tweetId} name="video-thumb" src={props.poster} alt="" />}
        <span class="play" aria-hidden="true" />
      </div>
      <div class="viewer-center viewer-guide">
        <div>
          <b>{t('videoDialogTitle')}</b>
          <p>{t('videoDialogBody')}</p>
        </div>
      </div>
      <div class="viewer-foot">
        <a class="viewer-btn primary" href={props.postUrl} target="_blank" rel="noopener noreferrer">
          {t('videoPlayOnX')}
        </a>
      </div>
    </Shell>
  );
}
