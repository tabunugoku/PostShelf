import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { REPO_URL } from '../src/shared/links';
import { noteAccount, setAccountScope } from '../src/shared/storage';

const css = readFileSync('static/manager.css', 'utf8');
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element>(s: string) => [...document.querySelectorAll<T>(s)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};

async function mount(surface: 'tab' | 'sidepanel' = 'tab', width = 1200, hash = '#settings') {
  installChromeMock();
  installPanelMock();
  (globalThis as any).chrome.tabs = { query: async () => [], create: async () => ({}) };
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = width;
  history.replaceState(null, '', `/${hash}`);
  await noteAccount({ handle: 'me' }, 1);
  setAccountScope('me');
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush();
  await flush();
}
afterEach(() => render(null, $('#app')));
beforeEach(() => history.replaceState(null, '', '/'));

const group = (name: string) => $$('h3.set-h').find((h) => h.textContent === name)!;
/** 見出しの次の見出しまでに含まれる欄 (fieldset) の legend */
const legendsOf = (name: string) => {
  const out: string[] = [];
  for (let e = group(name).nextElementSibling; e && !e.matches('h3.set-h'); e = e.nextElementSibling) {
    const lg = e.matches('fieldset') ? e.querySelector(':scope > legend') : null;
    if (lg) out.push(lg.textContent!.trim());
  }
  return out;
};

describe('v25: 説明の短文化', () => {
  it('「連動する」: 3 items and a note; the subject 「PostShelf が」 stays; descriptions have a max line length', async () => {
    await mount();
    const items = $$('.desc-list .desc-item').map((e) => e.textContent);
    expect(items).toEqual([
      'フォルダに保存したとき、X 標準のブックマークも付けます。',
      'すべてのフォルダから外したとき、X 側のブックマークも外します。',
      'PostShelf が画面上のブックマークボタンを押すのは、操作したポスト 1 件につき 1 回だけです。',
    ]);
    expect($('.desc-note').textContent).toBe('初期値はオフです。');
    expect(css).toMatch(/\.setting-desc\{[^}]*max-width:none/);
    expect($('input[role=switch]').closest('label')!.getBoundingClientRect).toBeTruthy(); // スイッチは、いまのまま (本物の input)
  });
});

describe('v25: 欄の分割と順番', () => {
  it('six group headings, in order, each with its fields', async () => {
    await mount();
    expect($$('h3.set-h').map((h) => h.textContent)).toEqual(['保存', '取り込み', '表示と動作', 'データ', '情報', '初期化と削除']);
    expect(legendsOf('保存')).toEqual(['X のブックマークとの連動', '標準ブックマークボタンの動作', '長いポストの全文', '画像のキャッシュ']);
    expect(legendsOf('取り込み')).toEqual(['ブックマークの自動取り込み']);
    expect(legendsOf('表示と動作')).toEqual(['ツールバーアイコンのクリック時の動作']);
    expect(legendsOf('データ')).toEqual(['データの保存と移行']);
    expect(legendsOf('情報')).toEqual(['X の画面構造', 'PostShelf について']);
    expect(legendsOf('初期化と削除')).toEqual(['設定の初期化', '危険な操作']);
  });

  it('「標準ブックマークボタンの動作」 is its own field (not nested in the sync field)', async () => {
    await mount();
    const sync = [...$$('fieldset')].find((f) => f.querySelector(':scope > legend')?.textContent === 'X のブックマークとの連動')!;
    expect(sync.querySelector('input[name=buttonMode]')).toBeNull();
    expect($('input[name=buttonMode]').closest('fieldset')).not.toBe(sync);
  });

  it('「データ」 holds only export / import; auto-collect, version and GitHub are in their own fields', async () => {
    await mount();
    const data = [...$$('fieldset')].find((f) => f.querySelector(':scope > legend')?.textContent === 'データの保存と移行')!;
    expect([...data.querySelectorAll('button, .file-btn')].map((b) => b.textContent?.trim())).toEqual(['エクスポート', 'インポート']);
    expect(data.textContent).toContain('ファイルに書き出したり、読み込んだりします。');
    expect(data.textContent).not.toContain('自動取り込みを使う');
    expect(data.textContent).not.toContain('バージョン');
    expect(data.querySelector('a')).toBeNull();
    const ac = [...$$('fieldset')].find((f) => f.querySelector(':scope > legend')?.textContent === 'ブックマークの自動取り込み')!;
    expect(ac.querySelector('input[role=switch]')).toBeTruthy();
    expect(ac.textContent).toContain('ブックマークを自動で取り込む');
    const about = [...$$('fieldset')].find((f) => f.querySelector(':scope > legend')?.textContent === 'PostShelf について')!;
    expect(about.textContent).toContain('バージョン');
    expect(about.querySelector('a')!.textContent).toBe('更新と手動インストールの手順');
    expect(about.querySelector('a.gh-link, a[href*="github.com/tabunugoku/PostShelf"]:not([href*="blob"])')).toBeNull();
  });

  it('danger zone stays last, in a red frame', async () => {
    await mount();
    expect($('section > fieldset:last-of-type').classList.contains('danger-zone')).toBe(true);
  });
});

describe('v25: 目次', () => {
  it('is a <nav aria-label> of six <button>s placed before the first heading (Tab order: nav → groups)', async () => {
    await mount();
    const nav = $('nav.settings-nav');
    expect(nav.getAttribute('aria-label')).toBe('設定のグループへ移動');
    expect([...nav.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['保存', '取り込み', '表示と動作', 'データ', '情報', '初期化と削除']);
    expect(nav.querySelectorAll('a')).toHaveLength(0);
    expect(nav.compareDocumentPosition(group('保存')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group('保存').getAttribute('tabindex')).toBe('-1');
  });

  it('pressing a button scrolls to that heading and moves focus there; the URL hash does not change', async () => {
    await mount();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const before = location.href;
    await click($$('nav.settings-nav button').find((b) => b.textContent === '情報')!);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(group('情報'));
    expect(document.activeElement).toBe(group('情報'));
    expect(location.href).toBe(before);
    expect(location.hash).toBe('#settings');
  });

  it('respects prefers-reduced-motion (no smooth scrolling)', async () => {
    await mount();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    (window as any).matchMedia = (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} });
    await click($$('nav.settings-nav button')[1]);
    expect((scroll.mock.calls[0] as any)[0].behavior).toBe('auto');
    delete (window as any).matchMedia;
  });

  it('wraps on narrow screens and is sticky only in the tab layout', () => {
    expect(css).toMatch(/\.settings-nav\{[^}]*flex-wrap:wrap/);
    expect(css).toMatch(/\.layout-wide \.settings-nav\{position:sticky/);
  });
});

describe('v25: 設定を開く入口は、いまのまま', () => {
  it('#diagnostics opens the settings with the 「X の画面構造」 field and the diagnostics dialog', async () => {
    await mount('tab', 1200, '#diagnostics');
    expect(legendsOf('情報')).toContain('X の画面構造');
    expect($('[role=dialog]')).toBeTruthy();
  });
  it('#autocollect still opens the auto-collect confirmation', async () => {
    await mount('tab', 1200, '#autocollect');
    expect($('[role=dialog].ac-dialog')).toBeTruthy();
  });
});

describe('v25: GitHub のボタン', () => {
  it('exactly one link in the left menu (constant URL, new tab, noopener); none inside the settings; none in the side panel', async () => {
    await mount('tab', 1200);
    const links = $$<HTMLAnchorElement>('a[href="' + REPO_URL + '"]');
    expect(links).toHaveLength(1);
    expect(links[0].closest('.side')).toBeTruthy();
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toContain('noopener');
    expect($('section').querySelector('a[href="' + REPO_URL + '"]')).toBeNull();
    await mount('sidepanel', 400);
    expect($$('a[href="' + REPO_URL + '"]')).toHaveLength(0);
  });
  it('when the menu is narrow, the text is hidden and the aria-label stays', async () => {
    await mount('tab', 1200);
    const a = $('a.gh-link');
    expect(a.querySelector('.gh-text')!.textContent).toBe('GitHub');
    expect(a.getAttribute('aria-label')).toBe('GitHub で見る（新しいタブで開きます）');
    expect(css).toMatch(/@media \(max-width:760px\)\{\.gh-text,\.gh-link i:last-child\{display:none\}\}/);
  });
});
