import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { extractTweet, type Extracted } from '../src/content/snapshot';
import { AutoCollector, defaultDeps, SPEED_RANGES, WAIT_FLOORS, WAIT_STEP_MS, SCROLL_RATIO } from '../src/content/autocollect';
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

function reader(items: Extracted[]) {
  const write = vi.fn(async (seq, at, account) => addCollected(seq, at, account));
  const c = new AutoCollector({ ...defaultDeps(), visible: () => items, savedIds: async () => new Set(), addCollected: write, saveRun: async () => {} });
  c.state = { status: 'running', accountId: 'me', startedAt: 1000, imported: 0, skipped: 0, failed: 0, speed: 'slow', cap: 0, updatedAt: 1000 };
  const read = () => (c as any).readVisible(0) as Promise<number>;
  const flush = (final = false) => (c as any).flush(final) as Promise<void>;
  return { c, read, flush, write };
}

it.each(['image-pending', 'video-pending'])('defers %s once, then saves the newly read media', async id => {
  const items: Extracted[] = [{ ...ex(id), mediaPending: true as const }];
  const r = reader(items);
  await r.read(); await r.flush();
  expect(r.write).not.toHaveBeenCalled(); expect(await listBookmarks()).toEqual([]);
  const incoming = id === 'image-pending' ? ex('image-ready').snapshot : ex('video-ready').snapshot;
  items[0] = { tweetId: items[0].tweetId, snapshot: incoming };
  await r.read(); await r.flush();
  expect(r.write).toHaveBeenCalledTimes(1);
  expect((await listBookmarks())[0].snapshot).toEqual(incoming);
  expect((await listBookmarks())[0].snapshot).not.toHaveProperty('mediaPending');
  await r.read(); await r.flush(); expect(r.write).toHaveBeenCalledTimes(1);
});

it.each([false, true])('saves the first reading if still pending or removed (removed=%s)', async removed => {
  const items = [pending()]; const r = reader(items);
  await r.read(); await r.flush(); expect(r.write).not.toHaveBeenCalled();
  if (removed) items.length = 0;
  await r.read(); await r.flush();
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

it('preserves DOM order and the last pending post on a stop without an extra reading', async () => {
  const items = [pending(), ex('no-media')]; const r = reader(items);
  await r.read(); await r.flush(); expect(r.write).not.toHaveBeenCalled();
  await r.flush(true);
  expect((await listBookmarks()).sort((a,b) => b.savedAt-a.savedAt).map(b=>b.tweetId)).toEqual(['101','105']);
  expect(r.c.state!.imported).toBe(2);
});

it('keeps scroll and wait schedules identical to loaded media', async () => {
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
  expect(await run(true)).toEqual(await run(false));
  expect(await run(true, 100)).toEqual(await run(false, 100));
  expect(SPEED_RANGES).toEqual({ slow: [2000,4000], normal: [1000,2500] });
  expect(WAIT_FLOORS).toEqual({ slow:800, normal:400 }); expect(WAIT_STEP_MS).toBe(100); expect(SCROLL_RATIO).toBe(.8);
});
