import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as storage from '../src/shared/storage';
import type { Snapshot } from '../src/shared/models';

const image = 'https://pbs.twimg.com/media/sample.jpg';
const poster = 'https://pbs.twimg.com/media/sample-video.jpg';
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({ text: '架空の本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/123', ...extra });
let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
  data.schemaVersion = 2; data.folderIdsRepaired = true;
  storage.setAccountScope('me');
});
const seed = (snapshot: Snapshot, accountId = 'me') => {
  const b = { accountId, tweetId: '123', savedAt: 77, folderIds: ['sample-folder'], snapshot };
  data.bookmarks = { ...(data.bookmarks as object), [`${accountId}:123`]: b };
  return structuredClone(b);
};
const fill = (snapshot: Snapshot, accountId = 'me') => storage.fillMissing([{ tweetId: '123', snapshot }], accountId);

it.each([
  [snap(), snap({ media: [image], text: '別の架空の本文', translated: true }), { media: [image] }],
  [snap({ hasVideo: true }), snap({ videoPoster: poster, media: [image] }), { hasVideo: true, videoPoster: poster }],
  [snap(), snap({ hasVideo: true, videoPoster: poster }), { hasVideo: true, videoPoster: poster }],
  [snap(), snap({ hasVideo: true }), { hasVideo: true }],
])('fills only missing media fields (%#)', async (old, incoming, patch) => {
  const before = seed(old);
  const other = seed(snap(), 'sample_other');
  const set = vi.spyOn(chrome.storage.local, 'set');
  expect(await fill(incoming)).toBe(1);
  expect(data.bookmarks).toEqual({ 'me:123': { ...before, snapshot: { ...old, ...patch } }, 'sample_other:123': other });
  expect(set).toHaveBeenCalledTimes(1);
});

it.each([
  [snap({ media: [image] }), snap({ media: [poster], hasVideo: true, videoPoster: poster })],
  [snap({ hasVideo: true, videoPoster: poster }), snap({ media: [image], videoPoster: image })],
  [snap({ hasVideo: true }), snap({ media: [image], videoPoster: 'http://example.test/poster.jpg' })],
  [snap(), snap()],
])('does not overwrite existing fields or write empty results (%#)', async (old, incoming) => {
  const before = seed(old);
  const set = vi.spyOn(chrome.storage.local, 'set');
  expect(await fill(incoming)).toBe(0);
  expect(data.bookmarks).toEqual({ 'me:123': before });
  expect(set).not.toHaveBeenCalled();
});

it('never creates an unsaved post and captures the explicit account', async () => {
  const old = seed(snap(), 'sample_other');
  expect(await fill(snap({ media: [image] }))).toBe(0);
  expect(data.bookmarks).toEqual({ 'sample_other:123': old });
});

it('addCollected remains fresh-only, and concurrent writes are preserved', async () => {
  const old = seed(snap({ translated: true, quote: { author: 'Sample Quote', handle: '@sample_quote', text: '架空の引用', media: [] } }));
  expect(await storage.addCollected([{ tweetId: '123', snapshot: snap({ media: [image] }) }], 999, 'me')).toBe(0);
  expect((data.bookmarks as any)['me:123']).toEqual(old);
  await Promise.all([fill(snap({ media: [image] })), storage.addCollected([{ tweetId: '124', snapshot: snap() }], 999, 'me')]);
  expect((data.bookmarks as any)['me:123']).toEqual({ ...old, snapshot: { ...old.snapshot, media: [image] } });
  expect((data.bookmarks as any)['me:124'].snapshot).toEqual(snap());
});

it('serial backfills preserve both media updates', async () => {
  seed(snap());
  await Promise.all([fill(snap({ media: [image] })), fill(snap({ media: [poster] }))]);
  expect((data.bookmarks as any)['me:123'].snapshot.media).toEqual([image]);
});
