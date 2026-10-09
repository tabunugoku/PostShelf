import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { setAccountScope } from '../src/shared/storage';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/** act の外で待つ。act の中だと描画がまとめて行われ、実機のように「データを読んだ描画」と「一覧が現れる描画」が分かれない */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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
    await wait(400);
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
    await wait(400);
    await act(() => void window.dispatchEvent(new Event('scroll')));
    await flush(80);
    expect(cardCount()).toBeGreaterThan(30);
    vi.restoreAllMocks();
  });
});

describe('v36-A: listeners do not leak when the effect re-runs', () => {
  it('scroll / resize listeners added by the staged-rendering effect are all removed on unmount', async () => {
    await seed(200);
    vi.stubGlobal('IntersectionObserver', undefined);
    const live = new Map<string, number>();
    const add = vi.spyOn(window, 'addEventListener').mockImplementation(((t: string) => void live.set(t, (live.get(t) ?? 0) + 1)) as any);
    const rem = vi.spyOn(window, 'removeEventListener').mockImplementation(((t: string) => void live.set(t, (live.get(t) ?? 0) - 1)) as any);
    document.body.innerHTML = '<div id="app"></div>';
    render(<App surface="tab" />, $('#app'));
    await wait(300);
    render(null, $('#app'));
    await wait(50);
    // 自前の scroll / resize だけを数える (他のコードが付けたものは、付けた数と外した数が別でもよい)
    expect(live.get('scroll') ?? 0).toBeLessThanOrEqual(0);
    add.mockRestore();
    rem.mockRestore();
  });
});
