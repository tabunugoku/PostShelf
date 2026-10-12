import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as snapshot from '../src/content/snapshot';
import { defaultDeps } from '../src/content/autocollect';
import { collectorWorld, loadFixture } from './v50-helpers';
import { installChromeMock } from './chrome-mock';
import { setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  document.getElementById('main-post')!.remove();
});

afterEach(() => vi.restoreAllMocks());

it('再確認する既読だけ解析し他の既読の解析を省く', () => {
  const seen = new Set(['1201', '1203']);
  const reread = new Set(['1203', 'offscreen']);
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const items = defaultDeps().visible(seen, undefined, reread);
  expect(items.map((it) => it.tweetId)).toEqual(['1203']);
  expect(extract.mock.calls.map(([article]) => article.id)).toEqual(['last-post']);
});

it('画面外の時間切れが残っても seen と timedOut をそのまま渡す', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  collector.seen = new Set(Array.from({ length: 24000 }, (_, index) => `${10000 + index}`));
  collector.seen.add('1201');
  collector.seen.add('1203');
  collector.timedOut.add('offscreen');
  const visible = vi.spyOn(collector.d, 'visible');
  // 大きい seen を反復して複製する処理も検出する。
  const iterate = vi.fn(() => Set.prototype[Symbol.iterator].call(collector.seen));
  collector.seen[Symbol.iterator] = iterate;
  await world.read();
  await world.read();
  expect(visible).toHaveBeenCalledTimes(2);
  for (const [seen, , reread] of visible.mock.calls) {
    expect(seen).toBe(collector.seen);
    expect(reread).toBe(collector.timedOut);
  }
  expect(iterate).not.toHaveBeenCalled();
});

it('引数なしの全件取得と only による絞り込みを維持する', () => {
  const deps = defaultDeps();
  expect(deps.visible().map((it) => it.tweetId)).toEqual(['1201', '1203']);
  expect(deps.visible(undefined, new Set(['1203'])).map((it) => it.tweetId)).toEqual(['1203']);
});
