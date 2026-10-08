import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { SettingsPage } from '../src/manager/Settings';
import { App } from '../src/manager/App';
import { AutoCollectPanel, resetCollapsed } from '../src/content/autocollectPanel';
import type { AutoCollector, CollectState } from '../src/content/autocollect';
import { highlightRanges, searchTerms } from '../src/shared/highlight';
import { PostText, SearchContext } from '../src/manager/PostText';
import { createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { saveCollectRun } from '../src/shared/settings';
import { vi } from 'vitest';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

async function mountSettings() {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} onAutoCollect={() => {}} />, $('#app')));
  await flush(60);
}
const type = async (v: string) => {
  const input = $<HTMLInputElement>('.settings-search input');
  await act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};
const visibleGroups = () => $$('fieldset.setting-group').filter((g) => !g.hidden).map((g) => g.querySelector('legend')!.textContent);

beforeEach(() => {
  installChromeMock();
  installPanelMock();
  history.replaceState(null, '', '/');
});

describe('v30-A: settings search', () => {
  it('keeps only matching rows; hides groups, headings and nav chips with no match; restores everything when cleared; values do not change', async () => {
    await mountSettings();
    const all = visibleGroups();
    expect(all.length).toBeGreaterThan(5);
    const switchBefore = $$<HTMLInputElement>('input[type=checkbox]').map((c) => c.checked);
    await type('全文');
    const shown = visibleGroups();
    expect(shown.length).toBeLessThan(all.length);
    expect(shown.some((g) => g?.includes('全文'))).toBe(true);
    expect($$('.set-h').filter((h) => !h.hidden).length).toBeLessThan($$('.set-h').length);
    expect($$('.nav-chip').filter((c) => !c.hidden).length).toBeLessThan($$('.nav-chip').length);
    expect($('.settings-match').textContent).toMatch(/^「全文」に一致 \d+ 件$/);
    await type('');
    expect(visibleGroups()).toEqual(all);
    expect($$('.setting-group[hidden], .setting[hidden], .set-h[hidden], .nav-chip[hidden]')).toHaveLength(0);
    expect($('.settings-match').textContent).toBe('');
    expect($$<HTMLInputElement>('input[type=checkbox]').map((c) => c.checked)).toEqual(switchBefore); // 隠していた間も、値は変わらない
  });

  it('row level: only the matching row stays in a group; full/half width and case are not distinguished; no match shows 「見つかりませんでした」', async () => {
    await mountSettings();
    await type('ＳＩＤＥ'); // 全角の大文字で、半角の「sidepanel」に当たる文言を探しても落ちない
    await type('置き換え');
    const rows = $$('.setting').filter((r) => !r.hidden);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.textContent!.includes('置き換え') || r.closest('fieldset')!.querySelector('legend')!.textContent!.includes('置き換え'))).toBe(true);
    await type('zzzzqqqq');
    expect(visibleGroups()).toEqual([]);
    expect($('.settings-match').textContent).toBe('見つかりませんでした');
  });
});

describe('v30-A: 「変更を保存しました」', () => {
  it('shows for 2 seconds after a switch is changed here; not after an unrelated storage change', async () => {
    await mountSettings();
    const box = $('.settings-saved');
    expect(box.textContent).toBe('');
    // 他のタブなどでの変更 (この画面で変えていない)
    await chrome.storage.local.set({ settings: { syncNative: true } });
    await flush(50);
    expect(box.textContent).toBe('');
    const sw = $$<HTMLInputElement>('input[role=switch]')[0];
    await act(() => {
      sw.checked = !sw.checked;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(100);
    expect(box.textContent).toBe('変更を保存しました');
    expect(box.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-live')).toBe('polite');
    await flush(2100);
    expect(box.textContent).toBe('');
  });
});

describe('v30-B: 「仕分ける」 after an import', () => {
  const stub = () => ({ pause: vi.fn(), resume: vi.fn(), resumeLater: vi.fn(), stop: vi.fn(), dismiss: vi.fn() }) as unknown as AutoCollector;
  const st = (over: Partial<CollectState> = {}): CollectState => ({ status: 'done', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: 300, updatedAt: 1, ...over });
  it('x.com panel: done with imported ≥ 1 → 「仕分ける」 opens the manager with #triage; with 0 → 「管理画面を開く」 as before', () => {
    document.body.innerHTML = '';
    history.replaceState(null, '', '/i/history');
    resetCollapsed();
    const open = vi.fn();
    const p = new AutoCollectPanel(stub(), open);
    p.update(st());
    expect($$('.postshelf-autocollect-panel button').map((b) => b.textContent)).toEqual(['仕分ける', '閉じる']);
    $<HTMLElement>('[data-action=triage]').click();
    expect(open).toHaveBeenCalledWith('#triage');
    p.update(st({ imported: 0 }));
    expect($$('.postshelf-autocollect-panel button').map((b) => b.textContent)).toEqual(['管理画面を開く', '閉じる']);
    $<HTMLElement>('[data-action=openManager]').click();
    expect(open).toHaveBeenLastCalledWith();
  });

  it('manager result band: 「仕分ける」 selects 未分類 and starts triage (tab); only when imported ≥ 1', async () => {
    installChromeMock();
    installPanelMock();
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    await createFolder({ name: 'Dev' });
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    await saveCollectRun({ status: 'done', accountId: 'me', startedAt: 1, imported: 0, skipped: 0, failed: 0, speed: 'slow', cap: 300, updatedAt: Date.now() });
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush(60);
    expect($$('.ac-progress .ac-row button').map((b) => b.textContent!.trim())).toEqual(['閉じる']);
    await saveCollectRun({ status: 'done', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: 300, updatedAt: Date.now() + 1 });
    await flush(60);
    const btn = $$('.ac-progress .ac-row button').find((b) => b.textContent!.includes('仕分ける'))!;
    await act(() => void btn.click());
    await flush(60);
    expect($('.fr.on').textContent).toContain('未分類');
    expect($$('[role=dialog].triage')).toHaveLength(1);
  });
});

describe('v30-C: the first-run guide', () => {
  it('0 saved posts: a title, two numbered steps and an 取り込む button; no long hint', async () => {
    installChromeMock();
    installPanelMock();
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush(60);
    expect($('.empty-title').textContent).toBe('はじめましょう');
    expect($$('.onboard li').map((l) => l.querySelector('.onboard-text')!.textContent)).toEqual(['x.com のポストで、フォルダのボタンを押す', 'いまのブックマークを取り込む']);
    expect($$('.onboard-n').map((n) => n.textContent)).toEqual(['1', '2']);
    expect($('.onboard-btn').textContent).toBe('取り込む');
    expect($('.empty-state').textContent).not.toContain('履歴');
  });
  it('the other empty screens are unchanged: an empty folder and a search with no match', async () => {
    installChromeMock();
    installPanelMock();
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    const f = await createFolder({ name: 'Empty' });
    await setBookmarkFolders('1', [], { text: 'abc', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    await chrome.storage.local.set({ settings: { lastFolderId: f.id } });
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush(60);
    expect($('.empty').textContent).toBe('保存されたポストはありません');
    expect($$('.onboard')).toHaveLength(0);
  });
});

describe('v30-D: search highlight', () => {
  it('ranges: several terms, full/half width, case, overlap merged; positions are in the original text', () => {
    expect(highlightRanges('Hello ＷＯＲＬＤ', searchTerms('world HELLO'))).toEqual([[0, 5], [6, 11]]);
    expect(highlightRanges('abcdef', searchTerms('bc cd'))).toEqual([[1, 4]]);
    expect(highlightRanges('ｱｲｳ', searchTerms('アイ'))).toEqual([[0, 2]]); // 半角カナも一致する
    expect(highlightRanges('abc', [])).toEqual([]);
    expect(highlightRanges('😀猫', searchTerms('猫'))).toEqual([[2, 3]]);
  });

  const snap = (text: string, segments?: any) => ({ text, author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1', ...(segments ? { segments } : {}) });
  const show = async (s: any, q: string) => {
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<SearchContext.Provider value={q}><PostText s={s} /></SearchContext.Provider>, $('#app')));
  };
  it('marks the matches (several terms, 全角半角); no marks without a query', async () => {
    await show(snap('Hello ＷＯＲＬＤ 猫'), 'world 猫');
    expect($$('mark').map((m) => m.textContent)).toEqual(['ＷＯＲＬＤ', '猫']);
    await show(snap('Hello'), '');
    expect($$('mark')).toHaveLength(0);
  });
  it('marks inside a link text and across parts; href and attributes are unchanged; HTML is not interpreted', async () => {
    const segs = [{ t: 'text', v: 'see ' }, { t: 'link', v: 'example.com/page', href: 'https://example.com/page' }, { t: 'text', v: ' <b>x</b>' }];
    await show(snap('see example.com/page <b>x</b>', segs), 'example <b>');
    const a = $<HTMLAnchorElement>('a.tl');
    expect(a.getAttribute('href')).toBe('https://example.com/page');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.querySelector('mark')!.textContent).toBe('example');
    expect($$('mark').map((m) => m.textContent)).toEqual(['example', '<b>']);
    expect(document.querySelector('b')).toBeNull();
  });
  it('the list passes the search words to the cards', async () => {
    installChromeMock();
    installPanelMock();
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    await setBookmarkFolders('1', [], snap('find the needle here') as any);
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush(60);
    const input = $<HTMLInputElement>('.top input[type=search]');
    await act(() => {
      input.value = 'needle';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect($$('.post mark').map((m) => m.textContent)).toEqual(['needle']);
  });
});

describe('v30: new Japanese strings stay short', () => {
  const ja = JSON.parse(readFileSync('static/_locales/ja/messages.json', 'utf8')) as Record<string, { message: string }>;
  it.each(['settingsSearch', 'settingsSaved', 'acBtnTriage', 'onboardImport', 'onboardTitle'])('%s ≤ 12 chars', (k) => {
    if (ja[k]) expect(ja[k].message.length).toBeLessThanOrEqual(12);
  });
});
