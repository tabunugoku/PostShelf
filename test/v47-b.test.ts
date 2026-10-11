import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { collectVisible } from '../src/content/collect';
import { VisibleMediaBackfill } from '../src/content/media';
import { fillMissing, getFillViews, setAccountScope } from '../src/shared/storage';

const avatar = 'https://pbs.twimg.com/profile_images/sample-late.jpg';
let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
  data.schemaVersion = 2;
  data.folderIdsRepaired = true;
  setAccountScope('me');
  document.body.innerHTML = readFileSync('test/fixtures/v47-avatar.html', 'utf8');
  data.bookmarks = {
    'me:301': {
      accountId: 'me', tweetId: '301', savedAt: 1, folderIds: ['sample-folder'],
      snapshot: { text: '架空の保存済み本文', author: 'Sample', handle: '@sample_avatar', media: [], createdAt: '2026-01-01', url: 'https://x.com/sample_avatar/status/301' },
    },
  };
});
const watcher = () => {
  const fill = vi.fn(fillMissing);
  const w = new VisibleMediaBackfill({
    now: () => 0, accountId: () => 'me', path: () => '/home', visible: () => collectVisible(), fillViews: getFillViews, backfill: fill,
  });
  return { w, fill };
};
const load = (img: HTMLImageElement, src: string) => {
  img.setAttribute('src', src);
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48, configurable: true });
};

it('waits for the avatar to finish loading, then fills it', async () => {
  const r = watcher();
  const img = document.querySelector('img')!;
  img.setAttribute('src', avatar);
  Object.defineProperty(img, 'complete', { value: false, configurable: true });
  expect(await r.w.update()).toBe(0);
  expect(r.fill).not.toHaveBeenCalled();
  load(img, avatar);
  expect(await r.w.update()).toBe(1);
  expect((data.bookmarks as any)['me:301'].snapshot.avatar).toBe(avatar);
});

it('does not use an empty src as the avatar', async () => {
  const r = watcher();
  expect(await r.w.update()).toBe(0);
  expect((data.bookmarks as any)['me:301'].snapshot.avatar).toBeUndefined();
});

it('targets a post that only lacks its avatar', async () => {
  const r = watcher();
  load(document.querySelector('img')!, avatar);
  await r.w.update();
  expect(r.fill).toHaveBeenCalledTimes(1);
});
