import type { Bookmark } from '../src/shared/models';
import { queryBookmarks } from '../src/shared/query';
import { sizeSeparateButton } from '../src/content/buttons';
import { readFileSync } from 'node:fs';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { setAccountScope } from '../src/shared/storage';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number) => ({ text: `post ${n}`, author: `A${n}`, handle: `@u${n}`, media: [], createdAt: '2026-01-01T00:00:00.000Z', url: `https://x.com/u${n}/status/${n}` });
async function seed(n: number) {
  const data: Record<string, any> = {};
  const now = Date.now();
  for (let i = 1; i <= n; i++) data[`me:${i}`] = { accountId: 'me', tweetId: String(i), folderIds: [], savedAt: now - i, snapshot: snap(i) };
  await chrome.storage.local.set({ bookmarks: data });
}
async function mountApp() {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface="tab" />, $('#app')));
  await flush(80);
}
const cardCount = () => $$('[data-row]').length;
/** 増え続ける間は待つ (rAF で間引いているため) */
const settle = async () => {
  for (let i = 0, last = -1; i < 30 && cardCount() !== last; i++) {
    last = cardCount();
    await flush(100);
  }
};
const goto = async (name: string) => {
  const row = $$('.side .fr').find((r) => r.textContent?.includes(name))!;
  await act(() => void row.click());
  await flush(60);
};

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

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  ios.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeIO);
});

describe('v35-A: staged rendering grows in every view', () => {
  for (const name of ['すべて', '未分類', '最近の 7 日']) {
    it(`${name}: the sentinel intersecting adds a page`, async () => {
      await seed(200);
      await mountApp();
      if (name !== 'すべて') await goto(name);
      expect(cardCount()).toBe(30);
      await fire();
      expect(cardCount()).toBe(60);
    });
  }
});

describe('v35-A: scroll check without IntersectionObserver', () => {
  const rectOf = (top: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('list-sentinel') ? ({ top, bottom: top + 1, left: 0, right: 1, width: 1, height: 1, x: 0, y: top, toJSON() {} } as DOMRect) : ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
  });
  const scroll = async () => {
    await act(() => void window.dispatchEvent(new Event('scroll')));
    await flush(60);
  };
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    (window as any).scrollTo = () => {};
  });

  for (const name of ['すべて', '未分類', '最近の 7 日']) {
    it(`${name}: a near sentinel grows the list on scroll; a far one does not`, async () => {
      await seed(200);
      const spy = rectOf(100000);
      await mountApp();
      if (name !== 'すべて') await goto(name);
      expect(cardCount()).toBe(30);
      await scroll();
      expect(cardCount()).toBe(30); // 遠い: 増やさない
      spy.mockRestore();
      rectOf(window.innerHeight * 2 - 1);
      await scroll();
      expect(cardCount()).toBeGreaterThan(30);
      vi.restoreAllMocks();
    });
  }

  it('keeps growing while the sentinel stays near, and stops at the total', async () => {
    await seed(100);
    rectOf(10);
    await mountApp();
    await scroll();
    await settle();
    expect(cardCount()).toBe(100);
    expect($$('.list-more').length).toBe(0);
    vi.restoreAllMocks();
  });

  it('changing the folder resets; a data reload alone does not', async () => {
    await seed(200);
    rectOf(100000);
    await mountApp();
    vi.restoreAllMocks();
    rectOf(10);
    await scroll();
    await settle();
    expect(cardCount()).toBe(200);
    vi.restoreAllMocks();
    rectOf(100000);
    await goto('未分類');
    expect(cardCount()).toBe(30);
    vi.restoreAllMocks();
  });
});

describe('v35-B: settings description width and ja wording', () => {
  it('.setting-desc is 52em wide; the post body width is untouched', () => {
    const css = readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/\.setting-desc\{[^}]*max-width:52em/);
    expect(css).not.toMatch(/max-width:40em/);
  });
  it('the ja locale no longer uses "たたまれた" (it breaks mid-word)', () => {
    const ja = JSON.parse(readFileSync('static/_locales/ja/messages.json', 'utf8')) as Record<string, { message: string }>;
    for (const [k, v] of Object.entries(ja)) expect(v.message, k).not.toContain('たたまれ');
    expect(ja.fullTextSwitchDesc.message).toContain('省略されたポスト');
  });
});

describe('v35-C: the folder button follows the size of the bookmark button', () => {
  const rect = (w: number, h: number) => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const make = (bmRect: DOMRect | null, svgRect?: DOMRect) => {
    const bm = document.createElement('button');
    bm.innerHTML = '<svg></svg>';
    if (bmRect) bm.getBoundingClientRect = () => bmRect;
    if (svgRect) bm.querySelector('svg')!.getBoundingClientRect = () => svgRect;
    const btn = document.createElement('button');
    return { bm, btn };
  };
  it('uses the measured height (a circle) and the icon height', () => {
    const { bm, btn } = make(rect(58, 40), rect(22, 22));
    sizeSeparateButton(bm, btn);
    expect([btn.style.width, btn.style.height, btn.style.fontSize]).toEqual(['40px', '40px', '22px']);
  });
  it('falls back to 34px / 19px when it cannot measure (zero size)', () => {
    const { bm, btn } = make(rect(0, 0));
    sizeSeparateButton(bm, btn);
    expect([btn.style.width, btn.style.height, btn.style.fontSize]).toEqual(['34px', '34px', '19px']);
  });
  it('clamps to at least 34px and at most 64px; the icon is at least 19px', () => {
    const small = make(rect(20, 20), rect(10, 10));
    sizeSeparateButton(small.bm, small.btn);
    expect([small.btn.style.width, small.btn.style.fontSize]).toEqual(['34px', '19px']);
    const big = make(rect(200, 90));
    sizeSeparateButton(big.bm, big.btn);
    expect([big.btn.style.width, big.btn.style.height]).toEqual(['64px', '64px']);
  });
});

describe('v35-F: button nowrap is split', () => {
  it('buttons in dialogs, settings groups and menu items wrap; toolbar buttons keep nowrap', () => {
    const css = readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/button,\.chip,\.tab,\.badge\{white-space:nowrap\}/);
    expect(css).toMatch(/\.dialog button,\.setting-group button,\.menu-item\{white-space:normal;min-width:0;overflow-wrap:anywhere\}/);
  });
});

describe('v35-G: the search normalization cache survives a reload', () => {
  const bm = (id: string, text: string): Bookmark => ({ accountId: 'me', tweetId: id, folderIds: [], savedAt: 1, snapshot: { text, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${id}` } });
  const q = (all: Bookmark[]) => queryBookmarks(all, { folderId: 'all', search: 'キスト', sort: 'savedDesc' });
  it('a new snapshot object with the same content does not normalize again; a changed text does', () => {
    const norm = vi.spyOn(String.prototype, 'normalize');
    q([bm('g1', 'テキストです')]);
    const first = norm.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    q([bm('g1', 'テキストです')]); // 読み込み直しで作り直された、別のオブジェクト
    const second = norm.mock.calls.length - first;
    expect(second).toBeLessThanOrEqual(3); // 検索語の分だけ
    q([bm('g1', 'テキストが変わりました')]);
    expect(norm.mock.calls.length - first - second).toBeGreaterThan(second);
    norm.mockRestore();
  });
  it('the result is still right after a cache hit', () => {
    expect(q([bm('g2', 'テキストです'), bm('g3', 'ほか')]).map((b) => b.tweetId)).toEqual(['g2']);
    expect(q([bm('g2', 'テキストです'), bm('g3', 'ほか')]).map((b) => b.tweetId)).toEqual(['g2']);
  });
});
