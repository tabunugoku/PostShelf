// 版: v47-c
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { updateFromStatusPage } from '../src/content/fulltext';
import { setAccountScope } from '../src/shared/storage';

const avatar = 'https://pbs.twimg.com/profile_images/sample-page.jpg';
let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
  seedBookmarks(data, []);
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  setAccountScope('me');
  history.pushState(null, '', '/sample_avatar/status/301');
  document.body.innerHTML = readFileSync('test/fixtures/v47-avatar.html', 'utf8');
  seedBookmarks(data, Object.values({
    'me:301': {
      accountId: 'me', tweetId: '301', savedAt: 1, folderIds: ['sample-folder'],
      snapshot: {
        text: '架空の保存済み本文',
        author: 'Sample',
        handle: '@sample_avatar',
        media: [],
        createdAt: '2026-01-01',
        url: 'https://x.com/sample_avatar/status/301',
      },
    },
  }));
});

it('fills the avatar of a saved main post that is not truncated', async () => {
  const img = document.querySelector('img')!;
  img.setAttribute('src', avatar);
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48, configurable: true });
  expect(await updateFromStatusPage()).toBe(false); // 全文の更新は行わない
  const saved = (storedBookmarks(data) as any)['me:301'].snapshot;
  expect(saved.avatar).toBe(avatar);
  expect(saved.text).toBe('架空の保存済み本文');
});
