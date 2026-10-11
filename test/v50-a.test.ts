import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './v50-helpers';
import { SETTLE_MAX_MS, SETTLE_POLL_MS } from '../src/content/autocollect';
import { extractTweet, fillSource, hasPending } from '../src/content/snapshot';
import { listBookmarks, missingFields, setAccountScope } from '../src/shared/storage';

const avatar = 'https://pbs.twimg.com/profile_images/sample-v50.jpg';
const readPost = (id = 'main-post') => extractTweet(document.getElementById(id)!)!;
const insertAvatar = (id: string) => {
  const img = document.createElement('img');
  img.src = avatar;
  markLoaded(img);
  document.getElementById(id)!.append(img);
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v50-no-avatar.html');
});

it('アイコンの img がまだ無いポストを pending にする', () => {
  expect(readPost().avatarPending).toBe(true);
  expect(hasPending(readPost())).toBe(true);
});

it('読み込み済みのアイコンがあれば待たない', () => {
  insertAvatar('main-avatar');
  expect(readPost().avatarPending).toBeUndefined();
  expect(hasPending(readPost())).toBe(false);
});

it('引用枠にアイコンの img がまだ無ければ pending にする', () => {
  insertAvatar('quote-main-avatar');
  expect(readPost('quote-post').quoteAvatarPending).toBe(true);
  insertAvatar('quote-avatar');
  expect(hasPending(readPost('quote-post'))).toBe(false);
});

it('引用データがまだ空でも findQuote が見つけた枠を待つ', () => {
  document.getElementById('quote-name')!.textContent = '';
  document.getElementById('quote-text')!.textContent = '';
  expect(readPost('quote-post').snapshot.quote).toBeUndefined();
  expect(readPost('quote-post').quoteAvatarPending).toBe(true);
});

it('pending のアイコンを fillSource と missingFields が補完に使わない', () => {
  insertAvatar('main-avatar');
  const img = document.getElementById('main-avatar')!.firstElementChild!;
  Object.defineProperty(img, 'complete', { value: false });
  const extracted = readPost();
  const source = fillSource(extracted);
  expect(source).not.toHaveProperty('avatar');
  expect(missingFields({ ...source, avatar: undefined }, source)).toBeNull();
});

it('1 秒後にアイコンの img が DOM に現れたら待って保存する', async () => {
  document.getElementById('quote-post')!.remove();
  const world = collectorWorld((now) => {
    if (now >= 1000 && !document.getElementById('main-avatar')!.children.length) insertAvatar('main-avatar');
  });
  await world.read();
  await world.flush();
  expect(world.clock.now).toBeGreaterThanOrEqual(1000);
  expect(world.clock.now).toBeLessThan(SETTLE_MAX_MS);
  expect((await listBookmarks())[0].snapshot.avatar).toBe(avatar);
});

it('4 秒でアイコン待ちを打ち切り次のポストも保存する', async () => {
  document.getElementById('quote-frame')!.remove();
  insertAvatar('quote-main-avatar');
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.now).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
  expect(world.clock.now).toBeLessThan(SETTLE_MAX_MS + SETTLE_POLL_MS);
  const saved = await listBookmarks();
  expect(saved).toHaveLength(2);
  expect(saved.find((post) => post.tweetId === '501')!.snapshot.avatar).toBeUndefined();
  expect(saved.find((post) => post.tweetId === '502')!.snapshot.avatar).toBe(avatar);
  await (world.collector as any).finish();
  expect(world.collector.state!.status).toBe('done');
});

it('pending でないポストには待ちを追加しない', async () => {
  document.getElementById('quote-post')!.remove();
  insertAvatar('main-avatar');
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([]);
  expect(await listBookmarks()).toHaveLength(1);
});
