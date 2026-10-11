import { beforeEach, expect, it, vi } from 'vitest';
import { SCROLL_RATIO, SETTLE_MAX_MS, WAIT_STEP_MS } from '../src/content/autocollect';
import { getBookmark, setAccountScope } from '../src/shared/storage';
import { collectorWorld, loadFixture, markLoaded } from './v50-helpers';
import { installChromeMock } from './chrome-mock';

const avatar = 'https://pbs.twimg.com/profile_images/sample-late-v51.jpg';
const media = 'https://pbs.twimg.com/media/sample-late-v51.jpg';
const ready = () => {
  for (const [target, template] of [['main-avatar', 'late-avatar'], ['main-post', 'late-photo']]) {
    const source = document.getElementById(template) as HTMLTemplateElement;
    document.getElementById(target)!.append(source.content.cloneNode(true));
  }
  for (const img of document.querySelectorAll('img')) markLoaded(img);
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v51-timeout-reread.html');
});

it('時間切れで保存したポストを次の画面で補い保存順と本文を保つ', async () => {
  const world = collectorWorld();
  await world.read();
  await world.flush();
  const before = (await getBookmark('801'))!;
  expect(before.snapshot.avatar).toBeUndefined();
  expect(world.clock.now).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
  const waits = [...world.clock.sleeps];
  ready();
  expect(await world.read()).toBe(0);
  expect(await getBookmark('801')).toEqual({ ...before, snapshot: { ...before.snapshot, avatar, media: [media] } });
  expect(world.collector.state!.imported).toBe(1);
  expect(world.collector.state!.skipped).toBe(0);
  expect(world.clock.sleeps).toEqual(waits);
});

it('次の画面でも pending なら補わずそれ以降は読み直さない', async () => {
  const world = collectorWorld();
  await world.read();
  await world.flush();
  const waits = [...world.clock.sleeps];
  await world.read();
  expect((await getBookmark('801'))!.snapshot.avatar).toBeUndefined();
  ready();
  await world.read();
  await world.read();
  expect((await getBookmark('801'))!.snapshot.avatar).toBeUndefined();
  expect((await getBookmark('801'))!.snapshot.media).toEqual([]);
  expect(world.clock.sleeps).toEqual(waits);
});

it('通常のまとめ保存前に読み直しても欠けだけを補える', async () => {
  const world = collectorWorld();
  await world.read();
  expect(await getBookmark('801')).toBeUndefined();
  ready();
  await world.read();
  await world.flush();
  expect((await getBookmark('801'))!.snapshot).toMatchObject({ avatar, media: [media], text: '' });
});

it('最初から pending でないポストを読み直しの対象にしない', async () => {
  ready();
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect((world.collector as any).timedOut.size).toBe(0);
  expect(world.clock.sleeps).toEqual([]);
});

it('8 秒になる前に DOM から消えたポストを時間切れの対象にしない', async () => {
  const world = collectorWorld(() => document.getElementById('main-post')?.remove());
  await world.read();
  await world.flush();
  expect(world.clock.now).toBeLessThan(SETTLE_MAX_MS);
  expect((world.collector as any).timedOut.size).toBe(0);
});

it('停止で待ちを打ち切ったポストを時間切れの対象にしない', async () => {
  const world = collectorWorld(() => (world.collector as any).token++);
  await world.read();
  await (world.collector as any).flush(true);
  expect((world.collector as any).timedOut.size).toBe(0);
});

it('補完の保存が失敗しても同じポストを再び読み直さない', async () => {
  const world = collectorWorld();
  const fillMissing = vi.fn(async () => { throw new Error('架空の保存失敗'); });
  (world.collector as any).d.fillMissing = fillMissing;
  await world.read();
  await world.flush();
  ready();
  await world.read();
  await world.read();
  expect(fillMissing).toHaveBeenCalledTimes(1);
  expect(fillMissing.mock.calls[0]).toEqual([
    [expect.objectContaining({ tweetId: '801' })], 'me',
  ]);
  expect((await getBookmark('801'))!.snapshot.avatar).toBeUndefined();
});

it('一時停止と再開で時間切れの記録を引き継ぎ一度だけ補う', async () => {
  const world = collectorWorld();
  Object.assign((world.collector as any).d, {
    accountId: () => 'me', pageOk: () => true, isHidden: () => false,
  });
  await world.read();
  await world.collector.pause();
  const fillMissing = vi.spyOn((world.collector as any).d, 'fillMissing');
  vi.spyOn(world.collector as any, 'loop').mockResolvedValue(undefined);
  expect(await world.collector.resume()).toBe(true);
  ready();
  await (world.collector as any).readVisible((world.collector as any).token);
  expect((await getBookmark('801'))!.snapshot.avatar).toBe(avatar);
  await (world.collector as any).readVisible((world.collector as any).token);
  expect(fillMissing).toHaveBeenCalledTimes(1);
});

it('時間切れ後の読み直しがスクロールの量と間隔と終端判定を変えない', async () => {
  const run = async (pending: boolean) => {
    loadFixture('v51-timeout-reread.html');
    installChromeMock();
    setAccountScope('me');
    if (!pending) ready();
    const world = collectorWorld();
    const scrollBy = vi.fn();
    Object.assign((world.collector as any).d, {
      scrollBy, scrollY: () => 0, viewportHeight: () => 1000,
      pageOk: () => true, isHidden: () => false, accountId: () => 'me',
      isLoading: () => false, hasLimit: () => false, hasUnseen: () => false,
    });
    await (world.collector as any).loop(0);
    expect(world.collector.state!.status).toBe('done');
    return { scrolls: scrollBy.mock.calls, waits: world.clock.sleeps.filter((ms) => ms === WAIT_STEP_MS) };
  };
  const normal = await run(false);
  const timeout = await run(true);
  expect(timeout).toEqual(normal);
  expect(timeout.scrolls).toEqual(Array.from({ length: 3 }, () => [1000 * SCROLL_RATIO]));
});
