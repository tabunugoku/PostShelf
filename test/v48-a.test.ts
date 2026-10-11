import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { extractTweet, hasPending } from '../src/content/snapshot';

const photo = (n: number, loaded: boolean) => (
  `<a href="/sample_photo/status/401/photo/${n}"><div data-testid="tweetPhoto"><img src="${loaded ? `https://pbs.twimg.com/media/sample-${n}.jpg` : ''}"></div></a>`
);
const post = (inner: string) => (
  `<article data-testid="tweet"><div data-testid="Tweet-User-Avatar"><img id="av" src=""></div>` +
  `<a href="/sample_photo/status/401"><time datetime="2026-01-01"></time></a>` +
  `<div data-testid="tweetText">架空の本文</div>${inner}</article>`
);
const setImage = (img: Element, state: { src?: string; complete?: boolean; naturalWidth?: number }) => {
  if (state.src !== undefined) img.setAttribute('src', state.src);
  Object.defineProperty(img, 'complete', { value: state.complete ?? true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: state.naturalWidth ?? 0, configurable: true });
};
const loadAvatar = () => setImage(document.getElementById('av')!, { src: 'https://pbs.twimg.com/avatar.jpg', naturalWidth: 48 });
const read = () => extractTweet(document.querySelector('article')!)!;
beforeEach(() => {
  document.body.innerHTML = '';
});

it.each([
  ['src が空', { src: '' }],
  ['complete が偽', { src: 'https://pbs.twimg.com/avatar.jpg', complete: false, naturalWidth: 0 }],
  ['naturalWidth が 0', { src: 'https://pbs.twimg.com/avatar.jpg', complete: true, naturalWidth: 0 }],
])('treats an avatar as pending when %s', (_name, state) => {
  document.body.innerHTML = post('');
  setImage(document.getElementById('av')!, state);
  expect(read().avatarPending).toBe(true);
  expect(hasPending(read())).toBe(true);
});

it('is not pending once the avatar has loaded', () => {
  document.body.innerHTML = post('');
  loadAvatar();
  expect(hasPending(read())).toBe(false);
});

it('is pending while only some of the photos have loaded', () => {
  document.body.innerHTML = post(photo(1, true) + photo(2, false));
  loadAvatar();
  expect(read().mediaPending).toBe(true);
  expect(read().snapshot.media).toHaveLength(1);
});

it('is pending while no photo has loaded yet', () => {
  document.body.innerHTML = post(photo(1, false) + photo(2, false));
  loadAvatar();
  expect(read().mediaPending).toBe(true);
});

it('is not pending when every photo has loaded', () => {
  document.body.innerHTML = post(photo(1, true) + photo(2, true));
  loadAvatar();
  expect(hasPending(read())).toBe(false);
  expect(read().snapshot.media).toHaveLength(2);
});

it('keeps the video rule: pending only while the poster is empty', () => {
  document.body.innerHTML = post('<div data-testid="videoPlayer"><video poster=""></video></div>');
  loadAvatar();
  expect(read().mediaPending).toBe(true);
  document.querySelector('video')!.setAttribute('poster', 'https://pbs.twimg.com/media/sample-video.jpg');
  expect(hasPending(read())).toBe(false);
});

it('is pending while the quote avatar has not loaded, and not for a post without a quote', () => {
  document.body.innerHTML = readFileSync('test/fixtures/v42-quote-timeline.html', 'utf8');
  const article = document.querySelector('article')!;
  const images = [...article.querySelectorAll('img')];
  setImage(images[0], { src: 'https://example.invalid/a1.jpg', naturalWidth: 48 });
  setImage(images[1], { src: 'https://example.invalid/a2_normal.jpg', complete: false });
  expect(extractTweet(article)!.quoteAvatarPending).toBe(true);
  setImage(images[1], { naturalWidth: 48 });
  expect(extractTweet(article)!.quoteAvatarPending).toBeUndefined();
  document.body.innerHTML = post('');
  loadAvatar();
  expect(read().quoteAvatarPending).toBeUndefined();
});
