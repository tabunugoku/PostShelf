// 版: v59-b
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import type { Bookmark } from '../src/shared/models';

let data: Record<string, unknown>;
let update: typeof import('../src/content/fulltext').updateFromStatusPage;
let install: typeof import('../src/content/fulltext').installFullTextWatcher;
let setAccount: typeof import('../src/content/account').setCurrentAccount;
let reads: () => number;
let fills: () => number;
let notify: MutationCallback;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  data = installChromeMock();
  seedBookmarks(data, []);
  document.body.innerHTML = readFileSync('test/fixtures/v59-status.html', 'utf8');
  history.replaceState(null, '', '/sample_status/status/5901');
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) { notify = callback; }
    observe() {}
  });
  const account = await import('../src/content/account');
  setAccount = account.setCurrentAccount;
  setAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  const fulltext = await import('../src/content/fulltext');
  update = fulltext.updateFromStatusPage;
  install = fulltext.installFullTextWatcher;
  const storage = await import('../src/shared/storage');
  const fill = vi.spyOn(storage, 'fillMissing');
  const get = vi.spyOn(chrome.storage.local, 'get');
  reads = () => (get.mock.calls as unknown as [string | string[] | null][])
    .filter(([key]) => (typeof key === 'string' && key.startsWith('bm:'))
      || (Array.isArray(key) && key.some((key) => key.startsWith('bm:')))).length;
  fills = () => fill.mock.calls.length;
  const bookmarks: Record<string, Bookmark> = {};
  for (const accountId of ['me', 'sample_other']) {
    for (const tweetId of ['5901', '5902']) {
      bookmarks[`${accountId}:${tweetId}`] = {
        accountId,
        tweetId,
        folderIds: ['sample_folder'],
        savedAt: 100,
        snapshot: {
          author: 'Sample Status',
          handle: '@sample_status',
          text: '架空の省略された本文',
          media: [],
          url: `https://x.com/sample_status/status/${tweetId}`,
          truncated: true,
        },
      };
    }
  }
  seedBookmarks(data, Object.values(bookmarks));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function show(tweetId: string): void {
  history.replaceState(null, '', `/sample_status/status/${tweetId}`);
  document.getElementById('status-link')!.setAttribute('href', `/sample_status/status/${tweetId}`);
}

function readyAvatar(): void {
  const img = document.createElement('img');
  img.src = 'https://pbs.twimg.com/profile_images/sample-status.jpg';
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48 });
  document.getElementById('avatar-host')!.append(img);
}

it('アイコンだけの保留が解けたら、画像が保留中でも欠けたアイコンを補完する', async () => {
  document.body.innerHTML = readFileSync('test/fixtures/v62-status-pending.html', 'utf8');
  await update();
  expect(fills()).toBe(1);
  readyAvatar();
  await update();
  expect(fills()).toBe(2);
  const saved = (storedBookmarks(data) as Record<string, Bookmark>)['me:5901'];
  expect(saved.snapshot.avatar).toBe('https://pbs.twimg.com/profile_images/sample-status.jpg');
  expect(saved.snapshot.media).toEqual([]);
  const changedReads = reads();
  await update();
  expect(fills()).toBe(2);
  expect(reads()).toBe(changedReads);
});

it('引用アイコンだけの保留が解けたら、本体の保留中でも再び補完する', async () => {
  document.body.innerHTML = readFileSync('test/fixtures/v62-status-pending.html', 'utf8');
  await update();
  const img = document.createElement('img');
  img.src = 'https://pbs.twimg.com/profile_images/sample-quote.jpg';
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 48 });
  document.getElementById('quote-avatar-host')!.append(img);
  await update();
  expect(fills()).toBe(2);
  await update();
  expect(fills()).toBe(2);
});

it('メディアだけの保留が解けたら、アイコンの保留中でも画像を補完する', async () => {
  document.body.innerHTML = readFileSync('test/fixtures/v62-status-pending.html', 'utf8');
  await update();
  const img = document.getElementById('pending-media')! as HTMLImageElement;
  img.src = 'https://pbs.twimg.com/media/sample-pending.jpg';
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: 640 });
  await update();
  expect(fills()).toBe(2);
  expect((storedBookmarks(data) as Record<string, Bookmark>)['me:5901'].snapshot.media)
    .toEqual(['https://pbs.twimg.com/media/sample-pending.jpg']);
  await update();
  expect(fills()).toBe(2);
});

it('同じ保留 ID のままなら 2 回目以降の 1.2 秒の確認で保存データを読まない', async () => {
  install();
  await vi.advanceTimersByTimeAsync(1200);
  const firstReads = reads();
  expect(firstReads).toBeGreaterThan(0);
  for (let tick = 0; tick < 3; tick++) {
    notify([{ type: 'childList' } as MutationRecord], {} as MutationObserver);
    await vi.advanceTimersByTimeAsync(1200);
  }
  expect(reads()).toBe(firstReads);
  expect(fills()).toBe(1);
});

it('保留 ID が変われば再び補完し、同じ集合が続けば再読み込みしない', async () => {
  await update();
  show('5902');
  await update();
  const changedReads = reads();
  expect(fills()).toBe(2);
  await update();
  expect(reads()).toBe(changedReads);
  show('5901');
  await update();
  expect(fills()).toBe(3);
});

it('保留が解けたら欠けた項目を補い、以後の確認済み動作を維持する', async () => {
  const before = structuredClone((storedBookmarks(data) as Record<string, Bookmark>)['me:5901']);
  expect(await update()).toBe(true);
  readyAvatar();
  expect(await update()).toBe(false);
  const saved = (storedBookmarks(data) as Record<string, Bookmark>)['me:5901'];
  expect(saved.snapshot.avatar).toBe('https://pbs.twimg.com/profile_images/sample-status.jpg');
  expect(saved.snapshot.text).toBe('架空の全文。読み込みを待つアイコンつきのポスト。');
  expect(saved.snapshot.truncated).toBe(false);
  expect(saved.folderIds).toEqual(before.folderIds);
  expect(saved.savedAt).toBe(before.savedAt);
  const completedReads = reads();
  await update();
  expect(reads()).toBe(completedReads);
  expect(fills()).toBe(2);
});

it('主役の記事が消えてから戻れば同じ保留 ID も再試行する', async () => {
  await update();
  const article = document.getElementById('status-post')!;
  article.remove();
  await update();
  document.body.append(article);
  await update();
  expect(fills()).toBe(2);
});

it('個別ページを離れて戻れば同じ保留 ID も再試行する', async () => {
  await update();
  history.replaceState(null, '', '/home');
  await update();
  show('5901');
  await update();
  expect(fills()).toBe(2);
});

it('同じポストでもアカウントを切り替えたら補完を試す', async () => {
  await update();
  setAccount({ id: 'sample_other', handle: 'sample_other', lastSeenAt: 0 });
  await update();
  expect(fills()).toBe(2);
});

it('アカウントが判定できなくなった後に戻れば保留 ID も再試行する', async () => {
  await update();
  setAccount(null);
  const before = reads();
  expect(await update()).toBe(false);
  expect(reads()).toBe(before);
  setAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  await update();
  expect(fills()).toBe(2);
});

it('アイコンの保留が続いていても後から出た全文を更新する', async () => {
  const text = document.getElementById('post-text')!;
  text.textContent = '';
  expect(await update()).toBe(false);
  const firstReads = reads();
  text.textContent = '架空の後から読み込まれた全文';
  expect(await update()).toBe(true);
  // 空の本文が読めると mediaPending も解けるため、全文更新とは別に補完も再試行する。
  expect(fills()).toBe(2);
  expect(reads()).toBe(firstReads + 2);
  expect((storedBookmarks(data) as Record<string, Bookmark>)['me:5901'].snapshot.text)
    .toBe('架空の後から読み込まれた全文');
});
