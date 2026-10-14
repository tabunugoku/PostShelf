// 版: v68-a
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { getBookmark, importData, listAccounts, setAccountScope } from '../src/shared/storage';
import { isXImageUrl } from '../src/shared/media';

const PBS = 'https://pbs.twimg.com/media/sample_a.jpg';
const ABS = 'https://abs.twimg.com/emoji/v2/svg/sample.svg';
const EVIL = 'https://evil.example/a.jpg';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

/** 画像の URL を差し替えた JSON を取り込み、保存されたポストとアカウントを返す */
async function load(snapshot: object, accountAvatar: string) {
  await importData({
    app: 'PostShelf',
    version: 2,
    folders: [],
    accounts: [{ id: 'me', handle: 'me', lastSeenAt: 5, avatar: accountAvatar }],
    bookmarks: [{
      accountId: 'me',
      tweetId: '111',
      savedAt: 1,
      folderIds: [],
      snapshot: {
        author: 'Sample',
        handle: '@sample_user',
        text: '架空の本文',
        url: 'https://x.com/sample_user/status/111',
        media: [],
        ...snapshot,
      },
    }],
  });
  const accounts = (await listAccounts()).map((x) => x.account);
  return { post: (await getBookmark('111'))!, account: accounts.find((a) => a.id === 'me')! };
}

describe('取り込む画像の URL', () => {
  it('X の画像の置き場以外の media・avatar・videoPoster だけを捨てる', async () => {
    const { post, account } = await load({
      media: [EVIL, PBS],
      avatar: EVIL,
      hasVideo: true,
      videoPoster: EVIL,
      quote: { author: 'Q', handle: '@sample_q', text: 'q', media: [EVIL, PBS], avatar: EVIL },
    }, EVIL);
    expect(post.snapshot.media).toEqual([PBS]);
    expect(post.snapshot.avatar).toBeUndefined();
    expect(post.snapshot.videoPoster).toBeUndefined();
    expect(post.snapshot.quote?.media).toEqual([PBS]);
    expect(post.snapshot.quote?.avatar).toBeUndefined();
    expect(post.snapshot.text).toBe('架空の本文');
    expect(account.handle).toBe('me');
    expect(account.avatar).toBeUndefined();
  });

  it('pbs.twimg.com と abs.twimg.com の URL は残す', async () => {
    const { post, account } = await load({
      media: [PBS],
      avatar: ABS,
      hasVideo: true,
      videoPoster: 'https://pbs.twimg.com/amplify_video_thumb/sample.jpg',
      quote: { author: 'Q', handle: '@sample_q', text: 'q', media: [], avatar: PBS },
    }, ABS);
    expect(post.snapshot.media).toEqual([PBS]);
    expect(post.snapshot.avatar).toBe(ABS);
    expect(post.snapshot.videoPoster).toContain('amplify_video_thumb');
    expect(post.snapshot.quote?.avatar).toBe(PBS);
    expect(account.avatar).toBe(ABS);
  });

  it('偽のホスト名は通さない', () => {
    expect(isXImageUrl('https://pbs.twimg.com.example.invalid/a.jpg')).toBe(false);
    expect(isXImageUrl('https://pbs.twimg.com@evil.example/a.jpg')).toBe(false);
    expect(isXImageUrl('http://pbs.twimg.com/a.jpg')).toBe(false);
    expect(isXImageUrl(5)).toBe(false);
  });
});
