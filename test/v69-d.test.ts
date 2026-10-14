import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { dropSavedCache, ensureCollectButton, refreshCollectButton } from '../src/content/collect';
import { extractTweet } from '../src/content/snapshot';
import { installChromeMock } from './chrome-mock';

const video = (poster: string) =>
  `<article data-testid="tweet">
    <div data-testid="User-Name"><span>Sample</span><span>@sample_user</span>
      <a href="/sample_user/status/777"><time datetime="2026-10-05T12:00:00.000Z"></time></a>
    </div>
    <div data-testid="tweetText"><span>架空の動画</span></div>
    <div data-testid="videoPlayer"><video poster="${poster}" src="blob:https://example.invalid/sample"></video></div>
  </article>`;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('v69-D: 本体の動画のサムネイルは https の URL だけ保存する', () => {
  const poster = (html: string) => {
    document.body.innerHTML = html;
    return extractTweet(document.querySelector('article')!)!.snapshot.videoPoster;
  };

  it('blob: のサムネイルは保存しない', () => {
    expect(poster(video('blob:https://example.invalid/poster'))).toBeUndefined();
  });

  it('https のサムネイルは保存する', () => {
    expect(poster(video('https://pbs.twimg.com/media/sample.jpg'))).toBe('https://pbs.twimg.com/media/sample.jpg');
  });
});

describe('v69-D: 取り込みボタンの更新で、記録の失敗が未処理の reject にならない', () => {
  const seen: unknown[] = [];
  const onRejection = (e: unknown) => void seen.push(e);
  beforeEach(() => {
    installChromeMock();
    dropSavedCache();
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    history.pushState({}, '', '/i/history');
    seen.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
    document.querySelector('.postshelf-collect')?.remove();
    history.pushState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('recordPending が reject しても refreshCollectButton は例外にならない', async () => {
    document.body.innerHTML = video('https://pbs.twimg.com/media/sample.jpg');
    ensureCollectButton();
    await tick();
    const set = vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(Error('storage'));
    document.body.insertAdjacentHTML('beforeend', video('https://pbs.twimg.com/media/sample2.jpg').replace('777', '778'));
    await expect(refreshCollectButton()).resolves.toBeUndefined();
    await tick();
    expect(set).toHaveBeenCalled(); // 件数が変わったので記録を試みている
    expect(seen).toEqual([]);
  });
});
