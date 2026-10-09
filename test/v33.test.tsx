import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { applyButtonMode, injectButtons } from '../src/content/buttons';
import { openPopover } from '../src/content/popover';
import { App } from '../src/manager/App';
import { SortMenu, pickMenuSide } from '../src/manager/ui';
import { createFolder, setBookmarkFolders, setAccountScope } from '../src/shared/storage';
import { jaWrapRule, setDocumentLang } from '../src/shared/strings';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const read = (p: string) => readFileSync(p, 'utf8');
const snap = (n: number) => ({ text: `post ${n}`, author: `A${n}`, handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });

describe('v33-A: Japanese line breaking', () => {
  it(':lang(ja) rules are in the manager and popup CSS, and none for other languages', () => {
    for (const f of ['static/manager.css', 'static/popup.css']) {
      const css = read(f);
      expect(css).toMatch(/:lang\(ja\) body\{word-break:auto-phrase;line-break:strict\}/);
    }
    expect(read('static/manager.css')).toMatch(/text-wrap:pretty/);
    expect(read('static/manager.css')).toMatch(/text-wrap:balance/);
    expect(read('static/manager.css')).not.toMatch(/:lang\((?!ja)/);
    expect(jaWrapRule('.x')).toBe('.x:lang(ja){word-break:auto-phrase;line-break:strict}');
  });

  it('HTML has no fixed lang; setDocumentLang puts the UI language on <html>', () => {
    for (const f of ['static/manager.html', 'static/sidepanel.html', 'static/popup.html']) expect(read(f)).not.toMatch(/<html[^>]*lang=/);
    installChromeMock();
    document.documentElement.removeAttribute('lang');
    setDocumentLang();
    expect(document.documentElement.lang).toBe(chrome.i18n.getUILanguage());
    (chrome.i18n as any).getUILanguage = () => 'en-US';
    setDocumentLang();
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('the x.com popover root carries the UI language and the :lang(ja) rule is injected', async () => {
    installChromeMock();
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = read('test/fixtures/tweet.html');
    const pop = await openPopover(document.querySelector('article')!, document.body);
    expect(pop!.lang).toBe(chrome.i18n.getUILanguage());
    expect(document.getElementById('postshelf-popover-style')!.textContent).toContain(':lang(ja)');
  });
});

describe('v33-C: menus stay on screen', () => {
  it('pickMenuSide: right-aligned when it fits, left-aligned when the button is near the left edge', () => {
    expect(pickMenuSide({ left: 200, right: 300 }, 160, 400)).toBe('right');
    expect(pickMenuSide({ left: 8, right: 100 }, 160, 320)).toBe('left'); // サイドパネル: 左端のボタン
    expect(pickMenuSide({ left: 8, right: 60 }, 400, 320)).toBe('left'); // どちらも収まらない: 左 (CSS の max-width で幅に合わせる)
  });

  it('SortMenu opens left-aligned at 320px when the button is at the left edge (mocked geometry)', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 8, right: 100, top: 0, bottom: 30, width: 92, height: 30, x: 8, y: 0, toJSON() {} });
    const ow = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180);
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 320, configurable: true });
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<SortMenu label="sort" value="a" options={[['a', 'A'], ['b', 'B']]} onChange={() => {}} />, $('#app')));
    await act(() => void $('.sort-btn').click());
    expect($('.listbox').classList.contains('listbox-left')).toBe(true);
    // 右寄りのボタンなら、従来どおり右そろえ
    rect.mockReturnValue({ left: 220, right: 312, top: 0, bottom: 30, width: 92, height: 30, x: 220, y: 0, toJSON() {} });
    await act(() => void $('.sort-btn').click());
    await act(() => void $('.sort-btn').click());
    expect($('.listbox').classList.contains('listbox-left')).toBe(false);
    rect.mockRestore();
    ow.mockRestore();
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 0, configurable: true });
  });
});

describe('v33-B: scroll position', () => {
  let y = 0;
  const scrollTo = vi.fn((o: any) => {
    y = o.top;
  });
  beforeEach(async () => {
    installChromeMock();
    setAccountScope('me');
    y = 0;
    scrollTo.mockClear();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true });
    Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
    await createFolder({ name: 'Dev' });
    for (let i = 1; i <= 3; i++) await setBookmarkFolders(String(i), [], snap(i));
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush(80);
  });
  afterEach(() => vi.restoreAllMocks());
  const scrollNow = async (v: number) => {
    y = v;
    await act(() => void window.dispatchEvent(new Event('scroll')));
  };
  const folderRow = (name: string) => $$('.side .fr').find((r) => r.textContent?.includes(name))!;
  const settingsRow = () => $$('.side .fr').find((r) => r.classList.contains('add') && r.textContent?.includes('設定'))!;

  it('opening settings goes to the top; coming back to the same folder restores the list position; another folder goes to the top', async () => {
    await act(() => void folderRow('未分類').click());
    await flush(60);
    await scrollNow(700);
    scrollTo.mockClear();
    await act(() => void settingsRow().click());
    await flush(60);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    await act(() => void folderRow('未分類').click());
    await flush(60);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 700 }));
    // 設定を経由して、別のフォルダへ → 先頭
    await act(() => void settingsRow().click());
    await flush(60);
    await act(() => void folderRow('Dev').click());
    await flush(60);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
  });

  it('choosing another folder, searching: top. A data reload alone does not move the position', async () => {
    await act(() => void folderRow('未分類').click());
    await flush(60);
    await scrollNow(500);
    scrollTo.mockClear();
    await setBookmarkFolders('9', [], snap(9)); // 保存データが変わった (自動取り込み中など)
    await flush(120);
    expect(scrollTo).not.toHaveBeenCalled();
    await act(() => void folderRow('Dev').click());
    await flush(60);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });
});

describe('v33-D: folder button in the post-detail action row', () => {
  const detail = read('test/fixtures/tweet-detail-actions.html');
  beforeEach(() => {
    installChromeMock();
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    applyButtonMode('separate');
  });

  it('centres itself in the row and keeps a gap from the count that follows the bookmark button', () => {
    document.body.innerHTML = detail;
    injectButtons();
    const btn = $('[data-postshelf-btn]');
    expect(btn.style.alignSelf).toBe('center');
    expect(btn.style.marginRight).toBe('4px');
    expect(btn.style.marginLeft).toBe('4px');
    expect(btn.previousElementSibling).toBe($('[data-testid=bookmark]'));
  });

  it('timeline layout (nothing after the bookmark button): same rule, no extra right margin', () => {
    document.body.innerHTML = read('test/fixtures/tweet.html');
    injectButtons();
    const btn = $('[data-postshelf-btn]');
    expect(btn.style.alignSelf).toBe('center');
    expect(btn.style.marginLeft).toBe('4px');
  });

  it('does not shift the vertical position by itself: no top / transform / vertical-align (a non-flex parent is unaffected)', () => {
    document.body.innerHTML = detail.replace('display:flex;align-items:flex-start', 'display:block');
    injectButtons();
    const btn = $('[data-postshelf-btn]');
    expect(btn.style.top).toBe('');
    expect(btn.style.transform).toBe('');
    expect(btn.style.verticalAlign).toBe('');
  });
});
