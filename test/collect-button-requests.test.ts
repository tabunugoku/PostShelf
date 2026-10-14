// 版: v67-b
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { dropSavedCache, ensureCollectButton } from '../src/content/collect';
import { createFolder, setBookmarkFolders } from '../src/shared/storage';

const article = (id: number, folded = false) =>
  `<article data-testid="tweet"><div data-testid="User-Name"><span>U${id}</span><a href="/sample_${id}/status/${id}">` +
  `<time datetime="2026-10-01T00:00:00Z"></time></a></div><div data-testid="tweetText">t${id}</div>` +
  `${folded ? '<span data-testid="tweet-text-show-more-link">さらに表示</span>' : ''}</article>`;
const snap = { text: 't', author: 'a', handle: '@a', media: [], url: 'u' };
const btn = () => document.querySelector<HTMLButtonElement>('.postshelf-collect')!;
let calls: ReturnType<typeof installPanelMock>;

beforeEach(() => {
  installChromeMock();
  calls = installPanelMock();
  dropSavedCache();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  history.pushState({}, '', '/i/history');
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});
afterEach(() => {
  document.querySelector('.postshelf-collect')?.remove();
  history.pushState({}, '', '/');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const press = async () => {
  ensureCollectButton();
  await vi.advanceTimersByTimeAsync(10);
  btn().click();
  await vi.advanceTimersByTimeAsync(10);
};

it('たたまれたポストの ID で全文の取得を依頼する', async () => {
  document.body.innerHTML = article(1, true) + article(2);
  await press();
  expect(calls.messages).toContainEqual({ type: 'fetchFullText', accountId: 'me', ids: ['1'], kind: 'auto' });
});

it('新しく保存した各ポストについて画像のキャッシュを依頼する', async () => {
  document.body.innerHTML = article(1) + article(2);
  await press();
  expect(calls.messages).toContainEqual({ type: 'cacheImages', tweetId: '1', accountId: 'me' });
  expect(calls.messages).toContainEqual({ type: 'cacheImages', tweetId: '2', accountId: 'me' });
});

it('保存済みだったポストは依頼しない', async () => {
  document.body.innerHTML = article(1, true) + article(2, true);
  const f = await createFolder({ name: 'a' });
  await setBookmarkFolders('1', [f.id], snap);
  await press();
  expect(calls.messages).toContainEqual({ type: 'fetchFullText', accountId: 'me', ids: ['2'], kind: 'auto' });
  expect(calls.messages).not.toContainEqual({ type: 'cacheImages', tweetId: '1', accountId: 'me' });
});

it('保存に失敗すると errorStorage を 3 秒だけ出して、依頼もしない', async () => {
  document.body.innerHTML = article(1, true);
  ensureCollectButton();
  await vi.advanceTimersByTimeAsync(10);
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('quota'));
  btn().click();
  await vi.advanceTimersByTimeAsync(10);
  expect(btn().textContent).toBe(chrome.i18n.getMessage('errorStorage'));
  expect(calls.messages).toEqual([]);
  vi.restoreAllMocks();
  await vi.advanceTimersByTimeAsync(3100);
  expect(btn().textContent).toBe('未取り込み 1 件');
});
