import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { readFileSync, readdirSync } from 'node:fs';
import { PAGE_SIZE, PAGE_SIZE_SIDEPANEL } from '../src/manager/App';

const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/shared/strings', async (orig) => {
  const m = await orig<typeof import('../src/shared/strings')>();
  return { ...m, formatDate: (iso: string) => (renders.n++, m.formatDate(iso)) }; // 「ポスト表示」のカードは、描画のたびに 1 回呼ぶ
});

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number) => ({ text: `post ${n}`, author: `A${n}`, handle: `@u${n}`, media: [], createdAt: '2026-01-01T00:00:00.000Z', url: `https://x.com/u${n}/status/${n}` });

async function seed(n: number) {
  const data: Record<string, any> = {};
  for (let i = 1; i <= n; i++) data[`me:${i}`] = { accountId: 'me', tweetId: String(i), folderIds: [], savedAt: i, snapshot: snap(i) };
  await chrome.storage.local.set({ bookmarks: data });
}
async function mountApp(surface: 'tab' | 'sidepanel' = 'tab') {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush(80);
}

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  renders.n = 0;
});

describe('v34-A: Card memo', () => {
  it('selecting a second post re-renders only that card, not all of them', async () => {
    await seed(25);
    await mountApp();
    const cards = $$('[data-row]');
    expect(cards.length).toBeGreaterThanOrEqual(25);
    await act(() => void cards[0].querySelector<HTMLInputElement>('input.sel')!.click());
    await flush(40); // 最初の選択: selectionActive が変わり、全カードが描き直される
    renders.n = 0;
    await act(() => void $$('[data-row]')[1].querySelector<HTMLInputElement>('input.sel')!.click());
    await flush(40);
    expect(renders.n).toBeGreaterThan(0);
    expect(renders.n).toBeLessThanOrEqual(3); // 全件 (25) ではなく、選択が変わった 1 件 (と、フォーカスで変わる分)
  });
});

/** IntersectionObserver の模擬: 監視中の末尾の要素に対して、コールバックを手で呼ぶ */
const ios: { cb: (e: any[]) => void; el: Element | null }[] = [];
class FakeIO {
  entry = { cb: (_e: any[]) => {}, el: null as Element | null };
  constructor(cb: (e: any[]) => void) {
    this.entry.cb = cb;
    ios.push(this.entry);
  }
  observe(el: Element) {
    this.entry.el = el;
  }
  disconnect() {
    this.entry.el = null;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const fire = async () => {
  const live = ios.filter((i) => i.el);
  await act(() => void live[live.length - 1].cb([{ isIntersecting: true, target: live[live.length - 1].el }]));
  await flush(40);
};
const cardCount = () => $$('[data-row]').length;

describe('v34-B: staged rendering', () => {
  beforeEach(() => {
    ios.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIO);
  });

  it('renders only PAGE_SIZE cards at first (5,000 posts); the counts still come from all of them', async () => {
    await seed(5000);
    await mountApp();
    expect(cardCount()).toBe(PAGE_SIZE.post);
    expect($('.bar-count, .muted.bar-count')?.textContent ?? document.body.textContent).toContain('5000');
    expect(document.body.textContent).toContain('あと 4970 件');
  });

  it('per view: post 30, list 60; the side panel is 30', async () => {
    expect(PAGE_SIZE).toEqual({ post: 30, list: 60, grid: 60 });
    expect(PAGE_SIZE_SIDEPANEL).toBe(30);
    await seed(200);
    await mountApp('sidepanel');
    expect(cardCount()).toBe(30);
  });

  it('the sentinel coming into view adds one page; never beyond the total; the footer goes away at the end', async () => {
    await seed(100);
    await mountApp();
    expect(cardCount()).toBe(30);
    await fire();
    expect(cardCount()).toBe(60);
    await fire();
    expect(cardCount()).toBe(90);
    await fire();
    expect(cardCount()).toBe(100);
    expect($$('.list-more').length).toBe(0); // 全件を描画済み: ボタンは出ない
    expect(ios.filter((i) => i.el).length).toBe(0);
  });

  it('"Show all" renders everything and shows the remaining count before', async () => {
    await seed(100);
    await mountApp();
    expect($('.list-more').textContent).toContain('あと 70 件');
    const btn = $$('.list-more button')[0];
    expect(btn.textContent).toBe('すべて表示');
    await act(() => void btn.click());
    await flush(40);
    expect(cardCount()).toBe(100);
    expect($$('.list-more').length).toBe(0);
  });

  it('changing the folder resets the count; a data reload alone does not', async () => {
    await seed(100);
    await mountApp();
    await fire();
    expect(cardCount()).toBe(60);
    await setBookmarkFolders('9999', [], snap(9999)); // 保存データだけが変わった (自動取り込み中など)
    await flush(120);
    expect(cardCount()).toBe(60);
    const row = (name: string) => $$('.side .fr').find((r) => r.textContent?.includes(name))!;
    await act(() => void row('未分類').click());
    await flush(60);
    expect(cardCount()).toBe(30);
  });

  it('search runs over all posts, including the ones not rendered ("N of M" comes from all)', async () => {
    await seed(100);
    location.hash = '#q=' + encodeURIComponent('post 99');
    await mountApp();
    const ids = $$('[data-row]').map((r) => r.dataset.row);
    expect(ids).toContain('99'); // 先頭 30 件の外にあるポストも、検索に一致する
    expect(document.body.textContent).toContain('100 件中 1 件');
  });

  it('Ctrl+A selects all posts, including the unrendered ones', async () => {
    await seed(100);
    await mountApp();
    const row = $$('[data-row]')[0];
    row.focus();
    await act(() => void row.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })));
    await flush(40);
    expect(document.body.textContent).toContain('100 件選択中');
    expect(cardCount()).toBe(30);
  });

  it('ArrowDown from the last rendered card renders more and moves the focus to the next one', async () => {
    await seed(100);
    await mountApp();
    const last = $$('[data-row]')[29];
    last.focus();
    await act(() => void last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    await flush(60);
    expect(cardCount()).toBeGreaterThan(30);
    const idsNow = $$('[data-row]').map((r) => r.dataset.row);
    expect((document.activeElement as HTMLElement).dataset.row).toBe(idsNow[30]);
  });

  it('shownIds.includes is not called per card (no O(n²) scan over the list)', async () => {
    await seed(100);
    const spy = vi.spyOn(Array.prototype, 'includes');
    await mountApp();
    const big = spy.mock.contexts.filter((c) => Array.isArray(c) && c.length === 100).length;
    spy.mockRestore();
    expect(big).toBeLessThan(5);
  });
});

describe('v34: strings', () => {
  it('listRemaining / listShowAll exist in all 8 locales; the button label stays short', () => {
    for (const l of readdirSync('static/_locales')) {
      const m = JSON.parse(readFileSync(`static/_locales/${l}/messages.json`, 'utf8'));
      expect(m.listRemaining?.message, l).toContain('$COUNT$');
      expect(m.listShowAll?.message.length, l).toBeLessThanOrEqual(12);
    }
  });

  it('content-visibility is on the post and list cards only (the grid checkbox sticks out of the card)', () => {
    const css = readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/\.post\{content-visibility:auto;contain-intrinsic-size:auto 320px\}/);
    expect(css).toMatch(/\.mini\{content-visibility:auto;contain-intrinsic-size:auto \d+px\}/);
    expect(css).not.toMatch(/\.gc\{content-visibility/);
  });
});
