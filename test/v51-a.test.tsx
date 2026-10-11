import { render } from 'preact';
import { beforeEach, expect, it } from 'vitest';
import { detectAccount } from '../src/content/account';
import { extractTweet, fillSource } from '../src/content/snapshot';
import { AvatarContext, buildAvatarFallback, useAvatar } from '../src/manager/avatars';
import { fillMissing, getBookmark, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { loadFixture, markLoaded } from './v50-helpers';

const emoji = 'https://abs.twimg.com/emoji/v2/svg/1f600.svg';
const avatar = 'https://pbs.twimg.com/profile_images/sample-v51.jpg';
const read = () => extractTweet(document.getElementById('main-post')!)!;
const insertAvatar = (id: string) => {
  const img = document.createElement('img');
  img.src = avatar;
  markLoaded(img);
  document.getElementById(id)!.append(img);
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v51-emoji-avatar.html');
});

it('表示名の絵文字だけでは本体と引用のアイコンを取得せず pending にする', () => {
  const post = read();
  expect(post.snapshot.avatar).toBeUndefined();
  expect(post.avatarPending).toBe(true);
  expect(post.snapshot.quote!.avatar).toBeUndefined();
  expect(post.quoteAvatarPending).toBe(true);
});

it('本体と引用に本物のアイコンがあれば絵文字より優先する', () => {
  insertAvatar('main-avatar');
  insertAvatar('quote-avatar');
  expect(read().snapshot.avatar).toBe(avatar);
  expect(read().snapshot.quote!.avatar).toBe(avatar);
  expect(read().avatarPending).toBeUndefined();
  expect(read().quoteAvatarPending).toBeUndefined();
});

it('User-Name 内の画像は URL がプロフィール画像でも候補から外す', () => {
  for (const img of document.querySelectorAll('[data-testid="User-Name"] img')) img.setAttribute('src', avatar);
  expect(read().snapshot.avatar).toBeUndefined();
  expect(read().snapshot.quote!.avatar).toBeUndefined();
});

it.each([emoji, 'https://abs.twimg.com/sample.svg', 'https://example.test/emoji/sample.svg'])(
  '専用アイコン枠でも絵文字系 URL %s をアイコンにしない', (url) => {
    insertAvatar('main-avatar');
    document.getElementById('main-avatar')!.firstElementChild!.setAttribute('src', url);
    expect(read().snapshot.avatar).toBeUndefined();
    expect(read().avatarPending).toBe(true);
  },
);

it('アカウント切替ボタンの絵文字だけではアイコンを取得しない', () => {
  expect(detectAccount()!.avatar).toBeUndefined();
});

it('アカウント切替ボタンで絵文字の後ろに本物があれば本物を取得する', () => {
  insertAvatar('account-switcher');
  expect(detectAccount()!.avatar).toBe(avatar);
});

it('保存済みの本体と引用の絵文字アイコンを画面の本物で補う', async () => {
  const snapshot = read().snapshot;
  await setBookmarkFolders('701', ['sample-folder'], {
    ...snapshot, avatar: emoji, quote: { ...snapshot.quote!, avatar: emoji },
  });
  const before = (await getBookmark('701'))!;
  insertAvatar('main-avatar');
  insertAvatar('quote-avatar');
  expect(await fillMissing([{ tweetId: '701', snapshot: fillSource(read()) }])).toBe(1);
  expect(await getBookmark('701')).toEqual({
    ...before, snapshot: { ...before.snapshot, avatar, quote: { ...before.snapshot.quote!, avatar } },
  });
});

it('補完元の絵文字で空のアイコンを埋めない', async () => {
  const snapshot = read().snapshot;
  delete snapshot.avatar;
  delete snapshot.quote!.avatar;
  await setBookmarkFolders('701', [], snapshot);
  expect(await fillMissing([{ tweetId: '701', snapshot: {
    ...snapshot, avatar: emoji, quote: { ...snapshot.quote!, avatar: emoji },
  } }])).toBe(0);
});

it('noteAccount は絵文字で既存の本物のアイコンを上書きしない', async () => {
  await noteAccount({ handle: 'me', avatar }, 1000);
  expect((await noteAccount({ handle: 'me', avatar: emoji }, 2000)).avatar).toBe(avatar);
});

it('noteAccount は新規の絵文字アイコンを未取得にする', async () => {
  expect((await noteAccount({ handle: 'me', avatar: emoji })).avatar).toBeUndefined();
});

it('noteAccount は保存済みの絵文字アイコンも引き継がない', async () => {
  await chrome.storage.local.set({
    accounts: { me: { id: 'me', handle: 'me', avatar: emoji, lastSeenAt: 0 } },
    schemaVersion: 2,
  });
  expect((await noteAccount({ handle: 'me' })).avatar).toBeUndefined();
});

it('専用枠の絵文字を除いたあと別候補の本物のアイコンを取得する', () => {
  insertAvatar('main-avatar');
  document.getElementById('main-avatar')!.firstElementChild!.setAttribute('src', emoji);
  const link = document.createElement('a');
  link.setAttribute('role', 'link');
  link.setAttribute('href', '/sample_emoji');
  document.getElementById('main-post')!.append(link);
  link.id = 'fallback-avatar';
  insertAvatar('fallback-avatar');
  expect(read().snapshot.avatar).toBe(avatar);
  expect(read().avatarPending).toBeUndefined();
});

it('同じ人の本物のアイコンを使い絵文字を代用元にしない', async () => {
  await setBookmarkFolders('701', [], { ...read().snapshot, avatar });
  const post = (await getBookmark('701'))!;
  const fallback = buildAvatarFallback([
    post, { ...post, tweetId: '702', savedAt: post.savedAt + 1, snapshot: { ...post.snapshot, avatar: emoji } },
  ]);
  expect(fallback.get('sample_emoji')).toBe(avatar);
  function SampleAvatar() {
    return <img src={useAvatar(emoji, '@sample_emoji')} />;
  }
  const root = document.createElement('div');
  render(<AvatarContext.Provider value={fallback}><SampleAvatar /></AvatarContext.Provider>, root);
  expect(root.querySelector('img')!.src).toBe(avatar);
  render(null, root);
});
