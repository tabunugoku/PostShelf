import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { RECENT_ID, authorHandles, countFolder, hasActiveFilters, matchesFilters, queryBookmarks } from '../src/shared/query';
import { dismissImportHint, getImportHint, getSettings, recordPending, shouldShowImportHint, updateSettings } from '../src/shared/settings';
import { extractTweet } from '../src/content/snapshot';
import type { Bookmark } from '../src/shared/models';

const DAY = 86400000;
const NOW = 1_800_000_000_000;
const mk = (id: string, handle: string, over: Partial<Bookmark['snapshot']> = {}, savedAt = NOW, folderIds = ['f']): Bookmark => ({
  accountId: 'unknown',
  tweetId: id,
  folderIds,
  savedAt,
  snapshot: { text: `text ${id}`, author: handle.slice(1), handle, media: [], url: `u${id}`, ...over },
});

describe('filters (AND)', () => {
  const all = [
    mk('1', '@a', { media: ['x.jpg'], hasVideo: true }),
    mk('2', '@a', { media: ['y.jpg'], hasLink: true }),
    mk('3', '@b', { hasLink: true, hasVideo: false }),
    mk('4', '@b', { media: ['z.jpg'] }), // 旧データ: hasVideo / hasLink が未定義 (未判定)
  ];
  const ids = (f: Parameters<typeof matchesFilters>[1]) => queryBookmarks(all, { folderId: 'all', search: '', sort: 'savedAsc', filters: f, now: NOW }).map((b) => b.tweetId).sort();

  it('image / video / link each filter on their own', () => {
    expect(ids({ image: true })).toEqual(['1', '2', '4']);
    expect(ids({ video: true })).toEqual(['1']);
    expect(ids({ link: true })).toEqual(['2', '3']);
  });
  it('combines with AND, including the author', () => {
    expect(ids({ image: true, link: true })).toEqual(['2']);
    expect(ids({ image: true, handle: '@b' })).toEqual(['4']);
    expect(ids({ link: true, handle: '@A' })).toEqual(['2']); // ハンドルは大文字小文字を区別しない
    expect(ids({ video: true, link: true })).toEqual([]);
  });
  it('legacy posts without hasVideo / hasLink never show up under those filters, but image still works', () => {
    expect(matchesFilters(all[3], { video: true })).toBe(false);
    expect(matchesFilters(all[3], { link: true })).toBe(false);
    expect(matchesFilters(all[3], { image: true })).toBe(true);
  });
  it('hasActiveFilters', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ handle: '@a' })).toBe(true);
    expect(hasActiveFilters({ image: false })).toBe(false);
  });
});

describe('smart views and authors', () => {
  const all = [mk('1', '@a', {}, NOW - 1 * DAY), mk('2', '@a', {}, NOW - 7 * DAY), mk('3', '@b', {}, NOW - 8 * DAY, ['inbox']), mk('4', '@c', {}, NOW - 6 * DAY, ['inbox'])];
  it('"last 7 days" uses savedAt', () => {
    expect(countFolder(all, RECENT_ID, NOW)).toBe(3);
    expect(queryBookmarks(all, { folderId: RECENT_ID, search: '', sort: 'savedDesc', now: NOW }).map((b) => b.tweetId)).toEqual(['1', '4', '2']);
  });
  it('inbox counts only posts in 未分類', () => {
    expect(countFolder(all, 'inbox', NOW)).toBe(2);
    expect(countFolder(all, 'all', NOW)).toBe(4);
  });
  it('authors are listed by count then name', () => {
    expect(authorHandles(all).map((a) => [a.handle, a.count])).toEqual([['@a', 2], ['@b', 1], ['@c', 1]]);
  });
  it('search matches text and @handle', () => {
    expect(queryBookmarks(all, { folderId: 'all', search: '@b', sort: 'savedDesc', now: NOW }).map((b) => b.tweetId)).toEqual(['3']);
  });
});

describe('persisted view state (chrome.storage.local, not localStorage)', () => {
  beforeEach(() => installChromeMock());
  it('defaults and persists last folder / view mode / sort', async () => {
    expect(await getSettings()).toMatchObject({ lastFolderId: 'all', viewMode: 'post', sortKey: 'savedDesc' });
    await updateSettings({ lastFolderId: 'f1', viewMode: 'grid', sortKey: 'postedAsc' });
    expect(await getSettings()).toMatchObject({ lastFolderId: 'f1', viewMode: 'grid', sortKey: 'postedAsc' });
    await updateSettings({ viewMode: 'x' as never, sortKey: 'y' as never });
    expect(await getSettings()).toMatchObject({ viewMode: 'post', sortKey: 'savedDesc' });
  });
});

describe('import banner state', () => {
  beforeEach(() => installChromeMock());
  it('shows only while pending is above the count at dismissal', async () => {
    await recordPending('a', 12);
    expect(shouldShowImportHint(await getImportHint('a'))).toBe(true);
    await dismissImportHint('a');
    expect(shouldShowImportHint(await getImportHint('a'))).toBe(false);
    await recordPending('a', 12);
    expect(shouldShowImportHint(await getImportHint('a'))).toBe(false); // 増えていない
    await recordPending('a', 13);
    expect(shouldShowImportHint(await getImportHint('a'))).toBe(true); // 新しく増えた
  });
  it('a lower count (after importing) resets the baseline so later growth shows again', async () => {
    await recordPending('a', 12);
    await dismissImportHint('a');
    await recordPending('a', 0);
    expect(await getImportHint('a')).toEqual({ pending: 0, dismissed: 0 });
    await recordPending('a', 3);
    expect(shouldShowImportHint(await getImportHint('a'))).toBe(true);
  });
});

describe('snapshot hasVideo / hasLink', () => {
  const art = (inner: string) => {
    document.body.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name"><span>U</span><a href="/u/status/1"><time datetime="2026-01-01T00:00:00Z"></time></a></div>${inner}</article>`;
    return extractTweet(document.querySelector('article')!)!.snapshot;
  };
  it('detects video, link card and body links (booleans only)', () => {
    expect(art('<div data-testid="tweetText">plain</div>')).toMatchObject({ hasVideo: false, hasLink: false });
    expect(art('<div data-testid="videoPlayer"><video></video></div>')).toMatchObject({ hasVideo: true });
    expect(art('<div data-testid="card.wrapper"></div>')).toMatchObject({ hasLink: true });
    expect(art('<div data-testid="tweetText"><a href="https://t.co/abc">t.co/abc</a></div>')).toMatchObject({ hasLink: true });
    expect(art('<div data-testid="tweetText"><a href="/hashtag/x">#x</a> <a href="/someone">@someone</a></div>')).toMatchObject({ hasLink: false });
  });
});
