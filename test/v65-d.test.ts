import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { targetsOf } from '../src/shared/cacheops';
import * as storage from '../src/shared/storage';
import type { Snapshot } from '../src/shared/models';

const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  text: '架空の本文',
  author: 'Sample',
  handle: '@sample_one',
  media: [],
  url: 'https://x.com/sample_one/status/1',
  ...extra,
});

describe('画像キャッシュの対象', () => {
  it('pbs.twimg.com 以外の画像は対象にしない', () => {
    expect(targetsOf(snap({ media: ['https://example.invalid/a.jpg'] }), 'large')).toEqual([]);
  });

  it('pbs.twimg.com の画像は従来どおり対象になる', () => {
    const urls = targetsOf(snap({ media: ['https://pbs.twimg.com/media/a?format=jpg&name=small'] }), 'large').map((t) => t.url);
    expect(urls).toEqual(['https://pbs.twimg.com/media/a?format=jpg&name=large']);
  });

  it('対象外が混ざっても、残る画像の名前 (位置の番号) は変わらない', () => {
    const media = ['https://example.invalid/a.jpg', 'https://pbs.twimg.com/media/b?format=jpg&name=small'];
    expect(targetsOf(snap({ media }), 'large').map((t) => t.name)).toEqual(['2']);
  });

  it('動画のサムネイルも pbs.twimg.com だけ対象にする', () => {
    expect(targetsOf(snap({ videoPoster: 'https://example.invalid/p.jpg' }), 'large')).toEqual([]);
    expect(targetsOf(snap({ videoPoster: 'https://pbs.twimg.com/ext_tw_video_thumb/1/p.jpg' }), 'large')).toHaveLength(1);
  });
});

describe('取り込む snapshot の省略できる項目', () => {
  beforeEach(() => {
    const data = installChromeMock();
    data.schemaVersion = 2;
    data.folderIdsRepaired = true;
    storage.setAccountScope('me');
  });

  const importWith = async (extra: Record<string, unknown>) => {
    const bookmark = { accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 1, snapshot: { ...snap(), ...extra } };
    await storage.importData({ app: 'PostShelf', version: 2, exportedAt: 1, accounts: [], folders: [], bookmarks: [bookmark] });
    return (await storage.listBookmarks())[0].snapshot as unknown as Record<string, unknown>;
  };

  it.each(['http://example.invalid/p.jpg', 'data:image/png;base64,AAAA', 42])('https でない videoPoster %j は捨てる', async (poster) => {
    expect((await importWith({ videoPoster: poster })).videoPoster).toBeUndefined();
  });

  it('https の videoPoster は残す', async () => {
    expect((await importWith({ videoPoster: 'https://pbs.twimg.com/p.jpg' })).videoPoster).toBe('https://pbs.twimg.com/p.jpg');
  });

  it('boolean でない hasVideo / hasLink と、文字列でない createdAt は捨てる', async () => {
    const s = await importWith({ hasVideo: 'yes', hasLink: 1, createdAt: 123 });
    expect(s.hasVideo).toBeUndefined();
    expect(s.hasLink).toBeUndefined();
    expect(s.createdAt).toBeUndefined();
  });

  it('正しい hasVideo / hasLink / createdAt は残す', async () => {
    const s = await importWith({ hasVideo: true, hasLink: false, createdAt: '2026-01-01T00:00:00Z' });
    expect(s).toMatchObject({ hasVideo: true, hasLink: false, createdAt: '2026-01-01T00:00:00Z' });
  });
});
