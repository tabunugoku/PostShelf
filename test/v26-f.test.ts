import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollector, type CollectDeps, type SeqEntry } from '../src/content/autocollect';
import { addCollected, getSavedIds, listBookmarks, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { refreshAll, injectButtons } from '../src/content/buttons';
import { refreshCollectButton, dropSavedCache } from '../src/content/collect';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import type { Extracted } from '../src/content/snapshot';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const post = (n: number): Extracted => ({
  tweetId: `p${n}`,
  snapshot: { text: `post ${n}`, author: 'A', handle: '@a', media: [], createdAt: new Date(Date.UTC(2026, 9, 30) - n * 86400e3).toISOString(), url: `https://x.com/a/status/${n}` },
});
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeDeps(total: number, sizes: number[], overrides: Partial<CollectDeps> = {}) {
  let start = 0;
  let run = null as null | Parameters<CollectDeps['saveRun']>[0];
  const deps: CollectDeps = {
    hasUnseen: () => false,
    now: () => Date.now(),
    sleep: async () => void (await tick()),
    random: () => 0,
    scrollBy: () => void (start = Math.min(start + 5, total)),
    scrollToTop: () => void (start = 0),
    scrollY: () => start * 100,
    viewportHeight: () => 1000,
    visible: () => Array.from({ length: Math.max(0, Math.min(6, total - start)) }, (_, i) => post(start + i + 1)),
    isLoading: () => false,
    hasLimit: () => false,
    pageOk: () => true,
    isHidden: () => false,
    accountId: () => 'me',
    savedIds: (id) => getSavedIds(id),
    loadRun: async () => run,
    addCollected: async (seq: SeqEntry[], startedAt, id) => (sizes.push(seq.length), addCollected(seq, startedAt, id)),
    saveRun: async (r) => void (run = structuredClone(r)),
    clearRun: async () => void (run = null),
    ...overrides,
  };
  return deps;
}
/** 先に保存してある 2 件。x.com の一覧の並びと合うよう、上のほうが新しい savedAt を持つ */
async function seedAnchors() {
  await setBookmarkFolders('p10', [], post(10).snapshot);
  await setBookmarkFolders('p50', [], post(50).snapshot);
  const raw = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, { savedAt: number }>;
  raw['me:p10'].savedAt = 5_000_000;
  raw['me:p50'].savedAt = 1_000_000;
  await chrome.storage.local.set({ bookmarks: raw });
}
async function runAll(c: AutoCollector) {
  await c.start({ consent: true, speed: 'slow', cap: 0, accountId: 'me' });
  for (let i = 0; i < 2000 && c.state?.status !== 'done'; i++) await tick();
  expect(c.state!.status).toBe('done');
}

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

describe('v26-F: the import saves only the difference, in the same order', () => {
  it('each save gets a small window (not everything collected so far), and the order is the list order', async () => {
    const sizes: number[] = [];
    const c = new AutoCollector(makeDeps(200, sizes));
    await runAll(c);
    const list = await listBookmarks();
    expect(list).toHaveLength(200);
    const byTime = [...list].sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId);
    expect(byTime).toEqual(Array.from({ length: 200 }, (_, i) => `p${i + 1}`));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.max(...sizes)).toBeLessThan(60); // 全件 (200) を毎回渡さない
  });

  it('posts that were saved before keep their savedAt and stay the anchors of the order', async () => {
    // p10 と p50 は、先に別の場所で保存してある
    setAccountScope('me');
    await seedAnchors();
    const before = Object.fromEntries((await listBookmarks()).map((b) => [b.tweetId, b.savedAt]));
    const c = new AutoCollector(makeDeps(80, []));
    await runAll(c);
    const list = await listBookmarks();
    expect(list).toHaveLength(80);
    for (const k of ['p10', 'p50']) expect(list.find((b) => b.tweetId === k)!.savedAt).toBe(before[k]);
    // 全件を 1 回で保存した場合と同じ並び
    const fresh = await (async () => {
      installChromeMock();
      setAccountScope('me');
      await seedAnchors();
      const all = Array.from({ length: 80 }, (_, i) => post(i + 1));
      await addCollected(all, Date.now(), 'me');
      return (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId);
    })();
    // 既存の 2 件の savedAt は時刻に依存するので、新しい分の相対順だけ比べる
    const incremental = [...list].sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId).filter((id) => id !== 'p10' && id !== 'p50');
    expect(incremental).toEqual(fresh.filter((id) => id !== 'p10' && id !== 'p50'));
  });

  it('a failed save keeps the items and sends them with the next one', async () => {
    let fail = 1;
    const sizes: number[] = [];
    const base = makeDeps(60, sizes);
    base.addCollected = async (seq, startedAt, id) => {
      if (fail-- > 0) throw new Error('x');
      sizes.push(seq.length);
      return addCollected(seq, startedAt, id);
    };
    const c = new AutoCollector(base);
    await runAll(c);
    expect((await listBookmarks())).toHaveLength(60);
    expect(c.state!.failed).toBe(0);
  });
});

const KEY = 'bookmarks';
describe('v26-F: the buttons read the saved data once per refresh', () => {
  const one = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
  const html = [1, 2, 3].map((n) => one.replaceAll('1234567890', `123456789${n}`)).join('');
  it('refreshAll reads the bookmarks once for all articles', async () => {
    document.body.innerHTML = html;
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 1 });
    injectButtons();
    await tick();
    const get = vi.spyOn(chrome.storage.local, 'get');
    await refreshAll();
    const reads = (get.mock.calls as unknown as [string][]).filter(([k]) => k === KEY);
    expect(reads.length).toBe(1);
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBeGreaterThan(1);
  });

  it('refreshCollectButton reuses the saved ids for a short time, and drops them on a change', async () => {
    document.body.innerHTML = html + '<button class="postshelf-collect"></button>';
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 1 });
    dropSavedCache();
    await getSavedIds(); // 初回の移行の読み込みを済ませておく
    const get = vi.spyOn(chrome.storage.local, 'get');
    const count = () => (get.mock.calls as unknown as [string][]).filter(([k]) => k === KEY).length;
    await refreshCollectButton();
    await refreshCollectButton();
    await refreshCollectButton();
    expect(count()).toBe(1);
    dropSavedCache();
    await refreshCollectButton();
    expect(count()).toBe(2);
  });
});
