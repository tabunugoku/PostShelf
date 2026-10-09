/**
 * 自動取り込みの進捗パネル (x.com の /i/history 右下)。docs/mockups/auto-collect.html の見た目が基準。
 * 配色は X のテーマ (xTheme: ライト / ダーク / ダーク青) から決める。role="status" aria-live="polite"。キーボードで操作できる。
 */
import { isBookmarksPath } from '../shared/selectors';
import { formatDate, jaWrapRule, t, uiLang } from '../shared/strings';
import { ACCENT, ACCENT_FILL } from '../shared/tokens';
import { xTheme } from './theme';
import type { AutoCollector, CollectState } from './autocollect';

const PANEL_CLASS = 'postshelf-autocollect-panel';
const STYLE_ID = 'postshelf-autocollect-style';

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  surface: string;
  hover: string;
  warnBg: string;
  warnFg: string;
  ok: string;
  ng: string;
  scheme: 'light' | 'dark';
}

function palette(): Palette {
  const th = xTheme();
  const dark = th.scheme === 'dark';
  return {
    bg: th.bg,
    fg: th.fg,
    muted: dark ? '#8b98a5' : '#536471',
    border: th.border,
    surface: dark ? 'rgba(231,233,234,.06)' : '#f7f9f9',
    hover: th.hover,
    warnBg: dark ? '#3a2d0a' : '#fff4d6',
    warnFg: dark ? '#ffd277' : '#8a5a00',
    ok: dark ? '#4cd8a6' : '#00805a',
    ng: dark ? '#ff7b80' : '#c4161c',
    scheme: th.scheme,
  };
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
${jaWrapRule(`.${PANEL_CLASS}`)}
@keyframes postshelf-pulse{50%{opacity:.35}}
@keyframes postshelf-slide{0%{margin-left:-35%}100%{margin-left:100%}}
.${PANEL_CLASS} button:focus-visible{outline:2px solid ${ACCENT};outline-offset:1px}
html[data-postshelf-panel] .postshelf-collect,html[data-postshelf-panel] .postshelf-autocollect{display:none!important}
@media (prefers-reduced-motion:reduce){.${PANEL_CLASS} *{animation:none!important}}`;
  document.head.append(s);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
};

const speedName = (s: CollectState) => t(s.speed === 'normal' ? 'acSpeedNormal' : 'acSpeedSlow');
const dateOf = (iso?: string) => (iso ? formatDate(iso) : '');
const timeOf = (ms: number) => new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

export interface PanelView {
  title: string;
  sub: string;
  dot: 'run' | 'pause' | 'done' | 'ng';
  bar: 'ind' | 'fix' | 'full' | 'none';
  note: string;
  alert: string;
  buttons: { label: string; action: string; primary?: boolean; danger?: boolean }[];
}

/** 状態 → 表示内容 (文言と、出すボタン)。画面とテストで共有する */
export function viewOf(s: CollectState): PanelView {
  const cap = s.cap;
  switch (s.status) {
    case 'countdown':
      return { title: t('acPanelCountdown', s.countdown ?? 0), sub: t('acSubRunning', speedName(s)), dot: 'run', bar: 'none', note: '', alert: '', buttons: [{ label: t('cancel'), action: 'stop' }] };
    case 'running':
      return {
        title: t('acPanelRunning'),
        sub: s.recentPostDate ? t('acSubRunningDate', speedName(s), dateOf(s.recentPostDate)) : t('acSubRunning', speedName(s)),
        dot: 'run', bar: 'ind', note: t('acNoteRunning'), alert: '',
        buttons: [{ label: t('acBtnPause'), action: 'pause' }, { label: t('acBtnStop'), action: 'stop' }], // 停止しても、そこまでの分は保存される。赤は、データが消える操作だけに使う
      };
    case 'paused': {
      const why = { user: 'acReasonUser', hidden: 'acReasonHidden', account: 'acReasonAccount', reload: 'acReasonReload', page: 'acReasonPage', time: 'acReasonTime' }[s.reason as string];
      const sub = s.reason === 'cap' ? t('acReasonCap', cap) : why ? t(why) : t('acReasonUser');
      return {
        title: t('acPanelPaused'), sub, dot: 'pause', bar: 'fix', note: s.reason === 'reload' ? t('acNoteReload') : t('acNotePaused'), alert: '',
        buttons: [{ label: t('acBtnResume'), action: 'resume', primary: true }, { label: t('acBtnEnd'), action: 'stop' }],
      };
    }
    case 'limit':
      return {
        title: t('acPanelLimit'), sub: t('acReasonLimit'), dot: 'ng', bar: 'fix', note: s.resumeAt ? t('acResumeAt', timeOf(s.resumeAt)) : '', alert: t('acLimitAlert'),
        buttons: s.resumeAt
          ? [{ label: t('acBtnEnd'), action: 'stop' }]
          : [{ label: t('acBtnResumeLater'), action: 'resumeLater' }, { label: t('acBtnEnd'), action: 'stop' }],
      };
    case 'done':
      return { title: t('acPanelDone'), sub: t('acSubDone'), dot: 'done', bar: 'full', note: t('acNoteDone'), alert: '', buttons: [s.imported >= 1 ? { label: t('acBtnTriage'), action: 'triage', primary: true } : { label: t('acBtnOpenManager'), action: 'openManager', primary: true }, { label: t('acBtnClose'), action: 'close' }] }; // 取り込めた分があれば、仕分けへつなぐ (管理画面を #triage で開く)
    case 'stopped': {
      const refused = s.reason === 'refused-account' ? t('acReasonRefusedAccount') : s.reason === 'refused-unknown' ? t('acReasonRefusedUnknown') : '';
      return { title: t('acPanelStopped'), sub: refused || t('acSubStopped'), dot: refused ? 'ng' : 'pause', bar: 'none', note: '', alert: '', buttons: [{ label: t('acBtnClose'), action: 'close' }] };
    }
  }
}

/** 畳んだ状態。そのページを開いているあいだだけ覚える (保存しない)。running / paused 以外になったら自動で開く */
let collapsed = false;
/** テスト用: 畳んだ状態を戻す */
export const resetCollapsed = (): void => {
  collapsed = false;
};

export class AutoCollectPanel {
  private root: HTMLElement | null = null;
  private last: CollectState | null = null;

  constructor(private c: AutoCollector, private openManager: (hash?: string) => void) {}

  update(s: CollectState | null): void {
    this.last = s;
    // ブックマークのタブ以外では出さない (取り込みの状態は保存してあるので、戻ってくれば出る)
    if (!s || !isBookmarksPath(location.pathname)) return void this.hide();
    ensureStyle();
    const p = palette();
    const v = viewOf(s);
    if (!this.root) {
      this.root = el('div');
      this.root.className = PANEL_CLASS;
      this.root.lang = uiLang();
      this.root.setAttribute('role', 'status');
      this.root.setAttribute('aria-live', 'polite');
      this.root.setAttribute('aria-label', t('acPanelLabel'));
      document.body.append(this.root);
      document.documentElement.setAttribute('data-postshelf-panel', ''); // 右下の取り込みボタンは、パネルの間は隠す
    }
    const r = this.root;
    if (s.status !== 'running' && s.status !== 'paused') collapsed = false; // 見落としたくない状態 (制限・終了・停止・カウントダウン) は、自動で開く
    if (collapsed) {
      this.renderBar(r, s, p, v);
      return;
    }
    r.style.cssText = `position:fixed;right:14px;bottom:14px;z-index:2147483646;width:340px;max-width:calc(100vw - 28px);box-sizing:border-box;background:${p.bg};color:${p.fg};color-scheme:${p.scheme};border:1px solid ${p.border};border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.45);padding:14px;font:14px/1.5 system-ui,sans-serif`;
    r.replaceChildren();

    const dotColor = { run: ACCENT, pause: p.warnFg, done: p.ok, ng: p.ng }[v.dot];
    const h = el('div', 'display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700');
    h.append(el('span', `width:10px;height:10px;border-radius:50%;flex:none;background:${dotColor};${v.dot === 'run' ? 'animation:postshelf-pulse 1.2s infinite;' : ''}`), el('span', '', v.title));
    r.append(h, el('div', `color:${p.muted};font-size:13px`, v.sub));

    if (v.bar !== 'none') {
      const bar = el('div', `height:8px;border-radius:999px;background:${p.border};overflow:hidden;margin:10px 0 6px;border:1px solid ${p.border}`);
      // 全体の件数は X が教えないので、割合は出さず「進行中」の動くバーにする
      const fill = el('i', `display:block;height:100%;background:${ACCENT_FILL};width:${v.bar === 'full' ? '100%' : v.bar === 'ind' ? '35%' : '40%'};${v.bar === 'fix' ? 'opacity:.5;' : ''}${v.bar === 'ind' ? 'animation:postshelf-slide 1.6s infinite linear;' : ''}`);
      bar.append(fill);
      r.append(bar);
    }

    if (s.status !== 'countdown' && !(s.status === 'stopped' && s.reason?.startsWith('refused'))) {
      const stats = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0');
      for (const [n, label] of [[s.imported, t('acStatImported')], [s.skipped, t('acStatSkipped')], [s.failed, t('acStatFailed')]] as const) {
        const cell = el('div', `background:${p.surface};border:1px solid ${p.border};border-radius:10px;padding:6px 8px;text-align:center`);
        cell.append(el('b', 'display:block;font-size:18px;line-height:1.2', String(n)), el('span', `font-size:12px;color:${p.muted}`, label));
        stats.append(cell);
      }
      r.append(stats);
      if (s.oldestSeenPostDate && s.status !== 'running') r.append(el('div', `color:${p.muted};font-size:12px`, t('acOldest', dateOf(s.oldestSeenPostDate))));
    }
    if (v.alert) r.append(el('div', `background:${p.warnBg};color:${p.warnFg};border-radius:10px;padding:8px 10px;font-size:13px;margin-top:8px`, v.alert));
    if (v.note) r.append(el('div', `color:${p.muted};font-size:13px;margin-top:6px`, v.note));

    const row = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px');
    const buttons = s.status === 'running' || s.status === 'paused' ? [...v.buttons, { label: t('acBtnCollapse'), action: 'collapse' }] : v.buttons;
    for (const b of buttons) {
      const btn = el('button', `font:inherit;min-height:32px;padding:4px 12px;border-radius:8px;cursor:pointer;border:1px solid ${b.primary ? ACCENT_FILL : b.danger ? p.ng : p.border};background:${b.primary ? ACCENT_FILL : 'transparent'};color:${b.primary ? '#fff' : b.danger ? p.ng : p.fg}`, b.label);
      btn.type = 'button';
      btn.dataset.action = b.action;
      btn.addEventListener('click', () => this.act(b.action));
      row.append(btn);
    }
    r.append(row);
  }

  /** 畳んだ 1 行のバー (右下。幅は内容なり)。畳んでも取り込みは止まらない */
  private renderBar(r: HTMLElement, s: CollectState, p: Palette, v: PanelView): void {
    r.style.cssText = `position:fixed;right:14px;bottom:14px;z-index:2147483646;max-width:calc(100vw - 28px);box-sizing:border-box;display:flex;align-items:center;gap:8px;background:${p.bg};color:${p.fg};color-scheme:${p.scheme};border:1px solid ${p.border};border-radius:999px;box-shadow:0 8px 28px rgba(0,0,0,.45);padding:0 6px 0 14px;min-height:44px;font:13px/1.4 system-ui,sans-serif;white-space:nowrap`;
    const dotColor = { run: ACCENT, pause: p.warnFg, done: p.ok, ng: p.ng }[v.dot];
    const dot = el('span', `width:10px;height:10px;border-radius:50%;flex:none;background:${dotColor};${v.dot === 'run' ? 'animation:postshelf-pulse 1.2s infinite;' : ''}`);
    const btn = el('button', `font:inherit;min-height:44px;padding:0 12px;border:0;border-radius:999px;cursor:pointer;background:transparent;color:${p.fg};white-space:nowrap;font-weight:700`, t('acBtnExpand'));
    btn.type = 'button';
    btn.dataset.action = 'expand';
    btn.addEventListener('click', () => this.act('expand'));
    r.replaceChildren(dot, el('span', 'overflow:hidden;text-overflow:ellipsis', t('acCollapsedLine', s.imported, s.failed)), btn);
  }

  private act(action: string): void {
    if (action === 'collapse' || action === 'expand') {
      collapsed = action === 'collapse';
      this.update(this.last);
      return;
    }
    if (action === 'pause') void this.c.pause('user');
    else if (action === 'resume') void this.c.resume();
    else if (action === 'resumeLater') void this.c.resumeLater();
    else if (action === 'stop') void this.c.stop();
    else if (action === 'close') this.c.dismiss();
    else if (action === 'openManager') this.openManager();
    else if (action === 'triage') this.openManager('#triage');
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
    document.documentElement.removeAttribute('data-postshelf-panel');
  }
}
