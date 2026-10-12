import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectorWorld, loadFixture } from './v50-helpers';
import { installChromeMock } from './chrome-mock';
import { setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it('表のタブの固まりを予算に含めず刻みの合計まで待つ', async () => {
  const world = collectorWorld(() => { world.clock.now += 9700; });
  (world.collector as any).d.isHidden = () => false;
  await world.read();
  await (world.collector as any).finish();
  expect(world.clock.sleeps).toEqual(Array(27).fill(300));
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0])
    .toMatchObject({ waitedMs: 8100, elapsedMs: 270000, reason: 'timedOut' });
});

it('裏のタブの遅れは各周の実時間で数えて 8 秒で打ち切る', async () => {
  const world = collectorWorld(() => { world.clock.now += 700; });
  (world.collector as any).d.isHidden = () => true;
  await world.read();
  await (world.collector as any).finish();
  expect(world.clock.sleeps).toEqual(Array(8).fill(300));
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0])
    .toMatchObject({ waitedMs: 2400, elapsedMs: 8000, reason: 'timedOut' });
});

it('表と裏の切り替えでは各周の予算を足す', async () => {
  const world = collectorWorld(() => { world.clock.now += 9700; });
  (world.collector as any).d.isHidden = () => world.clock.sleeps.length >= 3;
  await world.read();
  expect(world.clock.sleeps).toEqual([300, 300, 300]);
});
