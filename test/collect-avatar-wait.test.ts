// 版: v48-b
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollector, SETTLE_MAX_MS, SETTLE_POLL_MS, defaultDeps } from '../src/content/autocollect';
import type { Extracted } from '../src/content/snapshot';
import { addCollected, listBookmarks, setAccountScope } from '../src/shared/storage';

const avatar = 'https://pbs.twimg.com/profile_images/sample-v48.jpg';
const post = (id: string, loaded: boolean): Extracted => ({
  tweetId: id,
  snapshot: {
    text: `架空の本文 ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}`,
    ...(loaded ? { avatar } : {}),
  },
  ...(loaded ? {} : { avatarPending: true as const }),
});

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

/** 仮想の時計つきの取り込み。待ち (sleep) は時計を進めるだけで、実際には待たない */
function world(visibleAt: (now: number) => Extracted[], onSleep: (c: AutoCollector, now: number) => void = () => {}) {
  const clock = { now: 0, sleeps: [] as number[] };
  const write = vi.fn(async (seq, at, account) => addCollected(seq, at, account));
  const c: AutoCollector = new AutoCollector({
    ...defaultDeps(),
    now: () => clock.now,
    random: () => 0,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.now += ms;
      onSleep(c, clock.now);
    },
    visible: () => visibleAt(clock.now),
    savedIds: async () => new Set(),
    addCollected: write,
    saveRun: async () => {},
  });
  c.state = { status: 'running', accountId: 'me', startedAt: 1000, imported: 0, skipped: 0, failed: 0, speed: 'slow', cap: 0, updatedAt: 1000 };
  const read = () => (c as any).readVisible(0) as Promise<number>;
  const flush = (final = false) => (c as any).flush(final) as Promise<void>;
  const settleSleeps = () => clock.sleeps.filter((ms) => ms === SETTLE_POLL_MS).length;
  return { c, clock, read, flush, write, settleSleeps };
}

it('waits for an avatar that loads after one second, then saves it with the avatar', async () => {
  const w = world((now) => [post('1', now >= 1000)]);
  await w.read();
  await w.flush();
  expect(w.clock.now).toBeLessThan(SETTLE_MAX_MS);
  expect((await listBookmarks())[0].snapshot.avatar).toBe(avatar);
});

it('saves a post whose avatar never loads, after the wait budget', async () => {
  const w = world(() => [post('1', false)]);
  await w.read();
  await w.flush();
  expect(w.clock.now).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
  expect(w.clock.now).toBeLessThan(SETTLE_MAX_MS + SETTLE_POLL_MS);
  const saved = (await listBookmarks())[0].snapshot;
  expect(saved.text).toBe('架空の本文 1');
  expect(saved.avatar).toBeUndefined();
});

it('does not stall the whole run when posts keep pending', async () => {
  let y = 0;
  let now = 0;
  const c = new AutoCollector({
    ...defaultDeps(),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    random: () => 0,
    visible: () => [post('1', false), post('2', false)],
    hasUnseen: () => false,
    scrollBy: (px) => { y += px; },
    scrollY: () => y,
    scrollToTop: () => {},
    viewportHeight: () => 1000,
    pageOk: () => true,
    isHidden: () => false,
    accountId: () => 'me',
    isLoading: () => false,
    hasLimit: () => false,
    savedIds: async () => new Set(),
    addCollected: (seq, at, account) => addCollected(seq, at, account),
    saveRun: async () => {},
    clearRun: async () => {},
  });
  await c.start({ consent: true, accountId: 'me', speed: 'slow', cap: 0 });
  for (let i = 0; i < 2000 && c.state?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 0));
  expect(c.state!.status).toBe('done');
  expect((await listBookmarks()).map((b) => b.tweetId).sort()).toEqual(['1', '2']);
});

it('adds no waiting for posts that are not pending', async () => {
  const w = world(() => [post('1', true), post('2', true)]);
  await w.read();
  await w.flush();
  expect(w.clock.sleeps).toEqual([]);
  expect(w.write).toHaveBeenCalledTimes(1);
});

it('saves what has been read when paused during the wait', async () => {
  const w = world(
    () => [post('1', false)],
    (c, now) => { if (now === SETTLE_POLL_MS * 2) void c.pause('user'); },
  );
  await w.read();
  await new Promise((r) => setTimeout(r, 0));
  await w.flush(true);
  expect(w.settleSleeps()).toBe(2);
  expect(w.clock.now).toBeLessThan(SETTLE_MAX_MS);
  expect((await listBookmarks()).map((b) => b.tweetId)).toEqual(['1']);
});

it('待ち中の消失は次画面へ回して最後に読めた値を終了時まで保持する', async () => {
  const w = world((now) => (now >= 600 ? [] : [post('1', false)]));
  await w.read();
  await w.flush(true);
  expect(w.settleSleeps()).toBe(2);
  expect((await listBookmarks()).map((b) => b.tweetId)).toEqual(['1']);
});

it('saves what has been read when stopped during the wait', async () => {
  const w = world(
    () => [post('1', false)],
    (c, now) => { if (now === SETTLE_POLL_MS) void c.stop(); },
  );
  await w.read();
  await new Promise((r) => setTimeout(r, 0));
  expect(w.c.state!.status).toBe('stopped');
  expect((await listBookmarks()).map((b) => b.tweetId)).toEqual(['1']);
  expect(w.c.state!.failed).toBe(0);
});

it('saves a waiting post when the run finishes', async () => {
  const w = world(() => [post('1', false)]);
  w.c.state!.status = 'running';
  await w.read();
  await (w.c as any).finish();
  expect(w.c.state!.status).toBe('done');
  expect((await listBookmarks()).map((b) => b.tweetId)).toEqual(['1']);
});
