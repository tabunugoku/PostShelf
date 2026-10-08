import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import {
  AUTO_CAP, FullTextQueue, GAP_MAX_MS, GAP_MIN_MS, MANUAL_CAP, MAX_FAILURES, RETRY_MS, TAB_TIMEOUT_MS, cleanupAtStartup, defaultDeps, manualItems,
  type AskResult, type FullTextDeps,
} from '../src/background/fulltext';
import { getFullTextRun, setFullTextTab, updateSettings } from '../src/shared/settings';
import { getBookmark, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const snap = (id: number, over: object = {}) => ({ text: `短い ${id}`, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${id}`, truncated: true, ...over });

/** 時計を進めるだけの sleep と、開いたタブの記録を持つ偽の依存 */
function fake(answer: (tab: number, id: string, n: number) => AskResult | 'throw' = (_t, id) => ({ ok: true, text: `全文 ${id}`, segments: [{ t: 'link', v: 'l', href: 'https://t.co/x' }] })) {
  const w = { t: 1_000_000, sleeps: [] as number[], opened: [] as string[], closed: [] as number[], open: 0, maxOpen: 0, asks: 0, collect: 0, tab: null as number | null };
  let next = 1;
  const d: FullTextDeps = {
    ...defaultDeps(),
    now: () => w.t,
    sleep: async (ms) => {
      w.sleeps.push(ms);
      w.t += ms;
    },
    random: () => 0.5,
    openTab: async (url) => {
      w.opened.push(url);
      w.maxOpen = Math.max(w.maxOpen, ++w.open);
      return next++;
    },
    closeTab: async (id) => {
      w.closed.push(id);
      w.open--;
    },
    ask: async (tab, id) => {
      const r = answer(tab, id, ++w.asks);
      if (r === 'throw') throw new Error('no receiver');
      return r;
    },
    collectActive: async () => w.collect-- > 0,
    setTab: async (id) => void (w.tab = id),
  };
  return { w, d };
}

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});
const saved = async (n: number) => {
  for (let i = 1; i <= n; i++) await setBookmarkFolders(String(i), [], snap(i));
};
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ accountId: 'me', tweetId: String(i + 1) }));

describe('v24-B: 全文の取得のキュー', () => {
  it('a saved truncated post is fetched: only text / segments / truncated change; the tab is closed', async () => {
    await saved(1);
    const before = (await getBookmark('1'))!;
    const { w, d } = fake();
    await new FullTextQueue(d).enqueue(items(1), 'save');
    const after = (await getBookmark('1'))!;
    expect(after.snapshot.text).toBe('全文 1');
    expect(after.snapshot.segments).toEqual([{ t: 'link', v: 'l', href: 'https://t.co/x' }]);
    expect(after.snapshot.truncated).toBe(false);
    expect({ ...after, snapshot: { ...after.snapshot, text: '', segments: undefined, truncated: undefined } }).toEqual({ ...before, snapshot: { ...before.snapshot, text: '', segments: undefined, truncated: undefined } });
    expect(w.opened).toEqual(['https://x.com/a/status/1']);
    expect(w.closed).toEqual([1]);
    expect(w.tab).toBeNull();
    expect((await getFullTextRun())?.running).toBe(false);
  });

  it('the setting off: nothing is opened', async () => {
    await saved(1);
    await updateSettings({ fullText: false });
    const { w, d } = fake();
    await new FullTextQueue(d).enqueue(items(1), 'save');
    expect(w.opened).toEqual([]);
    expect((await getBookmark('1'))!.snapshot.truncated).toBe(true);
  });

  it('a post that is no longer truncated is skipped without opening a tab', async () => {
    await setBookmarkFolders('1', [], snap(1, { truncated: false }));
    const { w, d } = fake();
    await new FullTextQueue(d).enqueue(items(1), 'save');
    expect(w.opened).toEqual([]);
  });

  it('runs one at a time with a 4–8 second gap between posts', async () => {
    await saved(4);
    const { w, d } = fake();
    await new FullTextQueue(d).enqueue(items(4), 'manual');
    expect(w.opened).toHaveLength(4);
    expect(w.maxOpen).toBe(1); // 同時に開く裏のタブは 1 つ
    const gaps = w.sleeps.filter((ms) => ms >= GAP_MIN_MS && ms <= GAP_MAX_MS);
    expect(gaps).toHaveLength(3);
    expect(GAP_MIN_MS).toBe(4000);
    expect(GAP_MAX_MS).toBe(8000);
  });

  it('a second enqueue while running joins the same queue (still one tab at a time)', async () => {
    await saved(3);
    const { w, d } = fake();
    const q = new FullTextQueue(d);
    const a = q.enqueue(items(2), 'save');
    const b = q.enqueue([{ accountId: 'me', tweetId: '3' }], 'save');
    await Promise.all([a, b]);
    expect(w.opened).toHaveLength(3);
    expect(w.maxOpen).toBe(1);
  });

  it('gives up after 15 seconds, closes the tab, and leaves the post truncated', async () => {
    await saved(1);
    const { w, d } = fake(() => ({ ok: false, reason: 'wait' }));
    await new FullTextQueue(d).enqueue(items(1), 'save');
    expect(w.closed).toEqual([1]);
    expect((await getBookmark('1'))!.snapshot.truncated).toBe(true);
    expect(w.t - 1_000_000).toBeGreaterThanOrEqual(TAB_TIMEOUT_MS);
    expect(w.t - 1_000_000).toBeLessThan(TAB_TIMEOUT_MS + 3000);
  });

  it('retries a post at most once per hour', async () => {
    await saved(1);
    const { w, d } = fake(() => ({ ok: false, reason: 'wait' }));
    const q = new FullTextQueue(d);
    await q.enqueue(items(1), 'save');
    await q.enqueue(items(1), 'save');
    expect(w.opened).toHaveLength(1);
    w.t += RETRY_MS + 1;
    await q.enqueue(items(1), 'save');
    expect(w.opened).toHaveLength(2);
  });

  it(`stops after ${MAX_FAILURES} failures in a row, with the reason`, async () => {
    await saved(6);
    const { w, d } = fake(() => ({ ok: false, reason: 'wait' }));
    await new FullTextQueue(d).enqueue(items(6), 'manual');
    expect(w.opened).toHaveLength(3);
    const run = (await getFullTextRun())!;
    expect(run).toMatchObject({ running: false, stopReason: 'failures', failed: 3 });
  });

  it('a success resets the failure count', async () => {
    await saved(6);
    const { w, d } = fake((_t, id) => (['1', '2', '4', '5'].includes(id) ? { ok: false, reason: 'wait' } : { ok: true, text: `全文 ${id}` }));
    await new FullTextQueue(d).enqueue(items(6), 'manual');
    expect(w.opened).toHaveLength(6);
    expect((await getFullTextRun())!.stopReason).toBeUndefined();
  });

  it('stops at once when X shows a limit / warning (xError), with the reason', async () => {
    await saved(4);
    const { w, d } = fake(() => ({ ok: false, reason: 'limit' }));
    await new FullTextQueue(d).enqueue(items(4), 'manual');
    expect(w.opened).toHaveLength(1);
    expect((await getFullTextRun())!.stopReason).toBe('limit');
    expect(w.closed).toEqual([1]);
  });

  it('does not run while an auto-collect run is active (waits for it to end)', async () => {
    await saved(1);
    const { w, d } = fake();
    w.collect = 3; // 3 回確かめるあいだ、取り込み中
    await new FullTextQueue(d).enqueue(items(1), 'auto');
    expect(w.sleeps.filter((ms) => ms === 5000)).toHaveLength(3);
    expect(w.opened).toHaveLength(1);
  });

  it('「止める」 clears the waiting posts and closes the tab', async () => {
    await saved(5);
    const { w, d } = fake();
    const q = new FullTextQueue(d);
    const origSleep = d.sleep;
    d.sleep = async (ms) => {
      await origSleep(ms);
      if (w.opened.length === 2) await q.stop('user');
    };
    await q.enqueue(items(5), 'manual');
    expect(w.opened.length).toBeLessThanOrEqual(2);
    expect(w.open).toBe(0);
    expect((await getFullTextRun())).toMatchObject({ running: false, stopReason: 'user' });
  });

  it('the caps: 30 for auto-collect, 50 for 「いま取得する」', async () => {
    for (let i = 1; i <= 60; i++) await setBookmarkFolders(String(i), [], snap(i));
    expect(AUTO_CAP).toBe(30);
    expect(MANUAL_CAP).toBe(50);
    expect(await manualItems('me')).toHaveLength(50);
    expect(await manualItems('other')).toHaveLength(0);
  });

  it('startup: a tab left open is closed, and a stale running record is marked stopped', async () => {
    await setFullTextTab(42);
    await chrome.storage.local.set({ fullTextRun: { running: true, kind: 'manual', total: 3, done: 1, failed: 0, updatedAt: 1 } });
    const { w, d } = fake();
    await cleanupAtStartup(d);
    expect(w.closed).toEqual([42]);
    expect(w.tab).toBeNull();
    expect((await getFullTextRun())!.running).toBe(false);
  });
});

describe('v24-B: the real tab calls', () => {
  it('opens the tab in the background (active: false) and never touches the current tab', async () => {
    const create = vi.fn(async () => ({ id: 9 }));
    const update = vi.fn();
    const remove = vi.fn(async () => undefined);
    (globalThis as any).chrome.tabs = { create, update, remove, sendMessage: vi.fn() };
    const d = defaultDeps();
    expect(await d.openTab('https://x.com/a/status/1')).toBe(9);
    expect(create).toHaveBeenCalledWith({ url: 'https://x.com/a/status/1', active: false });
    await d.closeTab(9);
    expect(remove).toHaveBeenCalledWith(9);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('v24-B: 自動取り込みのあとで、全文を頼む', () => {
  it('asks for the truncated posts only after the run is done (not while running), with the ids', async () => {
    const { installAutoCollect } = await import('../src/content/autocollect');
    const send = vi.fn(async () => undefined);
    (globalThis as any).chrome.runtime.sendMessage = send;
    (globalThis as any).chrome.runtime.onMessage = { addListener() {} };
    let calls = 0;
    const post = (n: number, truncated: boolean) => ({ tweetId: `t${n}`, snapshot: { text: `p${n}`, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${n}`, ...(truncated ? { truncated: true } : {}) } });
    const seenWhileRunning: number[] = [];
    const deps = {
      now: () => Date.now(),
      sleep: async () => {
        seenWhileRunning.push(send.mock.calls.length);
        await new Promise<void>((r) => setTimeout(r, 0));
      },
      random: () => 0, scrollBy() {}, scrollToTop() {}, scrollY: () => ++calls, viewportHeight: () => 1000,
      visible: () => [post(1, true), post(2, false), post(3, true)],
      isLoading: () => false, hasLimit: () => false, pageOk: () => true, isHidden: () => false, accountId: () => 'me',
      savedIds: async () => new Set<string>(), addCollected: async () => 3, saveRun: async () => {}, clearRun: async () => {},
    };
    history.pushState(null, '', '/i/history');
    const c = installAutoCollect(() => {}, deps as never);
    await c.start({ consent: true, speed: 'slow', cap: 0, accountId: 'me' });
    for (let i = 0; i < 400 && c.state?.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 5));
    expect(c.state?.status).toBe('done');
    expect(Math.max(...seenWhileRunning)).toBe(0); // 動いている間は、一度も頼まない
    const msgs = send.mock.calls.map((x: any) => x[0]).filter((m: any) => m.type === 'fetchFullText');
    expect(msgs).toEqual([{ type: 'fetchFullText', accountId: 'me', ids: ['t1', 't3'], kind: 'auto' }]);
  });
});
