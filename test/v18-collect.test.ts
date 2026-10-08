import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollector, LIMIT_RESUME_MS, MAX_RUN_MS, handleCollectCommand, type CollectDeps } from '../src/content/autocollect';
import { addCollected, getSavedIds, listBookmarks, setAccountScope } from '../src/shared/storage';
import { sendCollectCommand, peekCollectCommand, type CollectRun } from '../src/shared/settings';
import { UNKNOWN_ACCOUNT_ID } from '../src/shared/models';
import type { Extracted } from '../src/content/snapshot';

const post = (n: number): Extracted => ({
  tweetId: `p${n}`,
  snapshot: { text: `post ${n}`, author: 'A', handle: '@a', media: [], createdAt: new Date(Date.UTC(2026, 9, 30) - n * 86400e3).toISOString(), url: `https://x.com/a/status/${n}` },
});
const tick = () => new Promise((r) => setTimeout(r, 0));

/** autocollect.test.ts の world と同じ作りの、小さな模擬 (p1 が先頭。6 件ずつ見えて、スクロールで 5 件進む) */
function world(total: number, store: { run: CollectRun | null } = { run: null }) {
  const w = {
    start: 0, sleeps: [] as number[], releaseLong: undefined as undefined | (() => void), savedCalls: 0, changed: undefined as undefined | (() => void),
    failAdds: 0, clock: undefined as undefined | (() => number),
  };
  const deps: CollectDeps & { hidden: boolean; limit: boolean } = {
    now: () => w.clock?.() ?? Date.now(),
    sleep: async (ms) => {
      w.sleeps.push(ms);
      if (ms === LIMIT_RESUME_MS) await new Promise<void>((r) => (w.releaseLong = r));
      else await tick();
    },
    random: () => 0,
    scrollBy: () => void (w.start = Math.min(w.start + 5, total)),
    scrollToTop: () => void (w.start = 0),
    scrollY: () => w.start * 100,
    viewportHeight: () => 1000,
    visible: () => Array.from({ length: Math.max(0, Math.min(6, total - w.start)) }, (_, i) => post(w.start + i + 1)),
    isLoading: () => false,
    hasLimit: () => deps.limit,
    pageOk: () => true,
    isHidden: () => deps.hidden,
    accountId: () => 'me',
    savedIds: async () => (w.savedCalls++, getSavedIds()),
    onDataChanged: (cb) => ((w.changed = cb), () => {}),
    loadRun: async () => store.run,
    addCollected: async (seq, startedAt) => {
      if (w.failAdds > 0) {
        w.failAdds--;
        throw new Error('write failed');
      }
      return addCollected(seq, startedAt);
    },
    saveRun: async (run) => void (store.run = structuredClone(run)),
    clearRun: async () => void (store.run = null),
    hidden: false,
    limit: false,
  };
  return { w, deps, store };
}
const consent = { consent: true as const, speed: 'slow' as const, cap: 0 as const, accountId: 'me' };
async function until(c: AutoCollector, pred: (s: NonNullable<AutoCollector['state']>) => boolean) {
  for (let i = 0; i < 400 && !(c.state && pred(c.state)); i++) await tick();
  expect(c.state && pred(c.state)).toBe(true);
}

beforeEach(() => {
  installChromeMock();
  setAccountScope(UNKNOWN_ACCOUNT_ID);
});

describe('v18-A-4: saved IDs are read once per import', () => {
  it('reads them once at the start, and again only after a change made somewhere else', async () => {
    const { w, deps } = world(60);
    const c = new AutoCollector(deps);
    let n = 0;
    deps.visible = ((orig) => () => {
      if (++n === 6) w.changed?.(); // 他の場所での変更
      return orig();
    })(deps.visible);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect(c.state!.imported).toBe(60);
    expect(w.savedCalls).toBe(2); // 開始のとき 1 回 + 他の場所の変更のあと 1 回。自分の保存では読み直さない
  });
  it('without any outside change it is exactly once, even though it saves several times', async () => {
    const { w, deps } = world(60);
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect((await listBookmarks()).length).toBe(60);
    expect(w.savedCalls).toBe(1);
  });
});

describe('v18-B-1: a scheduled resume that could not run clears 「◯時に再開します」', () => {
  it('stays stopped without resumeAt, and 再開 still works', async () => {
    const { w, deps } = world(60);
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'running');
    deps.limit = true;
    await until(c, (s) => s.status === 'limit');
    deps.limit = false;
    const later = c.resumeLater();
    await until(c, (s) => !!s.resumeAt);
    deps.hidden = true; // 予約の時刻に、タブが見えていない
    w.releaseLong!();
    await later;
    expect(c.state!.status).toBe('limit');
    expect(c.state!.resumeAt).toBeUndefined();
    deps.hidden = false;
    expect(await c.resume()).toBe(true);
    await c.stop();
  });
});

describe('v18-B-2: a failed save is retried, and counted as failed only when the last save also fails', () => {
  it('one failure in the middle: nothing is lost or counted as failed', async () => {
    const { w, deps } = world(50);
    w.failAdds = 1;
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect(c.state).toMatchObject({ imported: 50, failed: 0 });
    expect((await listBookmarks()).length).toBe(50);
  });
  it('the save at the end fails too: that part is counted as failed and taken off the imported count', async () => {
    const { w, deps } = world(10);
    w.failAdds = 5;
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'done');
    expect(c.state).toMatchObject({ imported: 0, failed: 10 });
  });
});

describe('v18-B-3: only one tab runs an import', () => {
  it('two tabs receiving the same start command: only one starts', async () => {
    const store = { run: null as CollectRun | null };
    const a = world(40, store);
    const b = world(40, store);
    const ca = new AutoCollector(a.deps);
    const cb = new AutoCollector(b.deps);
    await sendCollectCommand({ type: 'start', consent: true, speed: 'slow', cap: 0, accountId: 'me' });
    await Promise.all([handleCollectCommand(ca, a.deps), handleCollectCommand(cb, b.deps)]);
    const running = [ca, cb].filter((c) => c.state);
    expect(running).toHaveLength(1);
    await until(running[0], (s) => s.status === 'done');
    expect(store.run!.owner).toBe(running[0].owner);
  });

  it('adopt is done only by a visible tab and rewrites the owner; the former owner clears its state', async () => {
    const store = { run: null as CollectRun | null };
    const a = world(60, store);
    const b = world(60, store);
    const ca = new AutoCollector(a.deps);
    const cb = new AutoCollector(b.deps);
    await ca.start(consent);
    await until(ca, (s) => s.status === 'running');
    const run = (await a.deps.loadRun!())!;
    b.deps.hidden = true;
    cb.adopt(run);
    expect(cb.state).toBeNull(); // 見えていないタブは引き継がない
    b.deps.hidden = false;
    cb.adopt(run);
    expect(cb.state).toMatchObject({ status: 'paused', reason: 'reload' });
    expect(store.run!.owner).toBe(cb.owner);
    ca.onRunChanged(store.run);
    expect(ca.state).toBeNull(); // 取り込みをやめて、パネルも閉じる
    const n = a.w.start;
    for (let i = 0; i < 10; i++) await tick();
    expect(a.w.start).toBe(n); // もうスクロールしない
  });

  it('pause / resume / stop commands are run only by the tab that owns the run', async () => {
    const store = { run: null as CollectRun | null };
    const a = world(60, store);
    const b = world(60, store);
    const ca = new AutoCollector(a.deps);
    const cb = new AutoCollector(b.deps);
    await ca.start(consent);
    await until(ca, (s) => s.status === 'running');
    cb.state = { ...ca.state!, status: 'paused', owner: undefined, reason: 'reload' }; // 古い状態を持っているだけのタブ
    await sendCollectCommand({ type: 'stop' });
    await handleCollectCommand(cb, b.deps);
    expect(cb.state).toBeNull(); // 自分のものではないと分かって、状態を消す
    expect(await peekCollectCommand()).not.toBeNull(); // 命令は、持ち主のタブのために残る
    await handleCollectCommand(ca, a.deps);
    expect(ca.state!.status).toBe('stopped');
  });
});

describe('v18-B-4: an upper time limit even for 「止めない」', () => {
  it('pauses with reason "time" after MAX_RUN_MS; with a count cap the time limit does not apply', async () => {
    const { w, deps } = world(2000);
    const t0 = Date.now();
    w.clock = () => t0 + w.sleeps.length * (MAX_RUN_MS / 4);
    const c = new AutoCollector(deps);
    await c.start(consent);
    await until(c, (s) => s.status === 'paused');
    expect(c.state!.reason).toBe('time');
    expect(c.state!.imported).toBeGreaterThan(0);

    const capped = world(2000);
    capped.w.clock = () => t0 + capped.w.sleeps.length * (MAX_RUN_MS / 4);
    const c2 = new AutoCollector(capped.deps);
    await c2.start({ ...consent, cap: 300 });
    await until(c2, (s) => s.status === 'paused');
    expect(c2.state!.reason).toBe('cap');
  });
});

describe('v18-B-4: the paused panel explains the time limit', () => {
  it('viewOf shows the reason for "time"', async () => {
    const { viewOf } = await import('../src/content/autocollectPanel');
    const v = viewOf({ status: 'paused', reason: 'time', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: 0, updatedAt: 1 });
    expect(v.sub).toContain('2 時間');
  });
});
