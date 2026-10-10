import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { extractTweet } from '../src/content/snapshot';
const load = (name: string) => { document.body.innerHTML = readFileSync('test/fixtures/' + name + '.html', 'utf8'); return document.querySelector('article')!; };
describe('v42-B: translation marks without operating X', () => {
  it('marks the translated main body from vote buttons, ignoring their language', () => {
    const a = load('v42-translated-detail'); a.querySelectorAll('button').forEach(b => b.setAttribute('aria-label', 'sample label'));
    const click = vi.fn(); a.addEventListener('click', click);
    expect(extractTweet(a)!.snapshot).toMatchObject({ translated: true, text: '翻訳後の架空の本文' });
    expect(extractTweet(a)!.snapshot.quote!.translated).toBeUndefined(); expect(click).not.toHaveBeenCalled();
    a.querySelector('[data-testid=thumbsUpVoteButton]')!.remove(); expect(extractTweet(a)!.snapshot.translated).toBe(true);
  });
  it('does not mark the untranslated fixture', () => {
    expect(extractTweet(load('v42-quote-detail'))!.snapshot.translated).toBeUndefined();
  });
  it('marks the quote from the band immediately preceding its text, not the main body', () => {
    const a = load('v42-quote-timeline'); const s = extractTweet(a)!.snapshot;
    expect(s.quote!.translated).toBe(true); expect(s.translated).toBeUndefined();
    const body = a.querySelector('div[role=link] [data-testid=tweetText]')!;
    body.previousElementSibling!.append(document.createElement('button'));
    expect(extractTweet(a)!.snapshot.quote!.translated).toBeUndefined();
  });
  it('does not count vote buttons inside a quote as a main-body translation', () => {
    const a = load('v42-quote-detail'); a.querySelector('div[role=link]')!.insertAdjacentHTML('beforeend', '<button data-testid="thumbsUpVoteButton"></button>');
    expect(extractTweet(a)!.snapshot.translated).toBeUndefined();
  });
});
