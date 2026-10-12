import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectVisible } from '../src/content/collect';
import { SettleDiagnosis } from '../src/content/settleDiagnosis';
import { loadFixture } from './v50-helpers';

beforeEach(() => {
  loadFixture('v58-autocollect.html');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('同じ待ちの途中の begin は刻みと開始時刻を保つ', () => {
  let now = 1000;
  const diagnosis = new SettleDiagnosis(() => now);
  const item = collectVisible()[1];
  diagnosis.begin(item, 2);
  diagnosis.step(300);
  now += 900;
  diagnosis.begin(item, 99);
  diagnosis.step(300);
  now += 600;
  diagnosis.complete(item.tweetId, 'timedOut');
  diagnosis.report();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0])
    .toMatchObject({ waitedMs: 600, elapsedMs: 1500, position: 2 });
});

it('完了してから同じ ID の待ちを始めると時刻と刻みをリセットする', () => {
  let now = 1000;
  const diagnosis = new SettleDiagnosis(() => now);
  const item = collectVisible()[1];
  diagnosis.begin(item, 2);
  diagnosis.step(300);
  now += 900;
  diagnosis.complete(item.tweetId, 'vanished', 'removed');
  now = 5000;
  diagnosis.begin(item, 4);
  diagnosis.step(300);
  now += 300;
  diagnosis.complete(item.tweetId, 'timedOut');
  diagnosis.report();
  const log = vi.mocked(console.info).mock.calls[0][1];
  expect(log.unresolved[1]).toMatchObject({ waitedMs: 300, elapsedMs: 300, position: 4 });
  expect(log.counts).toMatchObject({ vanished: 1, timedOut: 1 });
});

it('新しい実行の reset 後は未完了だった ID も新しい待ちになる', () => {
  let now = 1000;
  const diagnosis = new SettleDiagnosis(() => now);
  const item = collectVisible()[1];
  diagnosis.begin(item, 2);
  diagnosis.step(600);
  diagnosis.reset();
  now = 5000;
  diagnosis.begin(item, 1);
  now += 300;
  diagnosis.step(300);
  diagnosis.complete(item.tweetId, 'forced');
  diagnosis.report();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0])
    .toMatchObject({ waitedMs: 300, elapsedMs: 300, position: 1 });
});
