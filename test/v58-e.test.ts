import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SETTLE_MAX_MS } from '../src/content/autocollect';
import { getBookmark, setAccountScope } from '../src/shared/storage';
import { collectorWorld, loadFixture } from './v50-helpers';
import { installChromeMock } from './chrome-mock';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('タイマーが 10 倍遅れても実時間の予算を過ぎた確認で保存へ進む', async () => {
  const world = collectorWorld(() => { world.clock.now += 2700; });
  await world.read();
  await (world.collector as any).finish();
  expect(world.clock.sleeps).toEqual([300, 300, 300]);
  expect(world.clock.now).toBe(9000);
  expect((await getBookmark('1202'))!.snapshot.avatar).toBeUndefined();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0])
    .toMatchObject({ reason: 'timedOut', waitedMs: 900, elapsedMs: 9000 });
});

it('最初のタイマーが予算を超えて遅れても追加の sleep をしない', async () => {
  const world = collectorWorld(() => { world.clock.now += SETTLE_MAX_MS; });
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([300]);
  expect(await getBookmark('1202')).toBeDefined();
});

it('再解析にかかった時間も予算に含め追加の sleep をしない', async () => {
  const world = collectorWorld();
  const deps = (world.collector as any).d;
  const visible = deps.visible;
  let reads = 0;
  deps.visible = (...args: Parameters<typeof visible>) => {
    if (reads++ > 0) world.clock.now += SETTLE_MAX_MS;
    return visible(...args);
  };
  await world.read();
  expect(world.clock.sleeps).toEqual([300]);
});

it.each([0, 0.5, 1])('通常速度では乱数 %s の従来の刻みで終了する', async (random) => {
  const world = collectorWorld();
  (world.collector as any).d.random = () => random;
  await world.read();
  const step = 300 + Math.round(random * 200);
  expect(world.clock.sleeps).toEqual(Array(Math.ceil(SETTLE_MAX_MS / step)).fill(step));
});

it('pending が無ければ時刻の取得や待ちを追加しない', async () => {
  document.getElementById('main-post')!.remove();
  const world = collectorWorld();
  const now = vi.spyOn((world.collector as any).d, 'now');
  await world.read();
  expect(now).not.toHaveBeenCalled();
  expect(world.clock.sleeps).toEqual([]);
});
