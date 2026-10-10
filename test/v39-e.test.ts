import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractTweet, tweetIdOf } from '../src/content/snapshot';
import { findArticle, handleMessage } from '../src/content/messages';
import { installChromeMock } from './chrome-mock';

beforeEach(() => installChromeMock());
describe.each(['tweet-quote-detail', 'tweet-quote-timeline'])('%s', (fixture) => {
  const load = () => {
    document.body.innerHTML = readFileSync(`test/fixtures/${fixture}.html`, 'utf8');
    return document.querySelector('article')!;
  };
  it('reads only the main post ID, author, text, media and expansion state', () => {
    const article = load();
    expect(tweetIdOf(article)).toBe('111');
    expect(extractTweet(article)).toEqual({ tweetId: '111', snapshot: {
      text: '本体の架空の全文です。', author: 'Sample Main', handle: '@sample_main',
      avatar: 'https://pbs.twimg.com/profile_images/sample_main/avatar.jpg',
      media: ['https://pbs.twimg.com/media/sample_main.jpg'], createdAt: '2026-10-02T12:00:00.000Z',
      url: 'https://x.com/sample_main/status/111', hasVideo: false, hasLink: false,
    } });
  });
  it('finds the main article and returns its full text even when the quote is collapsed', () => {
    const article = load();
    expect(findArticle('111')).toBe(article);
    expect(findArticle('222')).toBeNull();
    const reply = vi.fn();
    handleMessage({ type: 'readFullText', tweetId: '111' }, reply);
    expect(reply).toHaveBeenCalledWith({ ok: true, text: '本体の架空の全文です。', segments: undefined });
  });
  it('uses the own status-link fallback when the main time is absent', () => {
    const article = load();
    article.querySelectorAll('time').forEach((time) => { if (!time.closest('div[role=link]')) time.remove(); });
    expect(tweetIdOf(article)).toBe('111');
    expect(extractTweet(article)?.tweetId).toBe('111');
  });
  it('does not save quote text or identity when the main post has no text or status link', () => {
    const article = load();
    const ownLink = [...article.querySelectorAll('a[href*="/status/"]')].find((a) => !a.closest('div[role=link]'))!;
    article.append(ownLink); // 投稿者の要素を外しても、本体のポストへのリンクは残す
    article.querySelectorAll('[data-testid=tweetText], [data-testid=User-Name], [data-testid=Tweet-User-Avatar], [data-testid=tweetPhoto]').forEach((el) => { if (!el.closest('div[role=link]')) el.remove(); });
    const ex = extractTweet(article)!;
    expect(ex.tweetId).toBe('111');
    expect(ex.snapshot).toMatchObject({ text: '', author: 'sample_main', media: [], hasVideo: false, hasLink: false });
    expect(ex.snapshot.avatar).toBeUndefined();
    expect(ex.snapshot.truncated).toBeUndefined();
    const reply = vi.fn();
    handleMessage({ type: 'readFullText', tweetId: '111' }, reply);
    expect(reply).toHaveBeenCalledWith({ ok: false, reason: 'wait' });
    article.querySelectorAll('a[href*="/status/"]').forEach((a) => { if (!a.closest('div[role=link]')) a.remove(); });
    expect(tweetIdOf(article)).toBeNull();
    expect(extractTweet(article)).toBeNull();
  });
  it('tries an own structural text fallback when the primary candidate is only inside the quote', () => {
    const article = load();
    const own = [...article.querySelectorAll('[data-testid=tweetText]')].find((el) => !el.closest('div[role=link]'))!;
    own.removeAttribute('data-testid');
    own.setAttribute('lang', 'ja');
    expect(extractTweet(article)?.snapshot.text).toBe('本体の架空の全文です。');
  });
});
