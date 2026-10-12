import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { extractTweet, fillSource, type Extracted } from '../src/content/snapshot';
import { fillMissing, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import type { Snapshot } from '../src/shared/models';
import { loadFixture } from './v50-helpers';

let data: Record<string, any>;
let incoming: Extracted;
beforeEach(() => {
  data = installChromeMock();
  Object.assign(data, { schemaVersion: 2, folderIdsRepaired: true, folders: [], bookmarks: {} });
  setAccountScope('me');
  loadFixture('v57-quote-fill.html');
  incoming = extractTweet(document.querySelector('article')!)!;
});
afterEach(() => vi.restoreAllMocks());
const seed = (snapshot: Snapshot) => {
  data.bookmarks = { 'me:1': { accountId: 'me', tweetId: '1', savedAt: 1, folderIds: ['sample_folder'], snapshot } };
};
const fill = () => fillMissing([{ tweetId: '1', snapshot: fillSource(incoming) }], 'me');

it('画像つきの保存済みポストに引用候補が見えても quote を追加しない', async () => {
  expect(incoming.snapshot.quote).toMatchObject({ handle: '@sample_source' });
  const { quote: _, ...plain } = incoming.snapshot;
  seed(plain);
  const before = structuredClone(data.bookmarks);
  expect(await fill()).toBe(0);
  expect(data.bookmarks).toEqual(before);
  expect(data.bookmarks['me:1'].snapshot.media).toEqual(['https://pbs.twimg.com/media/sample-main-v57.jpg']);
});

it('本体のアイコンを補う書き込みでも quote がないポストへ追加しない', async () => {
  const { quote: _, avatar: __, ...plain } = incoming.snapshot;
  seed(plain);
  expect(await fill()).toBe(1);
  expect(data.bookmarks['me:1'].snapshot.avatar).toBe(incoming.snapshot.avatar);
  expect(data.bookmarks['me:1'].snapshot.quote).toBeUndefined();
});

it('保存済みの引用の空の画像とアイコンは補い本文と URL は維持する', async () => {
  const quote = incoming.snapshot.quote!;
  const original = {
    ...quote, text: '架空の保存済み引用本文。', avatar: undefined, media: [],
    url: 'https://x.com/sample_source/status/20', createdAt: '2025-01-01',
  };
  seed({ ...incoming.snapshot, quote: original });
  expect(await fill()).toBe(1);
  expect(data.bookmarks['me:1'].snapshot.quote).toEqual({ ...original, avatar: quote.avatar, media: quote.media });
});

it('新規保存時には引用を引き続き保存する', async () => {
  await setBookmarkFolders('1', ['sample_folder'], incoming.snapshot);
  expect(data.bookmarks['me:1'].snapshot.quote).toEqual(incoming.snapshot.quote);
});
