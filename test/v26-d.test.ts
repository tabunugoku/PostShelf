import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue, RETRY_MS, defaultDeps, type FullTextDeps } from '../src/background/fulltext';
import { getFullTextRun, recordFullTextTry } from '../src/shared/settings';
import { getBookmark, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const snap = (id: number) => ({ text: `短い ${id}`, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${id}`, truncated: true });
function fake() {
  const w = { t: 1_000_000, opened: [] as string[], sleeps: [] as number[] };
  let next = 1;
  const d: FullTextDeps = {
    ...defaultDeps(),
    now: () => w.t,
    sleep: async (ms) => void (w.sleeps.push(ms), (w.t += ms), await Promise.resolve()),
    random: () => 0.5,
    openTab: async (url) => (w.opened.push(url), next++),
    closeTab: async () => {},
    ask: async (_t, id) => ({ ok: true, text: `全文 ${id}` }),
    collectActive: async () => false,
    setTab: async () => {},
  };
  return { w, d };
}
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ accountId: 'me', tweetId: String(i + 1) }));

beforeEach(async () => {
  installChromeMock();
  setAccountScope('me');
  for (let i = 1; i <= 3; i++) await setBookmarkFolders(String(i), [], snap(i));
  for (let i = 1; i <= 3; i++) await recordFullTextTry(`me:${i}`, Date.now(), RETRY_MS); // 直前に試した
});

describe('v26-D: 「いま取得する」 ignores the 1-hour retry interval', () => {
  it('manual: posts tried within the hour are fetched', async () => {
    const { d, w } = fake();
    await new FullTextQueue(d).enqueue(items(3), 'manual');
    expect(w.opened).toHaveLength(3);
    expect((await getBookmark('1'))!.snapshot.text).toBe('全文 1');
    const run = (await getFullTextRun())!;
    expect(run).toMatchObject({ done: 3, skipped: 0, failed: 0 });
    // 間隔 (4〜8 秒) は変えない
    expect(w.sleeps.filter((ms) => ms >= 4000 && ms <= 8000)).toHaveLength(2);
  });

  it('auto: posts tried within the hour are skipped, and not counted in done', async () => {
    const { d, w } = fake();
    await new FullTextQueue(d).enqueue(items(3), 'auto');
    expect(w.opened).toHaveLength(0);
    expect(await getFullTextRun()).toMatchObject({ total: 3, done: 0, skipped: 3, failed: 0, running: false });
    expect((await getBookmark('1'))!.snapshot.truncated).toBe(true);
  });

  it('manual still stops after 3 failures in a row', async () => {
    const { d } = fake();
    d.ask = async () => ({ ok: false, reason: 'wait' });
    let t = 1_000_000;
    d.now = () => (t += 5000);
    for (let i = 4; i <= 6; i++) await setBookmarkFolders(String(i), [], snap(i));
    await new FullTextQueue(d).enqueue(items(6), 'manual');
    expect(await getFullTextRun()).toMatchObject({ failed: 3, stopReason: 'failures' });
  });
});
