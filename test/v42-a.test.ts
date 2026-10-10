import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractTweet, tweetIdOf } from '../src/content/snapshot';
import { findQuote } from '../src/shared/selectors';
const load = (name: string) => { document.body.innerHTML = readFileSync('test/fixtures/' + name + '.html', 'utf8'); return document.querySelector('article')!; };
describe('v42-A: visible quote snapshot', () => {
  it('reads the outer quote, ignoring the affiliation badge and reply line', () => {
    const a = load('v42-quote-detail');
    const q = extractTweet(a)!.snapshot.quote!;
    expect(findQuote(a)).toBe(a.querySelector('div[role=link]'));
    expect(q).toEqual({ author: 'Sample Quote', handle: '@sample_quote', avatar: 'https://example.invalid/a2_normal.jpg', text: 'Quote body', media: [], createdAt: '2026-10-09T19:17:26.000Z' });
    expect(extractTweet(a)).toMatchObject({ tweetId: '111', snapshot: { text: 'Main body', author: 'Sample Main', handle: '@sample_main', media: [], avatar: 'https://example.invalid/a1.jpg' } });
    expect(tweetIdOf(a)).toBe('111');
  });
  it('reads photos and the photo-link ID without changing the own ID or media', () => {
    const a = load('v42-quote-timeline'); const ex = extractTweet(a)!;
    expect(ex.tweetId).toBe('222');
    expect(ex.snapshot).toMatchObject({ text: 'Main body', media: [], truncated: true, hasVideo: false });
    expect(ex.snapshot.quote).toMatchObject({ text: '引用の翻訳後の本文', media: ['https://example.invalid/media/q1?format=jpg&name=900x900'], url: 'https://x.com/sample_quote/status/333', createdAt: '2026-10-10T05:39:53.000Z' });
  });
  it('uses the visible handle when the avatar container is absent; reads segments only from quote text', () => {
    const a = load('v42-quote-detail'); const q = a.querySelector('div[role=link]')!;
    q.querySelector('[data-testid=Tweet-User-Avatar]')!.remove();
    q.querySelector('[data-testid=tweetText]')!.innerHTML = 'Quote <a href="https://example.invalid/page">link</a><img alt="emoji" src="https://example.invalid/emoji.png">';
    expect(extractTweet(a)!.snapshot.quote).toMatchObject({ handle: '@sample_quote', text: 'Quote link', segments: [{ t: 'text', v: 'Quote ' }, { t: 'link', v: 'link', href: 'https://example.invalid/page' }] });
    expect(extractTweet(a)!.snapshot.quote!.avatar).toBeUndefined();
  });
  it('uses the avatar handle when the visible handle is absent', () => {
    const a = load('v42-quote-detail'); a.querySelector('div[role=link] [tabindex="-1"]')!.remove();
    expect(extractTweet(a)!.snapshot.quote!.handle).toBe('@sample_quote');
  });
  it('does not create an empty quote or a quote for an affiliation badge alone', () => {
    const a = load('v42-quote-detail'); a.querySelector('div[role=link]')!.innerHTML = '<div data-testid="User-Name"></div>';
    expect(extractTweet(a)!.snapshot.quote).toBeUndefined();
    a.querySelector('div[role=link]')!.innerHTML = '<img src="https://example.invalid/badge.jpg">';
    expect(findQuote(a)).toBeNull();
    expect(extractTweet(a)!.snapshot.quote).toBeUndefined();
  });
  it('keeps an ordinary post unchanged', () => {
    expect(extractTweet(load('tweet'))!.snapshot.quote).toBeUndefined();
  });
});
