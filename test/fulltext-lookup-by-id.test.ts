// 版: v57-c
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as storage from '../src/shared/storage';
import { defaultDeps } from '../src/background/fulltext';

let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, {
    folders: [],
  });
  seedBookmarks(data, Object.values(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`me:${i}`, {
      accountId: 'me', tweetId: `${i}`, savedAt: i, folderIds: ['sample_folder'],
      snapshot: {
        text: `架空の長い本文 ${i}`, author: 'Sample User', handle: '@sample_user', truncated: true,
        media: [], url: `https://x.com/sample_user/status/${i}`,
      },
    }]))));
  storage.setAccountScope('sample_other');
});
afterEach(() => vi.restoreAllMocks());

it.each(['truncated', 'complete', 'absent'])('lookup は %s を ID で確認し全件一覧を作らない', async (kind) => {
  await storage.getBookmarkOf('me', '0'); // 初回の移行確認は対象外。
  if (kind === 'complete') storedBookmarks(data)['me:1'].snapshot.truncated = false;
  const tweetId = kind === 'absent' ? '6000' : '1';
  const all = vi.spyOn(storage, 'listAllTruncated');
  const one = vi.spyOn(storage, 'getBookmarkOf');
  const get = vi.spyOn(chrome.storage.local, 'get');
  const result = await defaultDeps().lookup({ accountId: 'me', tweetId });
  expect(all.mock.calls.length).toBe(0);
  expect(one).toHaveBeenCalledExactlyOnceWith('me', tweetId);
  // 対象のポストの値だけを読む。
  expect((get.mock.calls as unknown as [string][]).map(([key]) => key)).toEqual(['bm:me:' + tweetId]);
  if (kind === 'truncated') expect(result).toEqual(storedBookmarks(data)['me:1']);
  else expect(result).toBeUndefined();
  expect(storage.getAccountScope()).toBe('sample_other');
});
