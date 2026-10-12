import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectorWorld, loadFixture } from './v50-helpers';
import { installChromeMock } from './chrome-mock';
import { getBookmark, setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it.each(['pause', 'stop', 'finish'])('%s で pending が空でも ID の列を末尾の基準へ整理する', async (method) => {
  const world = collectorWorld();
  const collector = world.collector as any;
  const ids = ['1201', '1203'];
  collector.seq = ids.map((tweetId) => ({ tweetId }));
  collector.positions = new Map(ids.map((id, index) => [id, index]));
  const save = vi.spyOn(collector.d, 'addCollected');
  await collector[method]();
  expect(collector.seq).toEqual([{ tweetId: '1203' }]);
  expect(collector.positions.size).toBe(0);
  expect(save).not.toHaveBeenCalled();
  expect(collector.state).toMatchObject({ imported: 0, failed: 0 });
});

it.each(['pause', 'stop', 'finish'])('%s で vanishedRetry だけでも元の位置へ戻して保存する', async (method) => {
  const world = collectorWorld();
  const collector = world.collector as any;
  const item = collector.d.visible()[1];
  collector.positions.set(item.tweetId, 1);
  collector.vanishedRetry.set(item.tweetId, item);
  await collector[method]();
  expect((await getBookmark(item.tweetId))!.snapshot).toEqual(item.snapshot);
  expect(collector.seq).toEqual([{ tweetId: item.tweetId }]);
  expect(collector.positions.size).toBe(0);
  expect(collector.vanishedRetry.size).toBe(0);
  expect(collector.state).toMatchObject({ imported: 1, failed: 0 });
});

it('pending が空でも未送信の基準を整理し消失待ちの位置は保持する', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  const item = collector.d.visible()[1];
  collector.seq = [{ tweetId: '1201' }, { tweetId: '1203' }];
  collector.positions = new Map([['old', -1], ['1201', 0], ['1202', 1], ['1203', 2]]);
  collector.vanishedRetry.set(item.tweetId, item);
  await world.flush();
  expect(collector.seq).toEqual([{ tweetId: '1201' }, { tweetId: '1203' }]);
  expect([...collector.positions.keys()]).toEqual(['1201', '1202', '1203']);
  expect(collector.vanishedRetry.has('1202')).toBe(true);
});
