import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { collectVisible, isBookmarksPage } from '../src/content/collect';
import { displayName } from '../src/shared/models';
import { addCollected, createFolder, exportData, importData, listBookmarks, listFolders, setBookmarkFolders } from '../src/shared/storage';

const snap = { text: 't', author: 'a', handle: '@a', media: [], url: 'u' };
beforeEach(() => installChromeMock());

describe('export/import', () => {
  it('round-trips', async () => {
    const f = await createFolder({ name: 'x' });
    await setBookmarkFolders('1', [f.id], snap);
    const dump = JSON.parse(JSON.stringify(await exportData()));
    installChromeMock();
    expect(await importData(dump)).toBe(1);
    expect((await listFolders()).map(displayName)).toEqual(['すべて', 'x']);
    expect((await listBookmarks())[0].tweetId).toBe('1');
  });
  it('rejects bad input and skips invalid entries', async () => {
    await expect(importData({ foo: 1 })).rejects.toThrow();
    await expect(importData(null)).rejects.toThrow();
    const n = await importData({ app: 'PostShelf', folders: [{ id: 'all' }], bookmarks: [{ tweetId: 1 }] });
    expect(n).toBe(0);
    expect((await listFolders()).length).toBe(1);
  });
});

describe('collect', () => {
  it('collects visible posts into the inbox without overwriting existing ones', async () => {
    document.body.innerHTML = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
    const items = collectVisible();
    expect(items.length).toBe(1);
    expect(await addCollected(items)).toBe(1);
    expect(await addCollected(items)).toBe(0);
    expect((await listFolders()).some((f) => displayName(f) === '未分類')).toBe(true);
  });
  it('detects the bookmarks page', () => {
    expect(isBookmarksPage('/i/bookmarks')).toBe(true);
    expect(isBookmarksPage('/home')).toBe(false);
  });
});
