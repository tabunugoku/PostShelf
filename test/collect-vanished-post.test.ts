// 版: v54-a
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SETTLE_MAX_MS } from '../src/content/autocollect';
import { getBookmark, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './collector-helpers';

let post: HTMLElement;
const ready = () => {
  if (!post.isConnected) document.getElementById('last-post')!.before(post);
  for (const [target, template] of [['main-avatar', 'late-avatar'], ['main-post', 'late-photo']]) {
    const source = document.getElementById(template) as HTMLTemplateElement;
    document.getElementById(target)!.append(source.content.cloneNode(true));
  }
  document.getElementById('main-text')!.textContent = '架空の戻った本文。';
  for (const img of document.querySelectorAll('img')) markLoaded(img);
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v54-vanish-grace.html');
  post = document.getElementById('main-post')!;
});
afterEach(() => vi.restoreAllMocks());

it('最初の確認で消えたポストを次画面で読み込み済みの値で保存する', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const world = collectorWorld((now) => {
    if (now === 300) post.remove();
  });
  await world.read();
  ready();
  await world.read();
  await (world.collector as any).finish();
  expect((await getBookmark('1202'))!.snapshot).toMatchObject({
    avatar: 'https://pbs.twimg.com/profile_images/sample-slow-v54.jpg',
    media: ['https://pbs.twimg.com/media/sample-slow-v54.jpg'], text: '架空の戻った本文。',
  });
  expect(world.clock.sleeps).toEqual([300]);
  expect(info.mock.calls[0][1]).toMatchObject({
    counts: { resolved: 0, vanished: 1, vanishedGone: 1 },
    unresolved: [{ disappearedAfterMs: 300, waitedMs: 300 }],
  });
});

it('消失検知までの時間を実際の時計によらず刻みで数える', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const world = collectorWorld((now) => {
    if (now === 900) post.remove();
  });
  (world.collector as any).d.now = () => 123;
  await world.read();
  await (world.collector as any).finish();
  expect(world.clock.sleeps).toEqual(Array(3).fill(300));
  expect(info.mock.calls[0][1]).toMatchObject({
    counts: { vanished: 1, vanishedGone: 1 }, vanished: { removed: 1 },
    unresolved: [{ disappearedAfterMs: 900, waitedMs: 900, elapsedMs: 0 }],
  });
});

it('次画面で戻っても pending なら通常の待ちで解決する', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const world = collectorWorld((now) => {
    if (now === 300) post.remove();
    if (now === 600) ready();
  });
  await world.read();
  document.getElementById('last-post')!.before(post);
  await world.read();
  await (world.collector as any).finish();
  expect(world.clock.now).toBe(600);
  expect((await getBookmark('1202'))!.snapshot.avatar).toBeTruthy();
  expect(info.mock.calls[0][1].counts).toMatchObject({ resolved: 1, vanishedGone: 1 });
});

it.each([0, 0.5, 1])('消失が遅くても乱数 %s の刻みで既存の全体上限を延ばさない', async (random) => {
  const world = collectorWorld((now) => {
    if (now >= 7500) post.remove();
  });
  (world.collector as any).d.random = () => random;
  await world.read();
  await world.flush();
  const step = 300 + Math.round(random * 200);
  expect(world.clock.sleeps).toEqual(Array(Math.ceil(7500 / step)).fill(step));
  expect(world.clock.now).toBeLessThan(SETTLE_MAX_MS + step);
});

it('最初から pending でなければ待ちを追加しない', async () => {
  ready();
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([]);
  expect(world.collector.state!.imported).toBe(3);
});
