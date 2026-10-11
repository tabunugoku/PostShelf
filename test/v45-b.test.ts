import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { extractTweet, type Extracted } from '../src/content/snapshot';
import { AutoCollector, defaultDeps, SPEED_RANGES, WAIT_FLOORS, WAIT_STEP_MS, SCROLL_RATIO, SETTLE_POLL_MS, SETTLE_MAX_MS } from '../src/content/autocollect';
import { addCollected, listBookmarks, setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock(); setAccountScope('me');
  document.body.innerHTML = readFileSync('test/fixtures/v45-media.html', 'utf8');
});
const ex = (id: string) => extractTweet(document.getElementById(id)!)!;
const pending = () => ({ ...ex('image-pending'), mediaPending: true as const });

it('marks missing own media, excludes quote media, and ignores empty src', () => {
  expect(ex('image-pending')).toMatchObject({ mediaPending: true as const, snapshot: { media: [] } });
  expect(ex('video-pending')).toMatchObject({ mediaPending: true as const });
  for (const id of ['image-ready', 'video-ready', 'no-media']) expect(ex(id).mediaPending).toBeUndefined();
  expect(ex('no-media').snapshot.media).toEqual([]);
  document.querySelector('#image-pending img')!.remove();
  expect(ex('image-pending').mediaPending).toBe(true);
});

function reader(items: Extracted[], onSleep: (n: number) => void = () => {}) {
  const write = vi.fn(async (seq, at, account) => addCollected(seq, at, account));
  let sleeps = 0;
  // 待ちは実際には待たず、回数だけ数える (v48: 読み込み中のポストは、同じ読み取りの中で待つ)
  const sleep = async () => void onSleep(++sleeps);
  const c = new AutoCollector({
    ...defaultDeps(), visible: () => items, savedIds: async () => new Set(), addCollected: write, saveRun: async () => {},
    sleep, random: () => 0,
  });
  c.state = { status: 'running', accountId: 'me', startedAt: 1000, imported: 0, skipped: 0, failed: 0, speed: 'slow', cap: 0, updatedAt: 1000 };
  const read = () => (c as any).readVisible(0) as Promise<number>;
  const flush = (final = false) => (c as any).flush(final) as Promise<void>;
  return { c, read, flush, write, sleeps: () => sleeps };
}

it.each(['image-pending', 'video-pending'])('waits for %s in the same reading, then saves the newly read media', async id => {
  const items: Extracted[] = [{ ...ex(id), mediaPending: true as const }];
  const incoming = id === 'image-pending' ? ex('image-ready').snapshot : ex('video-ready').snapshot;
  const r = reader(items, n => { if (n === 2) items[0] = { tweetId: items[0].tweetId, snapshot: incoming }; });
  await r.read(); await r.flush();
  expect(r.sleeps()).toBe(2);
  expect(r.write).toHaveBeenCalledTimes(1);
  expect((await listBookmarks())[0].snapshot).toEqual(incoming);
  expect((await listBookmarks())[0].snapshot).not.toHaveProperty('mediaPending');
  await r.read(); await r.flush(); expect(r.write).toHaveBeenCalledTimes(1);
});

it('saves the last reading after the wait budget if still pending', async () => {
  const items = [pending()]; const r = reader(items);
  await r.read(); await r.flush();
  expect(r.sleeps() * SETTLE_POLL_MS).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
  expect(r.write).toHaveBeenCalledTimes(1);
  expect((await listBookmarks())[0].snapshot.media).toEqual([]);
});

it('saves the last reading without waiting further when the post is removed', async () => {
  const items = [pending()]; const r = reader(items, () => { items.length = 0; });
  await r.read(); await r.flush();
  expect(r.sleeps()).toBe(1);
  expect(r.write).toHaveBeenCalledTimes(1);
  expect((await listBookmarks())[0].snapshot.media).toEqual([]);
});

it('does not defer text-only, loaded videos or saved posts', async () => {
  const items = [ex('no-media'), ex('video-ready')]; const r = reader(items);
  await r.read(); await r.flush(); expect(r.write).toHaveBeenCalledTimes(1);
  const saved = reader([pending()]); (saved.c as any).saved = new Set(['101']);
  await saved.read(); await saved.flush(); expect(saved.write).not.toHaveBeenCalled();
  expect(saved.c.state!.skipped).toBe(1);
});

it('preserves DOM order when a pending post is waited for', async () => {
  const items = [pending(), ex('no-media')]; const r = reader(items);
  await r.read(); await r.flush(true);
  expect((await listBookmarks()).sort((a,b) => b.savedAt-a.savedAt).map(b=>b.tweetId)).toEqual(['101','105']);
  expect(r.c.state!.imported).toBe(2);
});

it('keeps scroll and wait schedules identical to loaded media, apart from the extra reading waits', async () => {
  async function run(delayed: boolean, cap: 0 | 100 = 0) {
    let round = 0, y = 0, now = 0;
    const sleeps: number[] = [], scrolls: number[] = [];
    const first = pending();
    const c = new AutoCollector({ ...defaultDeps(), now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, random: () => 0,
      visible: () => {
        const head = ++round === 1 && delayed ? first : { tweetId: '101', snapshot: ex('image-ready').snapshot };
        return [head, ...Array.from({ length: cap ? 99 : 0 }, (_, i) => ({ tweetId: String(1000+i), snapshot: ex('no-media').snapshot }))];
      },
      hasUnseen: () => false, scrollBy: px => { scrolls.push(px); y += px; }, scrollY: () => y, scrollToTop: () => {}, viewportHeight: () => 1000,
      pageOk: () => true, isHidden: () => false, accountId: () => 'me', isLoading: () => false, hasLimit: () => false,
      savedIds: async () => new Set(), addCollected: async () => 1, saveRun: async () => {}, clearRun: async () => {},
    });
    await c.start({ consent: true, accountId: 'me', speed: 'slow', cap });
    for (let i=0; i<500 && c.state?.status === 'running'; i++) await Promise.resolve();
    expect(c.state!.status).toBe(cap ? 'paused' : 'done'); return { sleeps, scrolls };
  }
  // 読み込み中のポストがあるときだけ、読み直しの待ち (SETTLE_POLL_MS) が増える。スクロールの量と、ほかの待ちは同じ
  const withoutSettle = async (delayed: boolean, cap?: 0 | 100) => {
    const r = await run(delayed, cap);
    return { ...r, sleeps: r.sleeps.filter(ms => ms !== SETTLE_POLL_MS) };
  };
  expect(await withoutSettle(true)).toEqual(await withoutSettle(false));
  expect(await withoutSettle(true, 100)).toEqual(await withoutSettle(false, 100));
  expect((await run(true)).sleeps.filter(ms => ms === SETTLE_POLL_MS)).toHaveLength(1);
  expect((await run(false)).sleeps.filter(ms => ms === SETTLE_POLL_MS)).toHaveLength(0);
  expect(SPEED_RANGES).toEqual({ slow: [2000,4000], normal: [1000,2500] });
  expect(WAIT_FLOORS).toEqual({ slow:800, normal:400 }); expect(WAIT_STEP_MS).toBe(100); expect(SCROLL_RATIO).toBe(.8);
});
