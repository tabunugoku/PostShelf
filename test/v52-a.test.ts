import { beforeEach, expect, it, vi } from 'vitest';
import { SCROLL_RATIO, SETTLE_POLL_MS, SETTLE_POLL_JITTER_MS, WAIT_STEP_MS } from '../src/content/autocollect';
import { getBookmark, listBookmarks, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './v50-helpers';

const avatar = 'https://pbs.twimg.com/profile_images/sample-slow-v52.jpg';
const media = 'https://pbs.twimg.com/media/sample-slow-v52.jpg';
const ready = () => {
  for (const [target, template] of [['main-avatar', 'late-avatar'], ['main-post', 'late-photo']]) {
    const source = document.getElementById(template) as HTMLTemplateElement;
    document.getElementById(target)!.append(source.content.cloneNode(true));
  }
  document.getElementById('main-text')!.textContent = '架空の遅れて現れた本文。';
  for (const img of document.querySelectorAll('img')) markLoaded(img);
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v52-settle-8s.html');
});

it('4 秒を過ぎて読み込まれた値を待って保存し完了時点で待ちを終える', async () => {
  const world = collectorWorld((now) => {
    if (now === 4500) ready();
  });
  await world.read();
  await world.flush();
  expect((await getBookmark('1001'))!.snapshot).toMatchObject({
    avatar, media: [media], text: '架空の遅れて現れた本文。',
  });
  expect(world.clock.sleeps).toEqual(Array(15).fill(300));
});

it('8 秒で欠けたまま保存して次のポストも取り込み終端まで進む', async () => {
  const world = collectorWorld();
  const scrollBy = vi.fn();
  Object.assign((world.collector as any).d, {
    scrollBy, scrollY: () => 0, viewportHeight: () => 1000,
    pageOk: () => true, isHidden: () => false, accountId: () => 'me',
    isLoading: () => false, hasLimit: () => false, hasUnseen: () => false,
  });
  await (world.collector as any).loop(0);
  expect((await getBookmark('1001'))!.snapshot).toMatchObject({ text: '', media: [] });
  expect((await getBookmark('1001'))!.snapshot.avatar).toBeUndefined();
  expect((await getBookmark('1002'))!.snapshot.text).toBe('架空の読み込み済みポスト。');
  expect(world.collector.state!.status).toBe('done');
  expect(world.clock.sleeps.filter((ms) => ms === 300)).toEqual(Array(27).fill(300));
  expect(scrollBy.mock.calls).toEqual(Array.from({ length: 3 }, () => [1000 * SCROLL_RATIO]));
  expect(world.clock.sleeps.filter((ms) => ms === WAIT_STEP_MS)).toEqual(Array(60).fill(100));
});

it.each([0, 0.5, 1])('乱数 %s の待ちの刻みの合計で 8 秒を数え実際の時計に依存しない', async (random) => {
  const world = collectorWorld();
  // 表のタブでは時計が進まなくても、sleep に渡した刻みで上限を判定する。
  (world.collector as any).d.isHidden = () => false;
  (world.collector as any).d.now = () => 123;
  (world.collector as any).d.random = () => random;
  const sleep = (world.collector as any).d.sleep;
  (world.collector as any).d.sleep = async (ms: number) => {
    // 修正前の実時間判定でもテストが無限に待たないようにする。
    if (world.clock.sleeps.length >= 30) throw new Error('刻みの予算を超えた待ち');
    await sleep(ms);
  };
  await world.read();
  await world.flush();
  const step = SETTLE_POLL_MS + Math.round(random * SETTLE_POLL_JITTER_MS);
  expect(world.clock.sleeps).toEqual(Array(Math.ceil(8000 / step)).fill(step));
  expect(await listBookmarks()).toHaveLength(2);
});

it('pending でないポストには待ちを足さない', async () => {
  ready();
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([]);
  expect(await listBookmarks()).toHaveLength(2);
});
