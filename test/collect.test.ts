import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { collectVisible, ensureCollectButton, refreshCollectButton, unsavedItems, watchPath } from '../src/content/collect';
import { createFolder, getSavedIds, setBookmarkFolders } from '../src/shared/storage';

const fixture = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
const article = (id: number) =>
  `<article data-testid="tweet"><div data-testid="User-Name"><span>U${id}</span><a href="/u${id}/status/${id}"><time datetime="2026-10-01T00:00:00Z"></time></a></div><div data-testid="tweetText">t${id}</div></article>`;
const snap = { text: 't', author: 'a', handle: '@a', media: [], url: 'u' };
const tick = () => new Promise((r) => setTimeout(r, 20));
const btn = () => document.querySelector<HTMLButtonElement>('.postshelf-collect')!;

beforeEach(() => {
  installChromeMock();
  history.pushState({}, '', '/i/history');
});
afterEach(() => {
  document.querySelector('.postshelf-collect')?.remove();
  history.pushState({}, '', '/');
  vi.useRealTimers();
});

describe('unsavedItems', () => {
  it('counts only posts that are not saved yet (mixed saved / unsaved)', () => {
    document.body.innerHTML = [1, 2, 3, 4].map(article).join('');
    const items = collectVisible();
    expect(unsavedItems(items, new Set(['2', '4'])).map((x) => x.tweetId)).toEqual(['1', '3']);
    expect(unsavedItems(items, new Set(['1', '2', '3', '4']))).toEqual([]);
    expect(unsavedItems([], new Set(['1']))).toEqual([]);
  });
});

describe('collect button', () => {
  it('shows "未取り込み N 件" for posts not saved yet', async () => {
    document.body.innerHTML = [1, 2, 3].map(article).join('');
    const f = await createFolder({ name: 'a' });
    await setBookmarkFolders('2', [f.id], snap);
    ensureCollectButton();
    await tick();
    expect(btn().textContent).toBe('未取り込み 2 件');
    expect(btn().disabled).toBe(false);
    expect(btn().title).toContain('取り込む');
  });

  it('shows "すべて取り込み済み" (disabled) when everything on screen is saved', async () => {
    document.body.innerHTML = article(5);
    const f = await createFolder({ name: 'a' });
    await setBookmarkFolders('5', [f.id], snap);
    ensureCollectButton();
    await tick();
    expect(btn().textContent).toBe('すべて取り込み済み');
    expect(btn().disabled).toBe(true);
  });

  it('click imports into 未分類 without duplicating, shows the result, then returns to the count', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    document.body.innerHTML = [1, 2].map(article).join('');
    const f = await createFolder({ name: 'a' });
    await setBookmarkFolders('1', [f.id], snap);
    ensureCollectButton();
    await vi.advanceTimersByTimeAsync(10);
    expect(btn().textContent).toBe('未取り込み 1 件');
    btn().click();
    await vi.advanceTimersByTimeAsync(10);
    expect(btn().textContent).toBe('1 件を「未分類」として取り込みました');
    expect([...(await getSavedIds())].sort()).toEqual(['1', '2']);
    expect((await (async () => (await chrome.storage.local.get('bookmarks')).bookmarks['1'].folderIds)())).toEqual([f.id]); // 既存は触らない
    await vi.advanceTimersByTimeAsync(3100);
    expect(btn().textContent).toBe('すべて取り込み済み');
  });

  it('updates when new posts appear (scrolling) via refresh', async () => {
    document.body.innerHTML = article(1);
    ensureCollectButton();
    await tick();
    expect(btn().textContent).toBe('未取り込み 1 件');
    document.body.insertAdjacentHTML('afterbegin', article(2) + article(3));
    await refreshCollectButton();
    expect(btn().textContent).toBe('未取り込み 3 件');
  });

  it('is not shown outside the bookmarks page', () => {
    history.pushState({}, '', '/home');
    document.body.innerHTML = fixture;
    ensureCollectButton();
    expect(document.querySelector('.postshelf-collect')).toBeNull();
  });
});

describe('bookmarks page URLs (v9-A)', () => {
  const at = (path: string) => {
    history.pushState({}, '', path);
    document.body.innerHTML = article(1);
    ensureCollectButton();
    return !!document.querySelector('.postshelf-collect');
  };
  it('shows on /i/history (with or without a trailing slash) and on the legacy /i/bookmarks', () => {
    expect(at('/i/history')).toBe(true);
    document.querySelector('.postshelf-collect')?.remove();
    expect(at('/i/history/')).toBe(true);
    document.querySelector('.postshelf-collect')?.remove();
    expect(at('/i/bookmarks')).toBe(true);
  });
  it('does not show on the likes tab or on other pages', () => {
    expect(at('/i/history/likes')).toBe(false);
    expect(at('/home')).toBe(false);
    expect(at('/i/historyx')).toBe(false);
  });
  it('follows SPA navigation between the tabs: gone on likes, back on bookmarks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    document.body.innerHTML = article(1);
    ensureCollectButton();
    expect(!!document.querySelector('.postshelf-collect')).toBe(true);
    const stop = watchPath(100);
    history.pushState({}, '', '/i/history/likes');
    await vi.advanceTimersByTimeAsync(150);
    expect(document.querySelector('.postshelf-collect')).toBeNull();
    history.pushState({}, '', '/i/history');
    await vi.advanceTimersByTimeAsync(150);
    expect(!!document.querySelector('.postshelf-collect')).toBe(true);
    stop();
  });
});
