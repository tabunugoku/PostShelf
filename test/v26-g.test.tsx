import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { openPopover } from '../src/content/popover';
import { cachePostById } from '../src/shared/cacheops';
import { INBOX_ID } from '../src/shared/models';
import { updateSettings } from '../src/shared/settings';
import { createFolder, getAccountScope, getBookmark, getBookmarkOf, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const flush = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const fixture = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
const snapshot = { text: 'こんにちは', author: '山田', handle: '@yamada', media: [], url: 'https://x.com/yamada/status/1234567890', truncated: true };

describe('v26-G: SaveCurrent', () => {
  let calls: ReturnType<typeof installPanelMock>;
  beforeEach(async () => {
    installChromeMock();
    calls = installPanelMock();
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    (globalThis as any).chrome.tabs = {
      query: async () => [{ id: 5, url: 'https://x.com/yamada/status/1234567890' }],
      sendMessage: vi.fn(async (_id: number, m: any) => (m.type === 'getPostSnapshot' ? { ok: true, tweetId: '1234567890', snapshot } : { ok: true })),
      onActivated: { addListener() {}, removeListener() {} },
      onUpdated: { addListener() {}, removeListener() {} },
      create: async () => ({}),
    };
  });

  it('unchecking every folder keeps the post as 「未分類」; the cache / full-text requests go out only for the first save', async () => {
    const f = await createFolder({ name: 'Dev' });
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="sidepanel" />, $('#app')));
    await flush();
    await flush();
    await flush();
    const chip = () => $$<HTMLElement>('.ap-chip').find((l) => l.textContent?.includes('Dev'))!;
    const toggle = async (on: boolean) => {
      expect(chip().getAttribute('aria-pressed')).toBe(String(!on));
      await act(() => void chip().click());
      await flush();
    };
    await toggle(true);
    await toggle(false);
    expect((await getBookmark('1234567890'))!.folderIds).toEqual([INBOX_ID]);
    await toggle(true);
    const sent = (t: string) => calls.messages.filter((m: any) => m.type === t);
    expect(sent('cacheImages')).toHaveLength(1);
    expect(sent('fetchFullText')).toHaveLength(1);
    expect(sent('pruneCache')).toHaveLength(0);
    expect(f.id).toBeTruthy();
  });
});

describe('v26-G: cachePostById does not swap the global account scope', () => {
  it('two accounts at the same time: each reads its own post, and the scope stays', async () => {
    installChromeMock();
    setAccountScope('a');
    await setBookmarkFolders('1', [], { ...snapshot, media: ['https://pbs.twimg.com/a.jpg'] });
    setAccountScope('b');
    await setBookmarkFolders('2', [], { ...snapshot, media: ['https://pbs.twimg.com/b.jpg'] });
    setAccountScope('keep');
    await updateSettings({ imageCache: { enabled: true } as never });
    const scopes: string[] = [];
    const watch = setInterval(() => scopes.push(getAccountScope()), 0);
    await Promise.all([cachePostById('1', 'a'), cachePostById('2', 'b'), cachePostById('1', 'b')]).catch(() => {});
    clearInterval(watch);
    expect(getAccountScope()).toBe('keep');
    expect(scopes.every((s) => s === 'keep')).toBe(true);
    expect((await getBookmarkOf('a', '1'))?.tweetId).toBe('1');
    expect(await getBookmarkOf('b', '1')).toBeUndefined();
  });
});

describe('v26-G: the popover', () => {
  beforeEach(() => {
    installChromeMock();
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = fixture;
  });
  const article = () => document.querySelector('article')!;
  const anchor = () => document.querySelector<HTMLElement>('[data-testid=bookmark], [data-testid=removeBookmark]')!;

  it('「PostShelf の保存を削除」 after an account switch does nothing and closes the popover', async () => {
    await setBookmarkFolders('1234567890', [], { ...snapshot });
    const pop = (await openPopover(article(), anchor()))!;
    const unsave = pop.querySelector<HTMLElement>('button[aria-label="PostShelf の保存を削除"]')!;
    setAccountScope('me');
    // アカウントの切り替え (購読者によりポップオーバーも閉じるが、すでに押されたあとの経路も確かめる)
    setCurrentAccount({ id: 'other', handle: 'other', lastSeenAt: 1 });
    setAccountScope('other');
    unsave.click();
    await flush();
    setAccountScope('me');
    expect(await getBookmark('1234567890')).toBeDefined();
    expect(document.querySelector('.postshelf-popover')).toBeNull();
  });

  it('pressing twice quickly opens only one popover', async () => {
    const a = openPopover(article(), anchor());
    const b = openPopover(article(), anchor());
    await Promise.all([a, b]);
    expect(document.querySelectorAll('.postshelf-popover')).toHaveLength(1);
  });
});
