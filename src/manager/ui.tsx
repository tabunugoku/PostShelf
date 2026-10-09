import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { render } from 'preact';
import { createFolderPicker } from '../shared/folderPicker';
import { displayName, type Folder } from '../shared/models';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';

/** アプリ内の確認ダイアログ (window.confirm は使わない)。Esc / 外側クリック / キャンセルで閉じ、フォーカスを元に戻す */
export function Confirm(props: { message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="overlay" onClick={props.onCancel}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-describedby="confirm-msg" onClick={(e) => e.stopPropagation()}>
        <p id="confirm-msg">{props.message}</p>
        <div class="dialog-actions">
          <button ref={cancelRef} onClick={props.onCancel}>
            {t('cancel')}
          </button>
          <button class="danger-solid" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 取り消せない操作の確認: 決められた言葉を入力しないと実行できない (一致するまで実行ボタンは無効)。
 * children に件数などの説明を入れる。Esc / 外側クリック / キャンセルで閉じる。
 */
export function TypeToConfirm(props: { title: string; word: string; confirmLabel: string; children: ComponentChildren; onConfirm: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  const ok = value.trim().toLowerCase() === props.word.trim().toLowerCase();
  return (
    <div class="overlay" onClick={props.onCancel}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="danger-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="danger-title" class="dialog-title">{props.title}</h2>
        {props.children}
        <label class="type-confirm">
          <span class="muted">{t('deleteAllInputLabel')}</span>
          <input ref={input} value={value} autocomplete="off" onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
        </label>
        <div class="dialog-actions">
          <button onClick={props.onCancel}>{t('cancel')}</button>
          <button class="danger-solid" disabled={!ok} onClick={() => ok && props.onConfirm()}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 閉じるだけの案内ダイアログ (本文は改行を保って表示) */
export function InfoDialog(props: { title: string; body: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="info-title" class="dialog-title">{props.title}</h2>
        <p class="pre">{props.body}</p>
        <div class="dialog-actions">
          <button ref={closeRef} onClick={props.onClose}>
            {t('dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 「元に戻す」付きトースト (表示時間は呼び出し側のタイマーで制御) */
export function Toast(props: { message: string; onUndo?: () => void }) {
  return (
    <div class="toast" role="status">
      <span>{props.message}</span>
      {props.onUndo && <button onClick={props.onUndo}>{t('undo')}</button>}
    </div>
  );
}

/**
 * 子を body 直下の入れ物に描く (preact/compat は、入力イベントの扱いを変えてしまうので使わない)。
 * 入れ物の中の描画は、この部品の描画のたびに、同じ入れ物へ描き直す。
 */
function Portal(props: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null);
  if (!host.current) host.current = document.createElement('div');
  useLayoutEffect(() => {
    document.body.append(host.current!);
    return () => {
      render(null, host.current!);
      host.current!.remove();
    };
  }, []);
  useLayoutEffect(() => {
    render(<>{props.children}</>, host.current!);
  });
  return null;
}

/**
 * 右端そろえ (right:0) のメニューが、左の画面の外へはみ出すか。ボタンの位置 (anchor) とメニューの幅から、はみ出さない側を選ぶ。
 * 右そろえで収まれば 'right' (従来どおり)。収まらず、左そろえで収まれば 'left'。どちらでも収まらないときは 'left' (CSS の max-width で画面の幅に合わせる)
 */
export function pickMenuSide(anchor: { left: number; right: number }, menuWidth: number, viewportWidth: number): 'left' | 'right' {
  if (anchor.right - menuWidth >= 8) return 'right';
  if (anchor.left + menuWidth <= viewportWidth - 8) return 'left';
  return 'left';
}

/**
 * 外側クリック / Esc で閉じるドロップダウンの枠。
 * fixed: カードや一覧の overflow に隠れないよう、body 直下 (portal) に出し、きっかけのボタンの近くを基準に、画面の端に収まる位置へ補正する
 * (右にはみ出すときは左へ、下にはみ出すときは上へ)。スクロールやウィンドウの大きさの変更でも閉じる (位置がずれるため)。
 */
export function Dropdown(props: { onClose: () => void; children: ComponentChildren; label?: string; class?: string; fixed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  /** きっかけのボタンを含む入れ物 (fixed のときは、目印の span の親。そうでなければ、このメニューの親) */
  const anchor = () => (props.fixed ? marker.current?.parentElement : ref.current?.parentElement) ?? ref.current;
  const place = () => {
    const el = ref.current;
    if (!el) return;
    if (!props.fixed) {
      // 右そろえのメニューが、狭い幅 (サイドパネルなど) で左へはみ出すときは、左そろえにする
      if (el.classList.contains('menu-left')) return;
      const a = ref.current?.parentElement?.getBoundingClientRect();
      if (!a) return;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      el.classList.toggle('menu-left', pickMenuSide(a, el.offsetWidth, vw) === 'left');
      return;
    }
    const r = (anchor() ?? el).getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    el.style.maxHeight = `${Math.max(120, vh - 16)}px`;
    el.style.overflowY = 'auto';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
    const below = r.bottom + 4;
    const above = r.top - 4 - h;
    el.style.top = `${below + h > vh - 8 && above >= 8 ? above : Math.max(8, Math.min(below, vh - h - 8))}px`;
  };
  useLayoutEffect(() => {
    place();
    // 中身があとから増える (フォルダの一覧など) ときも、画面の端に収まる位置に補正し直す
    const el = ref.current;
    if (!props.fixed || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      // 開くボタン (親の .menu-anchor 内) の mousedown では閉じない。ボタン側のトグルに任せる
      const t = e.target as Node;
      if (!anchor()?.contains(t) && !ref.current?.contains(t)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    const away = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Node && ref.current?.contains(t))) props.onClose(); // メニューの中のスクロールでは閉じない
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    if (props.fixed) {
      window.addEventListener('scroll', away, true);
      window.addEventListener('resize', away);
    }
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, []);
  const menu = (
    <div ref={ref} class={`menu${props.fixed ? ' fixed' : ''} ${props.class ?? ''}`} role="dialog" aria-label={props.label}>
      {props.children}
    </div>
  );
  if (!props.fixed) return menu;
  return (
    <>
      <span ref={marker} hidden />
      <Portal>{menu}</Portal>
    </>
  );
}

/** フォルダを 1 つ選ぶメニュー (一括「フォルダに追加」「フォルダから外す」用) */
export function FolderMenu(props: { folders: Folder[]; onPick: (id: string) => void; onClose: () => void; label: string }) {
  return (
    <Dropdown onClose={props.onClose} label={props.label}>
      {props.folders.length === 0 && <div class="menu-empty">{t('noFolders')}</div>}
      {props.folders.map((f) => (
        <button class="menu-item" onClick={() => props.onPick(f.id)}>
          <Icon name={f.icon} color={f.color} />
          <span class="fr-name">{displayName(f)}</span>
        </button>
      ))}
    </Dropdown>
  );
}

/**
 * x.com のポップオーバーと共通のチェックボックス式フォルダ選択 (src/shared/folderPicker.ts) を Preact に載せる。
 * 配色は manager の CSS 変数を渡す。
 */
export function FolderPickerHost(props: { folders: Folder[]; selected: string[]; onChange: (selected: Set<string>) => void | Promise<void> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const picker = createFolderPicker({
      folders: props.folders,
      selected: new Set(props.selected),
      theme: { fg: 'var(--text-primary)', border: 'var(--border-strong)', hover: 'var(--fill-ghost-hover)', accent: 'var(--fill-accent)' },
      onChange: props.onChange,
    });
    host.current?.replaceChildren(picker.el);
  }, []);
  return <div ref={host} class="picker-host" />;
}

/**
 * 並べ替え用のアプリ内 listbox。ネイティブ select のポップアップは OS 任せで配色が読めなくなることがあるため置き換えた。
 * キーボード: ボタンで Enter/Space/↓ で開く。開いている間は ↑↓/Home/End で移動、Enter/Space で決定、Esc で閉じる。
 */
export function SortMenu<T extends string>(props: { value: T; options: [T, string][]; label: string; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useRef(`sort-${Math.random().toString(36).slice(2, 7)}`).current;
  const cur = props.options.find(([v]) => v === props.value);

  const openMenu = () => {
    setActive(Math.max(0, props.options.findIndex(([v]) => v === props.value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (i: number) => {
    props.onChange(props.options[i][0]);
    close();
  };
  const [side, setSide] = useState<'left' | 'right'>('right');
  useLayoutEffect(() => {
    if (!open) return;
    const a = btn.current?.getBoundingClientRect();
    const w = list.current?.offsetWidth ?? 0;
    if (a) setSide(pickMenuSide(a, w, document.documentElement.clientWidth || window.innerWidth));
  }, [open]);
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!list.current?.contains(n) && !btn.current?.contains(n)) close(false);
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const n = props.options.length;
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % n);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div class="sortbox">
      <button
        ref={btn}
        type="button"
        class="sort-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={uid}
        aria-label={`${props.label}: ${cur?.[1] ?? ''}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onBtnKey}
      >
        <span>{cur?.[1]}</span>
        <Icon name="ti-chevron-down" />
      </button>
      {open && (
        <div ref={list} id={uid} class={`listbox${side === 'left' ? ' listbox-left' : ''}`} role="listbox" tabIndex={-1} aria-label={props.label} aria-activedescendant={`${uid}-${active}`} onKeyDown={onListKey}>
          {props.options.map(([v, l], i) => (
            <div
              id={`${uid}-${i}`}
              role="option"
              class={`option${i === active ? ' active' : ''}`}
              aria-selected={v === props.value}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{l}</span>
              {v === props.value && <Icon name="ti-check" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
