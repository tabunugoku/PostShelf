import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue, MAX_FAILURES, defaultDeps, type AskResult, type FullTextDeps } from '../src/background/fulltext';
import { getFullTextRun } from '../src/shared/settings';
import { getBookmark, refreshFullText, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const snap = (id: number) => ({ text: `短い ${id}`, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${id}`, truncated: true });
function fake(answer: (id: string) => AskResult | Promise<AskResult> = (id) => ({ ok: true, text: `全文 ${id}` })) {
  const w = { t: 1_000_000, opened: [] as string[], closed: [] as number[], open: 0 };
  let next = 1;
  const d: FullTextDeps = {
    ...defaultDeps(),
    now: () => w.t,
    sleep: async (ms) => void ((w.t += ms), await Promise.resolve()),
    random: () => 0.5,
    openTab: async (url) => (w.opened.push(url), w.open++, next++),
    closeTab: async (id) => (w.closed.push(id), void w.open--),
    ask: async (_t, id) => answer(id),
    collectActive: async () => false,
    setTab: async () => {},
  };
  return { w, d };
}
const saved = async (n: number) => {
  for (let i = 1; i <= n; i++) await setBookmarkFolders(String(i), [], snap(i));
};
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ accountId: 'me', tweetId: String(i + 1) }));

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

describe('v26-C: counting the results of full-text fetches', () => {
  it('a refresh that returns false because the tab already updated the post is not a failure (3+ in a row do not stop the queue)', async () => {
    await saved(MAX_FAILURES + 2);
    // 裏のタブ側の更新が先に入る (キュー側の refresh は false になる)
    const { d } = fake(async (id) => {
      await refreshFullText('me', id, { text: `タブ側 ${id}` });
      return { ok: true, text: `全文 ${id}` };
    });
    await new FullTextQueue(d).enqueue(items(MAX_FAILURES + 2), 'manual');
    const run = (await getFullTextRun())!;
    expect(run.failed).toBe(0);
    expect(run.stopReason).toBeUndefined();
    expect(run.done).toBe(MAX_FAILURES + 2);
    expect((await getBookmark('1'))!.snapshot.text).toBe('タブ側 1');
  });

  it('a post removed while fetching is skipped, not a failure', async () => {
    await saved(4);
    const { d } = fake(async (id) => {
      const { removeBookmark } = await import('../src/shared/storage');
      await removeBookmark(id);
      return { ok: true, text: 'x' };
    });
    await new FullTextQueue(d).enqueue(items(4), 'manual');
    expect((await getFullTextRun())!.failed).toBe(0);
  });

  it('a stop in the middle does not count as a failure', async () => {
    await saved(3);
    let q!: FullTextQueue;
    const { d } = fake(async () => {
      void q.stop('user');
      return { ok: false, reason: 'wait' };
    });
    q = new FullTextQueue(d);
    await q.enqueue(items(3), 'manual');
    await q.stop('user');
    const run = (await getFullTextRun())!;
    expect(run.failed).toBe(0);
    expect(run.running).toBe(false);
    expect(run.stopReason).toBe('user');
  });

  it('a real failure still counts, and 3 in a row still stop the queue', async () => {
    await saved(5);
    const { d } = fake(() => ({ ok: false, reason: 'wait' }));
    await new FullTextQueue(d).enqueue(items(5), 'manual');
    const run = (await getFullTextRun())!;
    expect(run.failed).toBe(MAX_FAILURES);
    expect(run.stopReason).toBe('failures');
  });

  it('an enqueue right after a stop is accepted, not dropped', async () => {
    await saved(3);
    let gate!: () => void;
    const hold = new Promise<void>((r) => (gate = r));
    let first = true;
    const { d, w } = fake(async (id) => {
      if (first) {
        first = false;
        await hold;
        return { ok: false, reason: 'wait' };
      }
      return { ok: true, text: `全文 ${id}` };
    });
    const q = new FullTextQueue(d);
    const running = q.enqueue(items(1), 'save');
    await new Promise((r) => setTimeout(r, 5));
    const stopping = q.stop('user');
    const next = q.enqueue([{ accountId: 'me', tweetId: '2' }], 'save');
    gate();
    await Promise.all([running, stopping, next]);
    expect((await getBookmark('2'))!.snapshot.text).toBe('全文 2');
    expect(w.open).toBe(0);
  });
});
