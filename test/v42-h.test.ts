import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractTweet, tweetIdOf } from '../src/content/snapshot';
import { findQuote } from '../src/shared/selectors';

const load = (empty = false) => {
  document.body.innerHTML = readFileSync('test/fixtures/v42-nested-quote' + (empty ? '-empty' : '') + '.html', 'utf8');
  const article = document.querySelector('article')!;
  return { article, outer: article.querySelector('div[role=link]')!, nested: article.querySelector('[data-testid=nestedQuotePreview]')! };
};
const expected = {
  author: 'Sample Quote', handle: '@sample_quote', avatar: 'https://example.invalid/quote-avatar.jpg',
  createdAt: '2026-10-09T19:17:26.000Z', media: [], hasVideo: true,
  videoPoster: 'https://example.invalid/amplify_video_thumb/sample.jpg',
};
describe('v42-H: exclude the nested quote preview', () => {
  it.each([false, true])('keeps only the outer quote (empty=%s)', empty => {
    const { article, outer } = load(empty); const ex = extractTweet(article)!;
    expect(findQuote(article)).toBe(outer); expect(tweetIdOf(article)).toBe('111');
    expect(ex.snapshot).toMatchObject({ author:'Sample Main',handle:'@sample_main',text:'Sample main body',media:[],hasVideo:false });
    expect(ex.snapshot.translated).toBeUndefined();
    expect(ex.snapshot.quote).toEqual({ ...expected, text: empty ? '' : 'Sample translated quote body', ...(!empty ? { translated: true } : {}) });
    const json = JSON.stringify(ex);
    for (const value of ['@sample_nested', 'Nested-only fictional body', 'nested-avatar.jpg', '2026-10-08T12:34:56.000Z']) expect(json).not.toContain(value);
    expect(outer.querySelectorAll('a')).toHaveLength(0);
  });
  it.each(['identity', 'avatar', 'time'])('does not fall back to nested %s', part => {
    const {article, outer} = load(true);
    if(part === 'identity') { outer.querySelector('[data-testid=User-Name]')!.remove(); outer.querySelector('[data-testid=Tweet-User-Avatar]')!.remove(); }
    if(part === 'avatar') outer.querySelector('[data-testid=Tweet-User-Avatar]')!.remove();
    if(part === 'time') outer.querySelector('time')!.remove();
    const q=extractTweet(article)!.snapshot.quote!;
    expect(q.text).toBe(''); expect(q.hasVideo).toBe(true);
    if(part === 'identity') { expect(q.author).toBe(''); expect(q.handle).toBe(''); }
    if(part === 'avatar') expect(q.avatar).toBeUndefined();
    if(part === 'time') expect(q.createdAt).toBeUndefined();
    expect(JSON.stringify(q)).not.toContain('sample_nested');
  });
  it('excludes nested nameText inside an otherwise empty outer User-Name', () => {
    const {article,outer,nested}=load(true); const name=outer.querySelector('[data-testid=User-Name]')!;
    name.innerHTML='';name.appendChild(nested);
    const q=extractTweet(article)!.snapshot.quote!;
    expect(q.author).toBe('');expect(q.handle).toBe('@sample_quote');expect(q.text).toBe('');
  });
  it('does not read nested images, photo links or video', () => {
    const {article,outer,nested}=load(true);
    nested.appendChild(outer.querySelector('[data-testid=tweetPhoto]')!);
    nested.insertAdjacentHTML('beforeend','<div data-testid="tweetPhoto"><a href="/sample_nested/status/999/photo/1"><img src="https://example.invalid/nested-photo.jpg"></a></div>');
    const q=extractTweet(article)!.snapshot.quote!;
    expect(q.media).toEqual([]);expect(q.url).toBeUndefined();expect(q.hasVideo).toBeUndefined();expect(q.videoPoster).toBeUndefined();
    expect(q.text).toBe('');expect(q.translated).toBeUndefined();
  });
  it('does not take a nested poster when the outer player lacks one', () => {
    const {article,outer,nested}=load();
    const video=outer.querySelector('video')!;video.removeAttribute('poster');
    nested.insertAdjacentHTML('beforeend','<video poster="https://example.invalid/nested-poster.jpg"></video>');
    const q=extractTweet(article)!.snapshot.quote!;
    expect(q.hasVideo).toBe(true);expect(q.videoPoster).toBeUndefined();
  });
  it('tries an outer structural fallback after excluding the nested primary candidate', () => {
    const {article,outer,nested}=load();const text=outer.querySelector('[data-testid=tweetText]')!;text.removeAttribute('data-testid');
    const q=extractTweet(article)!.snapshot.quote!;expect(q.text).toBe('Sample translated quote body');expect(q.translated).toBe(true);
    outer.querySelectorAll('[data-testid=videoPlayer],[data-testid=videoComponent]').forEach(el=>el.removeAttribute('data-testid'));
    nested.insertAdjacentHTML('beforeend','<div data-testid="videoPlayer"><video poster="https://example.invalid/nested-poster.jpg"></video></div>');
    expect(extractTweet(article)!.snapshot.quote!.hasVideo).toBe(true);
  });
  it('never treats a standalone nested preview as the outer quote', () => {
    const {article,outer,nested}=load();outer.replaceWith(nested);
    expect(findQuote(article)).toBeNull();expect(extractTweet(article)!.snapshot.quote).toBeUndefined();
  });
});
