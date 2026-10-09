import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollector, type CollectDeps } from '../src/content/autocollect';
import { addCollected, getSavedIds, listBookmarks, setAccountScope } from '../src/shared/storage';
import type { Extracted } from '../src/content/snapshot';

const post = (n: number): Extracted => ({
  tweetId: `p${n}`,
  snapshot: { text: `post ${n}`, author: 'A', handle: '@a', media: [], createdAt: new Date(Date.UTC(2026, 9, 30) - n * 86400e3).toISOString(), url: `https://x.com/a/status/${n}` },
});
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => installChromeMock());

describe('v26-A: collected posts are saved to the account the import started with', () => {
  it('keeps them in the original account when the account is switched mid-import', async () => {
    let current = 'alice';
    let start = 0;
    let run = null as null | Parameters<CollectDeps['saveRun']>[0];
    const deps: CollectDeps = {
      hasUnseen: () => false,
      now: () => Date.now(),
      sleep: async () => void (await tick()),
      random: () => 0,
      scrollBy: () => void (start += 3),
      scrollToTop: () => void (start = 0),
      scrollY: () => start * 100,
      viewportHeight: () => 1000,
      visible: () => [1, 2, 3].map((i) => post(start + i)),
      isLoading: () => false,
      hasLimit: () => false,
      pageOk: () => true,
      isHidden: () => false,
      accountId: () => current,
      // 実際の保存層は、モジュールの scope (= 画面の現在のアカウント) を使う。切替で先に変わる
      savedIds: (id) => getSavedIds(id),
      loadRun: async () => run,
      addCollected: (seq, startedAt, id) => addCollected(seq, startedAt, id),
      saveRun: async (r) => void (run = structuredClone(r)),
      clearRun: async () => void (run = null),
    };
    setAccountScope('alice');
    const c = new AutoCollector(deps);
    await c.start({ consent: true, speed: 'slow', cap: 0, accountId: 'alice' });
    for (let i = 0; i < 200 && (c.state?.imported ?? 0) < 6; i++) await tick();
    expect(c.state!.imported).toBeGreaterThanOrEqual(6);
    // アカウントの切替: 先に保存層の scope が新しくなってから、通知が来る
    current = 'bob';
    setAccountScope('bob');
    await c.pause('account');
    expect(c.state!.status).toBe('paused');
    expect(c.state!.failed).toBe(0);
    setAccountScope('bob');
    expect(await listBookmarks()).toHaveLength(0);
    setAccountScope('alice');
    expect((await listBookmarks()).length).toBe(c.state!.imported);
  });

  it('addCollected(accountId) ignores the module scope', async () => {
    setAccountScope('bob');
    await addCollected([{ tweetId: 'x1', snapshot: post(1).snapshot }], Date.now(), 'alice');
    expect(await listBookmarks()).toHaveLength(0);
    setAccountScope('alice');
    expect((await listBookmarks()).map((b) => b.tweetId)).toEqual(['x1']);
  });
});
