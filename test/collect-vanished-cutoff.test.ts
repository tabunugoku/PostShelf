// 版: v55-a
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SETTLE_MAX_MS } from '../src/content/autocollect';
import { getBookmark, listBookmarks, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './collector-helpers';

let post: HTMLElement;
const restore = () => {
  document.getElementById('last-post')!.before(post);
  for (const [target, template] of [['main-avatar', 'late-avatar'], ['main-post', 'late-photo']]) {
    const source = document.getElementById(template) as HTMLTemplateElement;
    document.getElementById(target)!.append(source.content.cloneNode(true));
  }
  document.getElementById('main-text')!.textContent = '架空の次画面の本文。';
  for (const img of document.querySelectorAll('img')) markLoaded(img);
};
const finish = (world: ReturnType<typeof collectorWorld>) => (world.collector as any).finish();

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v54-vanish-grace.html');
  post = document.getElementById('main-post')!;
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it.each([0, 0.5, 1])('乱数 %s でも消失の最初の確認だけで次画面へ回して保存する', async (random) => {
  const world = collectorWorld(() => post.remove());
  (world.collector as any).d.random = () => random;
  await world.read();
  await world.flush();
  const step = 300 + Math.round(random * 200);
  expect(world.clock.sleeps).toEqual([step]);
  expect(await getBookmark('1202')).toBeUndefined();
  expect(world.collector.state!.imported).toBe(2);
  restore();
  await world.read();
  await finish(world);
  expect((await getBookmark('1202'))!.snapshot).toMatchObject({
    avatar: 'https://pbs.twimg.com/profile_images/sample-slow-v54.jpg',
    media: ['https://pbs.twimg.com/media/sample-slow-v54.jpg'], text: '架空の次画面の本文。',
  });
  const bookmarks = (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt);
  expect(bookmarks.map((b) => [b.tweetId, b.savedAt])).toEqual([
    ['1201', 1000], ['1202', 0], ['1203', -1000],
  ]);
  expect(world.collector.state!.imported).toBe(3);
  expect(world.clock.sleeps).toEqual([step]);
});

it('2 回の消失は各 1 回の確認で打ち切り最後の値を保存する', async () => {
  const world = collectorWorld(() => post.remove());
  await world.read();
  document.getElementById('last-post')!.before(post);
  document.getElementById('main-text')!.textContent = '架空の最後の本文。';
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([300, 300]);
  expect((await getBookmark('1202'))!.snapshot.text).toBe('架空の最後の本文。');
  expect(world.collector.state!.imported).toBe(3);
  expect((world.collector as any).vanishedRetry.size).toBe(0);
});

it('unreadable も猶予を待たずその場で最後の値を保存する', async () => {
  const world = collectorWorld(() => {
    // absolute の status リンクは DOM に残るが extractTweet には読めないという既存 fixture の前提。
    document.getElementById('main-status')!.setAttribute('href', 'https://x.com/sample_slow/status/1202');
  });
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([300]);
  expect(await getBookmark('1202')).toBeDefined();
  expect((world.collector as any).vanishedRetry.size).toBe(0);
});

it('消失検知までの刻みを残し猶予と戻った件数のキーをログから除く', async () => {
  const info = vi.mocked(console.info);
  const world = collectorWorld((now) => {
    if (now === 900) post.remove();
  });
  (world.collector as any).d.now = () => 123;
  await world.read();
  await finish(world);
  expect(info).toHaveBeenCalledTimes(1);
  const log = info.mock.calls[0][1];
  expect(log.counts).toEqual({ resolved: 0, timedOut: 0, vanished: 1, forced: 0, unflagged: 0, vanishedGone: 1 });
  expect(log.unresolved[0]).toMatchObject({
    tweetId: '1202', vanished: 'removed', disappearedAfterMs: 900, waitedMs: 900, elapsedMs: 0,
  });
  expect(JSON.stringify(log)).not.toMatch(/vanishedReturned|vanishElapsedMs/);
  expect(world.clock.sleeps).toEqual([300, 300, 300]);
});

it('消えたポストがあっても残る pending の待ちは元の 8 秒の刻みだけ', async () => {
  document.getElementById('last-post')!.querySelector('img')!.remove();
  const world = collectorWorld((now) => {
    if (now === 300) post.remove();
  });
  await world.read();
  await finish(world);
  expect(world.clock.sleeps).toEqual(Array(Math.ceil(SETTLE_MAX_MS / 300)).fill(300));
  expect((await listBookmarks()).map((b) => b.tweetId).sort()).toEqual(['1201', '1202', '1203']);
  expect(world.collector.state!.imported).toBe(3);
});

it('全体上限直前の消失でも最初の検知で次画面へ回す', async () => {
  const world = collectorWorld((now) => {
    if (now >= 7500) post.remove();
  });
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual(Array(25).fill(300));
  expect(await getBookmark('1202')).toBeUndefined();
  expect((world.collector as any).vanishedRetry.has('1202')).toBe(true);
});
