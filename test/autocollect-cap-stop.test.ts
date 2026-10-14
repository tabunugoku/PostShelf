// 版: v49-c
import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollector, defaultDeps } from '../src/content/autocollect';
import { viewOf } from '../src/content/autocollectPanel';
import type { Extracted } from '../src/content/snapshot';
import { addCollected, listBookmarks, setAccountScope } from '../src/shared/storage';

const post = (n: number): Extracted => ({
  tweetId: `p${n}`,
  snapshot: { text: `架空の本文 ${n}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${n}` },
});

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

/** 6 件ずつ画面に出て、スクロールで 5 件進む一覧 (全 300 件) */
function collector() {
  let start = 0;
  return new AutoCollector({
    ...defaultDeps(),
    now: () => 0,
    sleep: async () => {},
    random: () => 0,
    visible: () => Array.from({ length: Math.max(0, Math.min(6, 300 - start)) }, (_, i) => post(start + i + 1)),
    hasUnseen: () => false,
    scrollBy: () => { start += 5; },
    scrollY: () => start * 100,
    scrollToTop: () => { start = 0; },
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
}
const until = async (c: AutoCollector, done: (status: string) => boolean) => {
  for (let i = 0; i < 2000 && !done(c.state!.status); i++) await new Promise((r) => setTimeout(r, 0));
};

it('stops with the cap reason at an arbitrary cap such as 7, and goes on for another 7 on resume', async () => {
  const c = collector();
  await c.start({ consent: true, accountId: 'me', speed: 'slow', cap: 7 });
  await until(c, (s) => s === 'paused');
  expect(c.state!.status).toBe('paused');
  expect(c.state!.reason).toBe('cap');
  const first = c.state!.imported;
  expect(first).toBeGreaterThanOrEqual(7);
  expect(first).toBeLessThan(13); // 1 画面 (6 件) 分までは、上限を超えて読むことがある
  expect((await listBookmarks()).length).toBe(first);
  expect(await c.resume()).toBe(true);
  await until(c, (s) => s === 'paused');
  expect(c.state!.imported).toBeGreaterThanOrEqual(first + 7);
});

it.each([7, 100000])('shows the cap number in the panel text for %i', (cap) => {
  const view = viewOf({
    status: 'paused', accountId: 'me', startedAt: 1, imported: cap, skipped: 0, failed: 0, speed: 'slow', cap, reason: 'cap', updatedAt: 1,
  });
  expect(view.sub).toContain(String(cap));
});
