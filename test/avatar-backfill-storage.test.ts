// 版: v47-a
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as storage from '../src/shared/storage';
import type { Snapshot } from '../src/shared/models';

const avatar = 'https://pbs.twimg.com/profile_images/sample.jpg';
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  text: '架空の本文',
  author: 'Sample',
  handle: '@sample_user',
  media: [],
  url: 'https://x.com/sample_user/status/123',
  ...extra,
});
const quote = (extra = {}) => ({
  author: 'Sample Quote',
  handle: '@sample_quote',
  text: '架空の引用',
  media: [],
  ...extra,
});
let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
  data.schemaVersion = 2;
  data.folderIdsRepaired = true;
  storage.setAccountScope('me');
});
const seed = (snapshot: Snapshot, accountId = 'me') => {
  const b = { accountId, tweetId: '123', savedAt: 77, folderIds: ['sample-folder'], snapshot };
  data.bookmarks = { ...(data.bookmarks as object), [`${accountId}:123`]: b };
  return structuredClone(b);
};
const fill = (snapshot: Snapshot, accountId = 'me') => storage.fillMissing([{ tweetId: '123', snapshot }], accountId);
const saved = () => (data.bookmarks as any)['me:123'];

it('fills a missing avatar without touching text or folders', async () => {
  const before = seed(snap());
  expect(await fill(snap({ avatar, text: '別の本文' }))).toBe(1);
  expect(saved()).toEqual({ ...before, snapshot: { ...before.snapshot, avatar } });
});

it('keeps an existing avatar and writes nothing when nothing is missing', async () => {
  const before = seed(snap({ avatar }));
  const set = vi.spyOn(chrome.storage.local, 'set');
  expect(await fill(snap({ avatar: 'https://pbs.twimg.com/profile_images/other.jpg' }))).toBe(0);
  expect(saved()).toEqual(before);
  expect(set).not.toHaveBeenCalled();
});

it('never creates an unsaved post', async () => {
  const old = seed(snap(), 'sample_other');
  expect(await fill(snap({ avatar }))).toBe(0);
  expect(data.bookmarks).toEqual({ 'sample_other:123': old });
});

it('drops an http avatar', async () => {
  const before = seed(snap());
  expect(await fill(snap({ avatar: 'http://example.test/a.jpg' }))).toBe(0);
  expect(saved()).toEqual(before);
});

it('fills the author when it was a stand-in for the handle', async () => {
  seed(snap({ author: 'sample_user' }));
  expect(await fill(snap({ author: 'Sample Name' }))).toBe(1);
  expect(saved().snapshot.author).toBe('Sample Name');
});

it('does not overwrite an author that already differs from the handle', async () => {
  seed(snap({ author: 'Old Name' }));
  expect(await fill(snap({ author: 'Sample Name' }))).toBe(0);
  expect(saved().snapshot.author).toBe('Old Name');
});

it('fills createdAt and hasLink only when they are missing', async () => {
  seed(snap());
  expect(await fill(snap({ createdAt: '2026-01-01', hasLink: true }))).toBe(1);
  expect(saved().snapshot).toMatchObject({ createdAt: '2026-01-01', hasLink: true });
  expect(await fill(snap({ createdAt: '2026-02-02', hasLink: false }))).toBe(0);
  expect(saved().snapshot.createdAt).toBe('2026-01-01');
});

it('保存済みポストに引用が無ければ補完で追加しない', async () => {
  seed(snap());
  expect(await fill(snap({ quote: quote({ avatar }) }))).toBe(0);
  expect(saved().snapshot.quote).toBeUndefined();
});

it('fills only the empty fields of an existing quote', async () => {
  const image = 'https://pbs.twimg.com/media/sample.jpg';
  seed(snap({ quote: quote({ createdAt: '2026-01-01' }) }));
  const incoming = quote({ avatar, media: [image], createdAt: '2026-09-09', text: '別の引用' });
  expect(await fill(snap({ quote: incoming }))).toBe(1);
  expect(saved().snapshot.quote).toEqual(quote({ avatar, media: [image], createdAt: '2026-01-01' }));
});

it('ignores an invalid quote from the screen', async () => {
  seed(snap());
  expect(await fill(snap({ quote: { ...quote(), url: 'https://example.test/x' } }))).toBe(0);
  expect(saved().snapshot.quote).toBeUndefined();
});

it('getFillViews returns only the fill fields of the given account', async () => {
  seed(snap({ avatar }));
  seed(snap(), 'sample_other');
  const views = await storage.getFillViews('me');
  expect([...views.keys()]).toEqual(['123']);
  expect(views.get('123')).not.toHaveProperty('text');
  expect(views.get('123')?.avatar).toBe(avatar);
});
