// 版: v58-d
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listBookmarks, setAccountScope } from '../src/shared/storage';
import { collectorWorld, loadFixture } from './collector-helpers';
import { installChromeMock } from './chrome-mock';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  document.getElementById('main-post')!.remove();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each(['finish', 'stop', 'pause'])('%s の最終保存後は位置を空にする', async (method) => {
  const world = collectorWorld();
  await world.read();
  await (world.collector as any)[method]();
  expect((world.collector as any).positions.size).toBe(0);
  expect(await listBookmarks()).toHaveLength(2);
});

it('一時停止後に停止しても解放済みの位置を参照しない', async () => {
  const world = collectorWorld();
  await world.read();
  await world.collector.pause();
  const get = vi.spyOn((world.collector as any).positions, 'get');
  await world.collector.stop();
  expect(get).not.toHaveBeenCalled();
  expect((world.collector as any).positions.size).toBe(0);
});

it('二分探索は先頭・中間・末尾・同じ位置で従来の挿入位置を保つ', () => {
  const collector = collectorWorld().collector as any;
  const ids = ['1201', '1202', '1203', '1204', '1205'];
  collector.positions = new Map(ids.map((id, index) => [id, index]));
  collector.seq = [{ tweetId: '1202' }, { tweetId: '1204' }];
  const reference = [...collector.seq];
  for (const id of ['1201', '1205', '1203', '1203']) {
    const item = { tweetId: id };
    const at = reference.findIndex((entry) => collector.positions.get(entry.tweetId) > collector.positions.get(id));
    reference.splice(at < 0 ? reference.length : at, 0, item);
    collector.insertSeq(item);
    expect(collector.seq).toEqual(reference);
  }
});

it('長い seq の末尾への挿入も位置の比較を対数回に抑える', () => {
  const collector = collectorWorld().collector as any;
  const ids = Array.from({ length: 4097 }, (_, index) => `${10000 + index}`);
  collector.positions = new Map(ids.map((id, index) => [id, index]));
  collector.seq = ids.slice(0, -1).map((id) => ({ tweetId: id }));
  const get = vi.spyOn(collector.positions, 'get');
  collector.insertSeq({ tweetId: ids[4096] });
  expect(collector.seq[4096].tweetId).toBe(ids[4096]);
  expect(get.mock.calls.length).toBeLessThanOrEqual(14);
});

it('保存した位置を捨てた後も新しい位置と savedAt の順を保つ', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  const first = collector.d.visible()[0];
  const initial = Array.from({ length: 40 }, (_, index) => ({ ...first, tweetId: `${2000 + index}` }));
  collector.d.visible = () => initial;
  await world.read();
  await world.flush();
  expect([...collector.positions.keys()]).toEqual(['2039']);
  collector.d.visible = () => [initial[39], { ...first, tweetId: '2040' }];
  await world.read();
  await world.flush();
  const bookmarks = (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt);
  expect(bookmarks.map((b) => b.tweetId)).toEqual([...initial.map((it) => it.tweetId), '2040']);
  expect(bookmarks.map((b) => b.savedAt)).toEqual(Array.from({ length: 41 }, (_, index) => 1000 - index * 1000));
  expect(collector.state.imported).toBe(41);
});

it('一時停止後は末尾の基準を復元し続きの順序を保つ', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  Object.assign(collector.d, { pageOk: () => true, isHidden: () => false, accountId: () => 'me' });
  await world.read();
  await world.collector.pause();
  expect(collector.positions.size).toBe(0);
  vi.spyOn(collector, 'loop').mockResolvedValue(undefined);
  await world.collector.resume();
  const item = collector.d.visible()[1];
  collector.d.visible = () => [{ ...item, tweetId: '1204' }];
  await collector.readVisible(collector.token);
  await world.flush();
  expect((await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId))
    .toEqual(['1201', '1203', '1204']);
  expect(collector.state.imported).toBe(3);
});

it('最終保存が失敗しても位置を解放し再開で未保存の順を復元する', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  const save = collector.d.addCollected;
  Object.assign(collector.d, {
    pageOk: () => true, isHidden: () => false, accountId: () => 'me',
    addCollected: vi.fn().mockRejectedValue(new Error('架空の保存失敗')),
  });
  await world.read();
  await world.collector.pause();
  expect(collector.positions.size).toBe(0);
  collector.d.addCollected = save;
  vi.spyOn(collector, 'loop').mockResolvedValue(undefined);
  await world.collector.resume();
  expect([...collector.positions.keys()]).toEqual(['1201', '1203']);
  expect(collector.positions.get('1201')).toBeLessThan(collector.positions.get('1203'));
});
