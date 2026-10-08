import { describe, expect, it } from 'vitest';
import { extractTweet } from '../src/content/snapshot';

/** セレクタ耐性: 一部の data-testid が欠けても致命的に失敗しない */
describe('selector resilience', () => {
  it('still extracts id/url when optional parts are missing', () => {
    document.body.innerHTML =
      '<article data-testid="tweet"><a href="/bob/status/42"><time datetime="2026-01-01T00:00:00Z"></time></a></article>';
    const r = extractTweet(document.querySelector('article')!)!;
    expect(r.tweetId).toBe('42');
    expect(r.snapshot).toMatchObject({ text: '', author: 'bob', handle: '@bob', media: [] });
  });
  it('falls back to a status link when <time> is absent', () => {
    document.body.innerHTML = '<article data-testid="tweet"><a href="/bob/status/7/photo/1">x</a></article>';
    expect(extractTweet(document.querySelector('article')!)?.tweetId).toBe('7');
  });
});
