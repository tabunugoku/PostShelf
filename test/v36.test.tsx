import { readFileSync } from 'node:fs';
import { sizeSeparateButton } from '../src/content/buttons';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { setAccountScope } from '../src/shared/storage';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/** act の外で待つ。act の中だと描画がまとめて行われ、実機のように「データを読んだ描画」と「一覧が現れる描画」が分かれない */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 条件が満たされるまで待つ (useEffect は描画のあと rAF か 100ms の保険で走るので、負荷が高いと遅れる) */
const until = async (cond: () => boolean, ms = 5000) => {
  for (let t = 0; t < ms && !cond(); t += 20) await wait(20);
};
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number) => ({ text: `post ${n}`, author: `A${n}`, handle: `@u${n}`, media: [], createdAt: '2026-01-01T00:00:00.000Z', url: `https://x.com/u${n}/status/${n}` });
async function seed(n: number) {
  const data: Record<string, any> = {};
  const now = Date.now();
  for (let i = 1; i <= n; i++) data[`me:${i}`] = { accountId: 'me', tweetId: String(i), folderIds: [], savedAt: now - i, snapshot: snap(i) };
  await chrome.storage.local.set({ bookmarks: data });
}
const cardCount = () => $$('[data-row]').length;

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

beforeEach(() => {
  // 前のテストの App を外す (外さないと、画面から切り離された App の効果が、あとのテストの window に監視を付け続ける)
  const old = document.getElementById('app');
  if (old) render(null, old);
  installChromeMock();
  setAccountScope('me');
  ios.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeIO);
});

describe('v36-A: the staged-rendering effect re-runs when the sentinel appears late', () => {
  it('data loaded first, the list (and its sentinel) mounted later: the sentinel still grows the list', async () => {
    await seed(200);
    // 実機の順序の再現: データを読んだ描画 (まだ ready でない = センチネルが無い) のあとで、一覧が描かれる。
    // バージョンの記録 (storage の書き込み) を遅らせて、setBookmarks と setReady を別の描画にする
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(((items: any) => new Promise((r) => setTimeout(() => r(set(items)), 60))) as any);
    document.body.innerHTML = '<div id="app"></div>';
    render(<App surface="tab" />, $('#app'));
    await until(() => cardCount() === 30 && ios.some((i) => i.el));
    await wait(100);
    expect(cardCount()).toBe(30);
    const live = ios.filter((i) => i.el);
    expect(live.length).toBeGreaterThan(0); // 修正前: 監視が付かない
    await act(() => void live[live.length - 1].cb([{ isIntersecting: true, target: live[live.length - 1].el }]));
    await flush(40);
    expect(cardCount()).toBe(60);
  });

  it('a scroll near the end grows the list even when the effect deps did not change', async () => {
    await seed(200);
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(((items: any) => new Promise((r) => setTimeout(() => r(set(items)), 60))) as any);
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('list-sentinel') ? ({ top: 10, bottom: 11, left: 0, right: 1, width: 1, height: 1, x: 0, y: 10, toJSON() {} } as DOMRect) : ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
    });
    document.body.innerHTML = '<div id="app"></div>';
    render(<App surface="tab" />, $('#app'));
    await until(() => cardCount() === 30 && !!document.querySelector('.list-sentinel'));
    await wait(150); // 効果 (rAF か 100ms の保険) が走って、scroll の監視が付くのを待つ
    for (let i = 0; i < 20 && cardCount() <= 30; i++) {
      await act(() => void window.dispatchEvent(new Event('scroll')));
      await wait(50);
    }
    expect(cardCount()).toBeGreaterThan(30);
    vi.restoreAllMocks();
  });
});

describe('v36-A: listeners do not leak when the effect re-runs', () => {
  it('scroll / resize listeners added by the staged-rendering effect are all removed on unmount', async () => {
    await seed(200);
    vi.stubGlobal('IntersectionObserver', undefined);
    // 本物の add / remove を呼んだうえで、scroll / resize の登録を記録する (付けた関数と外した関数の対応で数える)
    const added: [string, unknown][] = [];
    const removed: [string, unknown][] = [];
    const add = vi.spyOn(window, 'addEventListener');
    const rem = vi.spyOn(window, 'removeEventListener');
    document.body.innerHTML = '<div id="app"></div>';
    render(<App surface="tab" />, $('#app'));
    await wait(300);
    render(null, $('#app'));
    await wait(50);
    // 段階表示の効果が付けるのは、requestAnimationFrame で間引く関数 (ほかの画面の scroll / resize の監視は数えない)
    const mine = (t: unknown, fn: unknown) => (t === 'scroll' || t === 'resize') && typeof fn === 'function' && String(fn).includes('requestAnimationFrame');
    for (const [t, fn] of add.mock.calls) if (mine(t, fn)) added.push([t as string, fn]);
    for (const [t, fn] of rem.mock.calls) if (mine(t, fn)) removed.push([t as string, fn]);
    expect(added.length).toBeGreaterThan(0); // 段階表示の効果が付けている
    expect(removed.length).toBe(added.length);
    for (const [t, fn] of added) expect(removed.some(([rt, rf]) => rt === t && rf === fn), t).toBe(true);
    add.mockRestore();
    rem.mockRestore();
  });
});

describe('v36-B: "show all" grows in steps of 100 per frame', () => {
  // ID と関数の対応で持つ (取り消しは ID で消す。位置で消すと、runFrame で空にしたあとの古い ID が新しい関数を消す)
  let frames = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const runFrame = async () => {
    const cbs = [...frames.values()];
    frames = new Map();
    await act(() => void cbs.forEach((cb) => cb(0)));
    await flush(5);
  };
  const mount = async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush(80);
  };
  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    }) as any);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(((id: number) => void frames.delete(id)) as any);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: 100000, bottom: 100001, left: 0, right: 1, width: 1, height: 1, x: 0, y: 0, toJSON() {} }) as DOMRect);
  });

  it('adds 100 per frame, disables the button meanwhile, and the footer goes away at the total', async () => {
    await seed(350);
    await mount();
    expect(cardCount()).toBe(30);
    const btn = () => $$<HTMLButtonElement>('.list-more button')[0];
    await act(() => void btn().click());
    await flush(5);
    expect(btn().disabled).toBe(true);
    expect(cardCount()).toBe(30); // まだ 1 フレームも進んでいない
    await runFrame();
    expect(cardCount()).toBe(130);
    expect($('.list-more').textContent).toContain('あと 220 件');
    await runFrame();
    expect(cardCount()).toBe(230);
    await runFrame();
    expect(cardCount()).toBe(330);
    await runFrame();
    expect(cardCount()).toBe(350);
    expect($$('.list-more').length).toBe(0);
  });

  it('v37: while growing, the sentinel watchers are not re-attached every frame; they come back when it ends', async () => {
    await seed(450);
    await mount();
    const mineAdds = () => add.mock.calls.filter(([t, fn]) => t === 'scroll' && String(fn).includes('requestAnimationFrame')).length;
    const add = vi.spyOn(window, 'addEventListener');
    await act(() => void $$<HTMLButtonElement>('.list-more button')[0].click());
    await flush(5);
    const before = mineAdds();
    await runFrame();
    await runFrame();
    await runFrame();
    expect(mineAdds()).toBe(before); // 増やしている間は、付け直さない
    await runFrame();
    await runFrame();
    expect(cardCount()).toBe(450);
    expect($$('.list-more').length).toBe(0);
  });

  it('stops when the resetKey changes (folder / search / sort)', async () => {
    await seed(350);
    await mount();
    await act(() => void $$<HTMLButtonElement>('.list-more button')[0].click());
    await flush(5);
    await runFrame();
    expect(cardCount()).toBe(130);
    const row = $$('.side .fr').find((r) => r.textContent?.includes('未分類'))!;
    await act(() => void row.click());
    await flush(60);
    expect(cardCount()).toBe(30);
    for (let i = 0; i < 4; i++) await runFrame();
    expect(cardCount()).toBe(30); // 続きはやめた
    expect($$<HTMLButtonElement>('.list-more button')[0].disabled).toBe(false);
  });
});

describe('v36-C: the folder button size follows the height, not the width', () => {
  const rect = (w: number, h: number) => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const make = (bmRect: DOMRect, svgH = 22, circle?: { w: number; h: number; radius: string }) => {
    const bm = document.createElement('button');
    bm.getBoundingClientRect = () => bmRect;
    const svgHost = document.createElement('div');
    bm.append(svgHost);
    svgHost.innerHTML = '<svg></svg>';
    svgHost.querySelector('svg')!.getBoundingClientRect = () => rect(svgH, svgH);
    if (circle) {
      svgHost.style.borderRadius = circle.radius;
      svgHost.getBoundingClientRect = () => rect(circle.w, circle.h);
    }
    return { bm, btn: document.createElement('button') };
  };
  const size = (b: { btn: HTMLElement }) => [b.btn.style.width, b.btn.style.height];
  it('buttons that differ only in width (digits of the count) give the same size', () => {
    const a = make(rect(40, 40));
    const b = make(rect(96, 40));
    sizeSeparateButton(a.bm, a.btn);
    sizeSeparateButton(b.bm, b.btn);
    expect(size(a)).toEqual(['38px', '38px']); // v37: svg の高さ 22 + 16
    expect(size(b)).toEqual(size(a));
  });
  it('an ancestor that is a circle (larger than the svg, w≈h, big radius) wins over the height', () => {
    const c = make(rect(96, 40), 22, { w: 38, h: 39, radius: '50%' });
    sizeSeparateButton(c.bm, c.btn);
    expect(size(c)).toEqual(['39px', '39px']);
    const px = make(rect(96, 40), 22, { w: 44, h: 44, radius: '9999px' });
    sizeSeparateButton(px.bm, px.btn);
    expect(size(px)).toEqual(['44px', '44px']);
  });
  it('an ancestor that is not round or not square is ignored', () => {
    const sq = make(rect(96, 40), 22, { w: 44, h: 44, radius: '4px' });
    sizeSeparateButton(sq.bm, sq.btn);
    expect(size(sq)).toEqual(['38px', '38px']);
    const wide = make(rect(96, 40), 22, { w: 70, h: 44, radius: '50%' });
    sizeSeparateButton(wide.bm, wide.btn);
    expect(size(wide)).toEqual(['38px', '38px']);
  });
});

describe('v36-D: the settings description is not width-capped and does not use text-wrap: pretty', () => {
  const css = readFileSync('static/manager.css', 'utf8');
  it('.setting-desc has max-width:none (no em cap) and keeps overflow-wrap', () => {
    const rule = css.match(/(?:^|\n)\.setting-desc\{[^}]*\}/)![0];
    expect(rule).toContain('max-width:none');
    expect(rule).not.toMatch(/max-width:\d/);
    expect(rule).toContain('overflow-wrap:anywhere');
  });
  it('text-wrap: pretty stays on .muted elsewhere (v37), but .setting-desc and .setting-group .muted use wrap; headings keep balance', () => {
    expect(css).toMatch(/(^|\n)\.muted,[^{]*\{text-wrap:pretty\}/);
    expect(css).toMatch(/\.setting-group \.muted,\.setting-desc\{text-wrap:wrap\}/);
    for (const m of css.matchAll(/([^{}]+)\{[^}]*text-wrap:pretty[^}]*\}/g)) expect(m[1]).not.toMatch(/\.setting-desc|\.setting-group/);
    expect(css).toMatch(/h1,h2,h3,label,\.sec\{text-wrap:balance\}/);
  });
  it('no narrow-width (side panel) rule re-introduces a fixed width on .setting-desc', () => {
    expect(css).not.toMatch(/\.setting-desc\{[^}]*(?<!max-)width:\d/);
  });
});
