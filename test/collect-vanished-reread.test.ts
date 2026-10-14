// 版: v54-b
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectVisible } from '../src/content/collect';
import { getBookmark, listBookmarks, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './collector-helpers';

let post: HTMLElement;
const restore = (loaded = true) => {
  document.getElementById('last-post')!.before(post);
  if (!loaded) return;
  for (const [target, template] of [['main-avatar', 'late-avatar'], ['main-post', 'late-photo']]) {
    const source = document.getElementById(template) as HTMLTemplateElement;
    document.getElementById(target)!.append(source.content.cloneNode(true));
  }
  document.getElementById('main-text')!.textContent = '架空の読み直した本文。';
  for (const img of document.querySelectorAll('img')) markLoaded(img);
};
const ordered = async () => (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt);
const finish = (world: ReturnType<typeof collectorWorld>) => (world.collector as any).finish();

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v54-vanish-grace.html');
  post = document.getElementById('main-post')!;
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('消失の最初の検知では保存せず次の画面で読み直し保存順序と件数を保つ', async () => {
  const world = collectorWorld((now) => {
    if (now === 300) post.remove();
  });
  await world.read();
  await world.flush();
  expect(await getBookmark('1202')).toBeUndefined();
  expect(await getBookmark('1203')).toBeUndefined();
  expect(world.collector.state!.imported).toBe(2);
  for (const collection of ['seq', 'pending']) {
    expect((world.collector as any)[collection].some((it: any) => it.tweetId === '1202')).toBe(false);
  }
  expect((world.collector as any).seen.has('1202')).toBe(false);
  expect((world.collector as any).mediaRetry.has('1202')).toBe(false);
  restore();
  await world.read();
  await world.flush();
  expect((await getBookmark('1202'))!.snapshot.media).toHaveLength(1);
  expect((await ordered()).map((b) => [b.tweetId, b.savedAt])).toEqual([
    ['1201', 1000], ['1202', 0], ['1203', -1000],
  ]);
  expect(world.collector.state!).toMatchObject({ imported: 3, skipped: 0, failed: 0 });
  expect(world.clock.sleeps).toEqual([300]);
});

it('2 回消えて戻らなければ最後の値で保存し 3 回目は待たない', async () => {
  const world = collectorWorld(() => post.remove());
  await world.read();
  restore(false);
  document.getElementById('main-text')!.textContent = '架空の最後に読めた本文。';
  await world.read();
  await world.flush();
  expect((await getBookmark('1202'))!.snapshot).toMatchObject({ text: '架空の最後に読めた本文。', media: [] });
  expect(world.collector.state!.imported).toBe(3);
  expect(world.clock.sleeps).toEqual([300, 300]);
  restore();
  await world.read();
  expect(world.clock.sleeps).toHaveLength(2);
  expect(world.collector.state!.imported).toBe(3);
  expect((await ordered()).map((b) => b.tweetId)).toEqual(['1201', '1202', '1203']);
});

it.each(['finish', 'stop', 'pause', 'limit', 'cap', 'time'])('%s の終了で読み直し待ちを失わず保存する', async (method) => {
  const world = collectorWorld(() => post.remove());
  await world.read();
  await world.flush();
  expect(world.collector.state!.imported).toBe(2);
  if (['limit', 'cap', 'time'].includes(method)) await world.collector.pause(method as any);
  else await (world.collector as any)[method]();
  expect((await getBookmark('1202'))!.snapshot).toMatchObject({ text: '', media: [], avatar: undefined });
  expect((await ordered()).map((b) => [b.tweetId, b.savedAt])).toEqual([
    ['1201', 1000], ['1202', 0], ['1203', -1000],
  ]);
  expect(world.collector.state!.imported).toBe(3);
  expect((world.collector as any).vanishedRetry.size).toBe(0);
});

it('終了時の最後の保存が失敗しても読み直し待ちを件数に二重計上しない', async () => {
  const world = collectorWorld(() => post.remove());
  await world.read();
  (world.collector as any).d.addCollected = vi.fn().mockRejectedValue(new Error('架空の保存失敗'));
  await finish(world);
  expect(world.collector.state!).toMatchObject({ imported: 0, failed: 3 });
  expect(await listBookmarks()).toHaveLength(0);
});

it('上限には読み直し待ちの枠を残し追加スクロールで件数を増やさない', async () => {
  const world = collectorWorld(() => post.remove());
  const scrollBy = vi.fn();
  world.collector.state!.cap = 100;
  world.collector.state!.imported = 97;
  Object.assign((world.collector as any).d, {
    pageOk: () => true, isHidden: () => false, accountId: () => 'me', hasLimit: () => false, scrollBy,
  });
  await (world.collector as any).loop(0);
  expect(world.collector.state!).toMatchObject({ status: 'paused', reason: 'cap', imported: 100 });
  expect(scrollBy).not.toHaveBeenCalled();
  expect(await listBookmarks()).toHaveLength(3);
});

it('新しい後続ポストが増えても読み直したポストを元の位置へ保存する', async () => {
  const world = collectorWorld(() => post.remove());
  await world.read();
  await world.flush();
  const first = collectVisible()[0];
  const later = { ...first, tweetId: '1204' };
  (world.collector as any).d.visible = () => [...collectVisible(), later];
  await world.read();
  await world.flush();
  expect(await getBookmark('1204')).toBeUndefined();
  restore();
  await world.read();
  await world.flush();
  expect((await ordered()).map((b) => [b.tweetId, b.savedAt])).toEqual([
    ['1201', 1000], ['1202', 0], ['1203', -1000], ['1204', -2000],
  ]);
  expect(world.collector.state!.imported).toBe(4);
});

it('DOM に status リンクが残る読めない状態は次画面へ回さない', async () => {
  const world = collectorWorld(() => {
    document.getElementById('main-status')!.setAttribute('href', 'https://x.com/sample_slow/status/1202');
  });
  await world.read();
  await world.flush();
  expect(await getBookmark('1202')).toBeDefined();
  expect(world.collector.state!.imported).toBe(3);
  expect((world.collector as any).vanishedRetry.size).toBe(0);
  expect(world.clock.sleeps).toEqual([300]);
});

it('通常の時間切れは保存し v51 の追加待ちなしの補完を維持する', async () => {
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(await getBookmark('1202')).toBeDefined();
  expect(world.clock.sleeps).toEqual(Array(27).fill(300));
  expect((world.collector as any).vanishedRetry.size).toBe(0);
  restore();
  await world.read();
  expect((await getBookmark('1202'))!.snapshot.media).toHaveLength(1);
  expect(world.clock.sleeps).toHaveLength(27);
  expect(world.collector.state!.imported).toBe(3);
});

it('全体上限に近い消失も猶予を待たず次画面へ回す', async () => {
  const world = collectorWorld((now) => {
    if (now >= 7500) post.remove();
  });
  await world.read();
  await world.flush();
  expect(await getBookmark('1202')).toBeUndefined();
  expect((world.collector as any).vanishedRetry.size).toBe(1);
  expect(world.clock.sleeps).toEqual(Array(25).fill(300));
});

it('複数の読み直し待ちを終了時に元の順序で戻す', async () => {
  const world = collectorWorld(() => {
    post.remove();
    document.getElementById('last-post')?.remove();
  });
  document.getElementById('last-post')!.querySelector('img')!.remove();
  await world.read();
  expect(world.collector.state!.imported).toBe(1);
  await finish(world);
  expect((await ordered()).map((b) => b.tweetId)).toEqual(['1201', '1202', '1203']);
  expect(world.collector.state!.imported).toBe(3);
});

it('消える直前に更新された最後の内容を終了時の保存に使う', async () => {
  const world = collectorWorld((now) => {
    if (now === 300) document.getElementById('main-text')!.textContent = '架空の消える直前の本文。';
    if (now === 600) post.remove();
  });
  await world.read();
  await finish(world);
  expect((await getBookmark('1202'))!.snapshot.text).toBe('架空の消える直前の本文。');
});

it('通常の保存バッチをまたいでも読み直し待ちの後ろの順序を保つ', async () => {
  const world = collectorWorld(() => post.remove());
  const first = collectVisible()[0];
  const later = Array.from({ length: 25 }, (_, i) => ({ ...first, tweetId: `${1300 + i}` }));
  (world.collector as any).d.visible = () => [...collectVisible(), ...later];
  await world.read();
  await world.flush();
  expect(await listBookmarks()).toHaveLength(1);
  restore();
  await world.read();
  await world.flush();
  const bookmarks = await ordered();
  expect(bookmarks.map((b) => b.tweetId)).toEqual(['1201', '1202', '1203', ...later.map((it) => it.tweetId)]);
  expect(bookmarks.map((b) => b.savedAt)).toEqual(Array.from({ length: 28 }, (_, i) => 1000 - i * 1000));
  expect(world.collector.state!.imported).toBe(28);
});

it('スクロールで戻ったポストを読み直して既存の終端条件まで進む', async () => {
  const world = collectorWorld((now) => {
    if (now === 300) post.remove();
  });
  const scrollBy = vi.fn(() => {
    if (!post.isConnected) restore();
  });
  Object.assign((world.collector as any).d, {
    pageOk: () => true, isHidden: () => false, accountId: () => 'me', hasLimit: () => false,
    isLoading: () => false, viewportHeight: () => 1000, scrollY: () => 0, scrollBy,
  });
  await (world.collector as any).loop(0);
  expect(world.collector.state!).toMatchObject({ status: 'done', imported: 3, failed: 0 });
  expect((await getBookmark('1202'))!.snapshot.avatar).toBeTruthy();
  expect(scrollBy.mock.calls).toEqual(Array.from({ length: 4 }, () => [800]));
  expect(world.clock.sleeps.filter((ms) => ms === 300)).toHaveLength(1);
  // 再取得待ちが新規として検知される最初のスクロールだけ既存の下限 800 ms、以後は 2000 ms。
  expect(world.clock.sleeps.filter((ms) => ms === 100)).toHaveLength(8 + 3 * 20);
});

it('1000 件目が読み直し待ちでも上限で 1000 件を重複なく保存する', async () => {
  const [first, pending] = collectVisible();
  let visible = [
    ...Array.from({ length: 999 }, (_, i) => ({
      ...first, tweetId: `${10000 + i}`,
      snapshot: { ...first.snapshot, url: `https://x.com/sample_first/status/${10000 + i}` },
    })), pending,
  ];
  const world = collectorWorld(() => {
    post.remove();
    visible = visible.filter((it) => it.tweetId !== '1202');
  });
  const scrollBy = vi.fn();
  world.collector.state!.cap = 1000;
  Object.assign((world.collector as any).d, {
    visible: () => visible, pageOk: () => true, isHidden: () => false,
    accountId: () => 'me', hasLimit: () => false, scrollBy,
  });
  await (world.collector as any).loop(0);
  const bookmarks = await ordered();
  expect(bookmarks).toHaveLength(1000);
  expect(new Set(bookmarks.map((b) => b.tweetId)).size).toBe(1000);
  expect(bookmarks[999].tweetId).toBe('1202');
  expect(world.collector.state!).toMatchObject({ imported: 1000, reason: 'cap' });
  expect(scrollBy).not.toHaveBeenCalled();
});
