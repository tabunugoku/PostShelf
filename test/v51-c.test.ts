import { beforeEach, expect, it } from 'vitest';
import { isEmojiImageUrl } from '../src/shared/avatar';
import { extractTweet } from '../src/content/snapshot';
import { getBookmark, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture } from './v50-helpers';

const defaultAvatar = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_bigger.png';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v51-default-avatar.html');
});

it('/emoji/ を含む画像 URL を絵文字と判定する', () => {
  expect(isEmojiImageUrl('https://abs.twimg.com/emoji/v2/svg/1f383.svg')).toBe(true);
});

it('abs.twimg.com の初期アイコンを絵文字と判定しない', () => {
  expect(isEmojiImageUrl(defaultAvatar)).toBe(false);
});

it('初期アイコンだけのポストで avatar を取得し pending にしない', () => {
  const post = extractTweet(document.getElementById('default-avatar-post')!)!;
  expect(post.snapshot.avatar).toBe(defaultAvatar);
  expect(post.avatarPending).toBeUndefined();
});

it('読み込み済みの初期アイコンを追加の待ちなしで保存する', async () => {
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([]);
  expect((await getBookmark('901'))!.snapshot.avatar).toBe(defaultAvatar);
});
