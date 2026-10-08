import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import {
  AutoCollector, COMMAND_TTL_MS, END_STREAK, FLUSH_EVERY, LIMIT_RESUME_MS, SPEED_RANGES, defaultDeps, handleCollectCommand, type CollectDeps,
} from '../src/content/autocollect';
import { addCollected, getSavedIds, listBookmarks, setAccountScope } from '../src/shared/storage';
import { peekCollectCommand, sendCollectCommand, updateAutoCollect } from '../src/shared/settings';
import { UNKNOWN_ACCOUNT_ID } from '../src/shared/models';
import type { Extracted } from '../src/content/snapshot';

const post = (n: number): Extracted => ({
  tweetId: `p${n}`,
  snapshot: { text: `post ${n}`, author: 'A', handle: '@a', media: [], createdAt: new Date(Date.UTC(2026, 9, 30) - n * 86400e3).toISOString(), url: `https://x.com/a/status/${n}` },
});

/** x.com のブックマークの一覧の模擬: p1 が先頭 (新しく追加した順)。画面に出るのは 6 件ずつで、スクロールで 5 件進む (画面外は DOM から外れる = 仮想化) */
function world(total: number, opts: { loadingAt?: (scrolls: number) => boolean } = {}) {
  const w = { start: 0, scrolls: 0, toTop: 0, sleeps: [] as number[], hook: undefined as undefined | ((n: number) => void | Promise<void>), saved: new Set<string>(), seq: 0, releaseLong: undefined as undefined | (() => void) };
  const rnd = [0, 1, 0.5];
  const deps: CollectDeps & { limit: boolean; hidden: boolean; page: boolean; account: string | null; loading: boolean } = {
    now: () => Date.now(),
    sleep: async (ms) => {
      w.sleeps.push(ms);
      await w.hook?.(w.sleeps.length);
      // 15 分の待ちは、テストが release するまで進まない。それ以外は、ほかのタスクに順番を譲るだけで、すぐ戻る
      if (ms === LIMIT_RESUME_MS) await new Promise<void>((r) => (w.releaseLong = r));
      else await new Promise<void>((r) => setTimeout(r, 0));
    },
    random: () => rnd[w.sleeps.length % 3],
    scrollBy: () => {
      w.scrolls++;
      w.start = Math.min(w.start + 5, total);
    },
    scrollToTop: () => {
      w.toTop++;
      w.start = 0;
    },
    viewportHeight: () => 1000,
    visible: () => Array.from({ length: Math.max(0, Math.min(6, total - w.start)) }, (_, i) => post(w.start + i + 1)),
    isLoading: () => deps.loading || !!opts.loadingAt?.(w.scrolls),
    hasLimit: () => deps.limit,
    pageOk: () => deps.page,
    isHidden: () => deps.hidden,
    accountId: () => deps.account,
    savedIds: async () => new Set([...w.saved, ...(await getSavedIds())]),
    addCollected: (seq, startedAt) => addCollected(seq, startedAt),
    saveRun: async () => {},
    clearRun: async () => {},
    limit: false,
    hidden: false,
    page: true,
    account: 'me',
    loading: false,
  };
  return { w, deps };
}
const consent = { consent: true as const, speed: 'slow' as const, cap: 0 as const, accountId: 'me' };
const shelfOrder = async () => (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const flushAsync = () => new Promise((r) => setTimeout(r, 0));
/** 完了 (done) / 一時停止などの状態になるまで待つ */
async function until(c: AutoCollector, pred: (s: NonNullable<AutoCollector['state']>) => boolean) {
  for (let i = 0; i < 400 && !(c.state && pred(c.state)); i++) await flushAsync();
  expect(c.state && pred(c.state)).toBe(true);
}

beforeEach(() => {
  installChromeMock();
  setAccountScope(UNKNOWN_ACCOUNT_ID);
});

describe('consent: nothing starts without the user starting it', () => {
  it('start() without consent does nothing: no scroll, no wait', async () => {
    const { w, deps } = world(20);
    const c = new AutoCollector(deps);
    expect(await c.start({ consent: false, accountId: 'me' })).toBe(false);
    expect(await c.start({ accountId: 'me' })).toBe(false);
    expect(c.state).toBeNull();
    expect(w.scrolls).toBe(0);
    expect(w.sleeps).toEqual([]);
  });
  it('a command without consent, or a stale one, never starts it (the stale one is removed); an install alone never scrolls', async () => {
    const { w, deps } = world(20);
    const c = new AutoCollector(deps);
    await sendCollectCommand({ type: 'start', accountId: 'me' }); // consent なし
    await handleCollectCommand(c, deps);
    expect(c.state).toBeNull();
    await sendCollectCommand({ type: 'start', consent: true, accountId: 'me' });
    const stale = (await peekCollectCommand())!;
    (globalThis as any).chrome.storage.local.set({ collectCommand: { ...stale, at: stale.at - COMMAND_TTL_MS - 1 } });
    await handleCollectCommand(c, deps);
    expect(c.state).toBeNull();
    expect(await peekCollectCommand()).toBeNull();
    expect(w.scrolls).toBe(0);
  });
  it('a command with consent starts it with a 3-second countdown first (cancellable)', async () => {
    const { w, deps } = world(20);
    const c = new AutoCollector(deps);
    const states: string[] = [];
    c.subscribe((s) => s && states.push(`${s.status}${s.countdown ?? ''}`));
    w.hook = (n) => {
      if (n === 2) void c.stop(); // 2 秒目に「キャンセル」
    };
    await sendCollectCommand({ type: 'start', consent: true, speed: 'slow', cap: 0, accountId: 'me' });
    await handleCollectCommand(c, deps);
    expect(states.slice(0, 2)).toEqual(['countdown3', 'countdown2']);
    expect(c.state).toBeNull();
    expect(w.scrolls).toBe(0); // キャンセルしたので、一度もスクロールしていない
  });
  it('the setting 「自動取り込みを使う」 off: a command is ignored', async () => {
    const { w, deps } = world(20);
    await updateAutoCollect({ enabled: false });
    const c = new AutoCollector(deps);
    await sendCollectCommand({ type: 'start', consent: true, accountId: 'me' });
    await handleCollectCommand(c, deps);
    expect(c.state).toBeNull();
    expect(w.scrolls).toBe(0);
  });
  it('only on the bookmarks tab: /i/history/likes and other pages do not run', async () => {
    const { w, deps } = world(20);
    const real = defaultDeps();
    for (const [path, ok] of [['/i/history', true], ['/i/bookmarks', true], ['/i/history/likes', false], ['/home', false], ['/someone/status/1', false]] as const) {
      history.pushState(null, '', path);
      expect(real.pageOk()).toBe(ok);
    }
    deps.page = false;
    const c = new AutoCollector(deps);
    expect(await c.start(consent)).toBe(false);
    await sendCollectCommand({ type: 'start', consent: true, accountId: 'me' });
    await handleCollectCommand(c, deps);
    expect(c.state).toBeNull();
    expect(w.scrolls).toBe(0);
    expect(await peekCollectCommand()).not.toBeNull(); // 他のページでは受け取らない (ブックマークのタブに移れば処理される)
    history.pushState(null, '', '/');
  });
  it('without an account, or with a different account than the one chosen in the manager, it does not start', async () => {
    const a = world(20);
    a.deps.account = null;
    const c1 = new AutoCollector(a.deps);
    expect(await c1.start(consent)).toBe(false);
    expect(c1.state).toMatchObject({ status: 'stopped', reason: 'refused-unknown' });
    expect(a.w.scrolls).toBe(0);
    const b = world(20);
    b.deps.account = 'other';
    const c2 = new AutoCollector(b.deps);
    expect(await c2.start(consent)).toBe(false);
    expect(c2.state).toMatchObject({ status: 'stopped', reason: 'refused-account' });
    expect(b.w.scrolls).toBe(0);
  });
});

describe('scrolling, pausing and finishing', () => {
  it('waits within the range of each speed between scrolls (slow 2–4 s, normal 1–2.5 s); the 3-second countdown comes first', async () => {
    for (const speed of ['slow', 'normal'] as const) {
      const { w, deps } = world(30);
      const c = new AutoCollector(deps);
      await c.start({ ...consent, speed });
      await until(c, (s) => s.status === 'done');
      expect(w.sleeps.slice(0, 3)).toEqual([1000, 1000, 1000]);
      const waits = w.sleeps.slice(3);
      const [min, max] = SPEED_RANGES[speed];
      expect(waits.length).toBeGreaterThan(5);
      expect(Math.min(...waits)).toBeGreaterThanOrEqual(min);
      expect(Math.max(...waits)).toBeLessThanOrEqual(max);
      expect(new Set(waits).size).toBeGreaterThan(1); // 一定ではなく、ばらつく
    }
    expect(SPEED_RANGES).toEqual({ slow: [2000, 4000], normal: [1000, 2500] });
  });

  it('reads the DOM at every scroll (the list drops posts that are off screen), so nothing is missed', async () => {
    const { deps } = world(40);
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect(await shelfOrder()).toEqual(ids(40));
    expect(c.state).toMatchObject({ imported: 40, skipped: 0, failed: 0 });
  });

  it('paused: it does not scroll; resume continues from where it was (no rewind)', async () => {
    const { w, deps } = world(60);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 6) void c.pause('user');
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'paused');
    const at = w.scrolls;
    expect(c.state!.reason).toBe('user');
    for (let i = 0; i < 20; i++) await flushAsync();
    expect(w.scrolls).toBe(at); // 一時停止中は動かない
    w.hook = undefined;
    const toTop = w.toTop;
    expect(await c.resume()).toBe(true);
    await until(c, (s) => s.status === 'done');
    expect(w.toTop).toBe(toTop); // 同じページの中の再開は、先頭に戻らない
    expect(w.scrolls).toBeGreaterThan(at);
    expect(await shelfOrder()).toEqual(ids(60));
  });

  it('already imported posts are skipped (and counted as skipped) while the same speed is kept', async () => {
    await addCollected([post(3), post(4), post(10)].map((p) => p), 1_000);
    const { w, deps } = world(20);
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect(c.state).toMatchObject({ imported: 17, skipped: 3 });
    expect(w.sleeps.slice(3).every((ms) => ms >= 2000 && ms <= 4000)).toBe(true); // スキップの間も待ち時間は同じ
    expect(await shelfOrder()).toEqual(ids(20));
  });

  it('finishes after 5 scrolls in a row without a new post — not while the loading indicator is shown', async () => {
    expect(END_STREAK).toBe(5);
    const { w, deps } = world(12);
    const c = new AutoCollector(deps);
    deps.loading = true; // 末尾まで来ても、読み込み中の表示が出ている間は終わらない
    await c.start(consent);
    for (let i = 0; i < 400; i++) await flushAsync();
    expect(c.state!.status).toBe('running');
    expect(w.scrolls).toBeGreaterThanOrEqual(3 + END_STREAK); // 末尾に来てから 5 回以上スクロールしても、終わらない
    deps.loading = false;
    await until(c, (s) => s.status === 'done');
    expect(c.state!.imported).toBe(12);
  });

  it('the oldest post date seen is recorded', async () => {
    const { deps } = world(10);
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect(c.state!.oldestSeenPostDate).toBe(post(10).snapshot.createdAt);
  });

  it('flushes to storage every FLUSH_EVERY posts and at the end (the saved part survives a stop)', async () => {
    expect(FLUSH_EVERY).toBe(20);
    const { w, deps } = world(100);
    const c = new AutoCollector(deps);
    w.hook = async (n) => {
      if (n === 3 + 8) void c.stop(); // 途中で「停止」
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'stopped');
    const saved = (await listBookmarks()).length;
    expect(saved).toBe(c.state!.imported);
    expect(saved).toBeGreaterThan(0);
    expect(await shelfOrder()).toEqual(ids(saved)); // 止めた時点でも、X の並びと同じ
  });
});

describe('automatic pauses', () => {
  it('the account changes → paused (and it does not resume for another account)', async () => {
    const { w, deps } = world(80);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 6) {
        deps.account = 'other';
        c.onAccountChanged('other');
      }
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'paused');
    expect(c.state!.reason).toBe('account');
    expect(await c.resume()).toBe(false);
    deps.account = 'me';
    expect(await c.resume()).toBe(true);
    await c.pause('user');
  });

  it('the tab becomes hidden → paused; it resumes only when the user presses resume', async () => {
    const { w, deps } = world(80);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 6) c.onHidden();
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'paused');
    expect(c.state!.reason).toBe('hidden');
    const at = w.scrolls;
    for (let i = 0; i < 20; i++) await flushAsync();
    expect(w.scrolls).toBe(at); // 自動では再開しない
    deps.hidden = true;
    expect(await c.resume()).toBe(false); // 見えていないタブでは再開できない
    deps.hidden = false;
    expect(await c.resume()).toBe(true);
    await c.pause('user');
  });

  it('a limit / error display from X → paused as "limit" (no auto resume); 「15 分後に再開する」 is armed only when pressed', async () => {
    expect(LIMIT_RESUME_MS).toBe(15 * 60 * 1000);
    const { w, deps } = world(80);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 6) deps.limit = true;
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'limit');
    const at = w.scrolls;
    for (let i = 0; i < 20; i++) await flushAsync();
    expect(w.scrolls).toBe(at);
    expect(c.state!.resumeAt).toBeUndefined();
    // 押したときだけ: 15 分待つ (そのあいだ停止もできる。待ちが終わると、再開する)
    deps.limit = false;
    const sleeps = w.sleeps.length;
    w.hook = undefined;
    const later = c.resumeLater();
    await flushAsync();
    expect(w.sleeps.slice(sleeps)).toEqual([LIMIT_RESUME_MS]);
    expect(c.state!.resumeAt).toBeDefined();
    expect(c.state!.status).toBe('limit'); // 待っている間は、止まったまま
    expect(w.scrolls).toBe(at);
    w.releaseLong!();
    await later;
    await until(c, (s) => s.status === 'done');
  });

  it('stopping while waiting for the 15 minutes cancels the reservation', async () => {
    const { w, deps } = world(80);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 6) deps.limit = true;
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'limit');
    deps.limit = false;
    w.hook = undefined;
    const later = c.resumeLater();
    await flushAsync();
    await c.stop();
    w.releaseLong!();
    await later;
    expect(c.state!.status).toBe('stopped');
    const at = w.scrolls;
    for (let i = 0; i < 10; i++) await flushAsync();
    expect(w.scrolls).toBe(at);
  });

  it('the per-run cap: it stops at the cap and 「続ける」 (resume) goes on for another cap', async () => {
    const { deps } = world(300);
    const c = new AutoCollector(deps);
    await c.start({ ...consent, cap: 100 });
    await until(c, (s) => s.status === 'paused');
    expect(c.state!.reason).toBe('cap');
    const first = c.state!.imported;
    expect(first).toBeGreaterThanOrEqual(100);
    expect(first).toBeLessThan(110);
    expect((await listBookmarks()).length).toBe(first);
    expect(await c.resume()).toBe(true);
    await until(c, (s) => s.status === 'paused' || s.status === 'done');
    expect(c.state!.imported).toBeGreaterThanOrEqual(first + 100);
    await c.stop();
    expect(await shelfOrder()).toEqual(ids((await listBookmarks()).length));
  });

  it('cap 0 (do not stop) runs to the end', async () => {
    const { deps } = world(150);
    const c = new AutoCollector(deps);
    await c.start({ ...consent, cap: 0 });
    await until(c, (s) => s.status === 'done');
    expect(c.state!.imported).toBe(150);
  });

  it('leaving the bookmarks page pauses it', async () => {
    const { w, deps } = world(80);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 6) deps.page = false;
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'paused');
    expect(c.state!.reason).toBe('page');
  });
});

describe('after a page reload', () => {
  it('a run that was going is adopted as paused ("reload"); resuming rewinds to the top, skips what was imported, and the order stays the same', async () => {
    const first = world(60);
    const c1 = new AutoCollector(first.deps);
    first.w.hook = (n) => {
      if (n === 10) void c1.pause('user');
    };
    let stored: any = null;
    first.deps.saveRun = async (r) => void (stored = r);
    await c1.start(consent);
    await until(c1, (s) => s.status === 'paused');
    const importedBefore = c1.state!.imported;
    const savedBefore = Object.fromEntries((await listBookmarks()).map((b) => [b.tweetId, b.savedAt]));
    stored = { ...stored, status: 'running' }; // ページが読み込み直された (動いている最中に閉じた)
    // ページを読み込み直した → 新しい content script
    const second = world(60);
    const c2 = new AutoCollector(second.deps);
    c2.adopt(stored);
    expect(c2.state).toMatchObject({ status: 'paused', reason: 'reload', imported: importedBefore });
    expect(c2.needsRewind).toBe(true);
    expect(await c2.resume()).toBe(true);
    expect(second.w.toTop).toBe(1); // 一覧の先頭からやり直す
    await until(c2, (s) => s.status === 'done');
    expect(c2.state!.skipped).toBeGreaterThanOrEqual(importedBefore); // 取り込み済みは読み飛ばす
    expect((await listBookmarks()).length).toBe(60);
    expect(await shelfOrder()).toEqual(ids(60));
    for (const b of await listBookmarks()) if (savedBefore[b.tweetId] !== undefined) expect(b.savedAt).toBe(savedBefore[b.tweetId]);
  });

  it('finished or stopped runs are not adopted', () => {
    const { deps } = world(5);
    const c = new AutoCollector(deps);
    c.adopt({ status: 'done', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: 300, updatedAt: 1 });
    expect(c.state).toBeNull();
  });
});

describe('communication: only the page DOM is read', () => {
  it('a whole run (start, pause, resume, finish) never calls fetch / XMLHttpRequest / sendBeacon / WebSocket', async () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', xhrSpy);
    (navigator as any).sendBeacon = beacon;
    const { w, deps } = world(50);
    const c = new AutoCollector(deps);
    w.hook = (n) => {
      if (n === 8) void c.pause('user');
    };
    await c.start(consent);
    await until(c, (s) => s.status === 'paused');
    w.hook = undefined;
    await c.resume();
    await until(c, (s) => s.status === 'done');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('the source of the collector does not mention fetch / XMLHttpRequest / graphql', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/content/autocollect.ts', 'src/content/autocollectPanel.ts']) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|graphql|\/i\/api/i);
    }
  });
});

