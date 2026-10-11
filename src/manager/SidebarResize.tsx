import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { DEFAULT_SIDEBAR_WIDTH, getSettings, onSettingsChanged, updateSettings } from '../shared/settings';
import { t } from '../shared/strings';
import { reportStorageError } from './errorBus';

/** 幅の範囲。最小は 180px、最大は画面幅の半分 (画面が狭ければ、最小も最大に合わせる) */
export function sidebarBounds(viewport: number): { min: number; max: number } {
  const max = Math.max(1, Math.floor(viewport / 2));
  return { min: Math.min(180, max), max };
}

export function clampSidebarWidth(width: number, viewport: number): number {
  const { min, max } = sidebarBounds(viewport);
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH)));
}

const pixels = (value: string) => Number.parseFloat(value) || 0;

/** 描画されている行だけを測る。余白・字下げ・開閉の矢印・アイコン・名前・件数を数え、重なって出る ⋯ メニューは除く */
export function fitSidebarWidth(sidebar: HTMLElement, viewport: number): number {
  const side = getComputedStyle(sidebar);
  let longest = 0;
  for (const row of sidebar.querySelectorAll<HTMLElement>('.fr[data-folder-id]')) {
    const style = getComputedStyle(row);
    if (row.hidden || style.display === 'none') continue;
    const children = [...row.children].filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) return false;
      const css = getComputedStyle(child);
      return css.display !== 'none' && css.position !== 'absolute' && css.position !== 'fixed';
    });
    const content = children.reduce((sum, child) => {
      const css = getComputedStyle(child);
      // 名前は省略されて隠れている分も含めた、本来の幅で測る
      const measured = child.classList.contains('fr-name')
        ? child.scrollWidth
        : Math.max(child.getBoundingClientRect().width, child.scrollWidth, pixels(css.width), pixels(css.minWidth));
      return sum + measured + pixels(css.marginLeft) + pixels(css.marginRight);
    }, 0);
    const gaps = Math.max(0, children.length - 1) * pixels(style.columnGap || style.gap);
    const padding = pixels(style.paddingLeft) + pixels(style.paddingRight) + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
    longest = Math.max(longest, content + gaps + padding);
  }
  const sidePadding = pixels(side.paddingLeft) + pixels(side.paddingRight) + pixels(side.borderLeftWidth) + pixels(side.borderRightWidth);
  return clampSidebarWidth(Math.ceil(longest + sidePadding) + 2, viewport);
}

/** タブの管理画面のサイドバーの幅を変える境界。幅は端末の設定として、設定の共通の窓口 (settings.ts) 経由で保存する */
export function SidebarResize({ sidebar }: { sidebar: RefObject<HTMLElement> }) {
  /** 保存されている (または、ドラッグ中の) 幅。画面幅に合わせた表示上の幅は width */
  const [preference, setPreference] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number; current: number } | null>(null);
  /** 最後に保存された (読み込んだ) 幅 */
  const saved = useRef(DEFAULT_SIDEBAR_WIDTH);
  const live = useRef(true);
  const width = clampSidebarWidth(preference, viewport);
  const bounds = sidebarBounds(viewport);

  /** 幅を確定して保存する。保存に失敗したら、保存済みの幅に戻して、エラーを知らせる */
  const commit = (next: number) => {
    setPreference(next);
    if (next === saved.current) return;
    void updateSettings({ sidebarWidth: next }).catch(() => {
      if (live.current) setPreference(saved.current);
      reportStorageError();
    });
  };

  useLayoutEffect(() => {
    root.current?.parentElement?.style.setProperty('--sidebar-width', width + 'px');
  }, [width]);

  useEffect(() => {
    live.current = true;
    const sync = (s: Awaited<ReturnType<typeof getSettings>>) => {
      const next = s.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH;
      if (!live.current || next === saved.current) return;
      saved.current = next;
      if (!drag.current) setPreference(next);
    };
    void getSettings().then(sync).catch(reportStorageError);
    const off = onSettingsChanged(sync);
    const resize = () => setViewport(window.innerWidth);
    const cancel = () => {
      if (!drag.current) return;
      setPreference(drag.current.width);
      drag.current = null;
      setDragging(false);
    };
    const move = (e: PointerEvent) => {
      if (!drag.current || e.pointerId !== drag.current.pointerId) return;
      e.preventDefault();
      drag.current.current = clampSidebarWidth(drag.current.width + e.clientX - drag.current.x, window.innerWidth);
      setPreference(drag.current.current);
    };
    const end = (e: PointerEvent) => {
      if (!drag.current || e.pointerId !== drag.current.pointerId) return;
      const next = drag.current.current;
      drag.current = null;
      setDragging(false);
      commit(next);
    };
    // ドラッグ中の Esc は、保存せずに元の幅へ戻す
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('resize', resize);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    return () => {
      live.current = false;
      off();
      window.removeEventListener('resize', resize);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
    };
  }, []);

  return (
    <div
      ref={root}
      class={'sidebar-resizer' + (dragging ? ' dragging' : '')}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t('sidebarResize')}
      title={t('sidebarResize')}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={width}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        root.current?.focus();
        drag.current = { pointerId: e.pointerId, x: e.clientX, width, current: width };
        setDragging(true);
      }}
      onDblClick={() => {
        if (sidebar.current) commit(fitSidebarWidth(sidebar.current, window.innerWidth));
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        commit(clampSidebarWidth(width + (e.key === 'ArrowLeft' ? -10 : 10), window.innerWidth));
      }}
    />
  );
}
