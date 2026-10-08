import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { importData, listBookmarks, listFolders, setAccountScope } from '../src/shared/storage';
import { INBOX_ID } from '../src/shared/models';

const snap = (n: string, over: Record<string, unknown> = {}) => ({
  text: `t${n}`, author: 'A', handle: '@a', media: ['https://pbs.twimg.com/media/a.jpg'], url: `https://x.com/a/status/${n}`, ...over,
});
const bk = (n: string, snapshot: unknown, folderIds: string[] = ['f_x']) => ({ accountId: 'me', tweetId: n, folderIds, savedAt: 1, snapshot });
const imp = (bookmarks: unknown[]) => importData({ app: 'PostShelf', version: 2, accounts: [], folders: [{ id: 'f_x', name: 'x', icon: 'ti-star', order: 0, accountId: 'me' }], bookmarks });

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

describe('v26-B: import validation', () => {
  it('drops posts without handle / author, and with a non-X url', async () => {
    const n = await imp([
      bk('1', snap('1')),
      bk('2', snap('2', { handle: undefined })),
      bk('3', snap('3', { author: 5 })),
      bk('4', snap('4', { url: 'javascript:alert(1)' })),
      bk('5', snap('5', { url: 'https://evil.example/x' })),
      bk('6', snap('6', { url: 'https://twitter.com/a/status/6' })),
    ]);
    expect(n).toBe(2);
    expect((await listBookmarks()).map((b) => b.tweetId).sort()).toEqual(['1', '6']);
  });

  it('keeps the post but drops non-https media / avatar', async () => {
    await imp([bk('1', snap('1', { media: ['http://x.test/a.jpg', 'https://pbs.twimg.com/ok.jpg', 5, 'javascript:1'], avatar: 'http://x.test/av.png' }))]);
    const b = (await listBookmarks())[0];
    expect(b.snapshot.media).toEqual(['https://pbs.twimg.com/ok.jpg']);
    expect(b.snapshot.avatar).toBeUndefined();
  });

  it('keeps a https avatar', async () => {
    await imp([bk('1', snap('1', { avatar: 'https://pbs.twimg.com/av.png' }))]);
    expect((await listBookmarks())[0].snapshot.avatar).toBe('https://pbs.twimg.com/av.png');
  });

  it('turns [] / ["all"] into the inbox, with its folder', async () => {
    await imp([bk('1', snap('1'), []), bk('2', snap('2'), ['all']), bk('3', snap('3'), ['all', 'f_x'])]);
    const by = Object.fromEntries((await listBookmarks()).map((b) => [b.tweetId, b.folderIds]));
    expect(by).toEqual({ '1': [INBOX_ID], '2': [INBOX_ID], '3': ['f_x'] });
    expect((await listFolders()).some((f) => f.id === INBOX_ID)).toBe(true);
  });

  it('accepts good data as before', async () => {
    expect(await imp([bk('1', snap('1'))])).toBe(1);
  });
});
