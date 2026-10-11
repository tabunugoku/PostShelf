import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture } from './v50-helpers';
import { SETTLE_MAX_MS, SETTLE_POLL_MS } from '../src/content/autocollect';
import { extractTweet, fillSource, hasPending } from '../src/content/snapshot';
import { listBookmarks, missingFields, setAccountScope } from '../src/shared/storage';
import { queryAllFirst } from '../src/shared/selectors';

const readPost = (id: string) => extractTweet(document.getElementById(id)!)!;
const keepOnly = (id: string) => {
  for (const article of queryAllFirst(document, 'tweet').els) {
    if (article.id !== id) article.remove();
  }
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v50-empty-post.html');
});

it.each(['empty-post', 'no-text-element'])('本文も添付内容も無い %s を画像待ちにする', (id) => {
  const extracted = readPost(id);
  expect(extracted.snapshot.text).toBe('');
  expect(extracted.mediaPending).toBe(true);
  expect(extracted.avatarPending).toBeUndefined();
});

it.each([
  ['画像', 'image-post'],
  ['動画', 'video-post'],
  ['リンクカード', 'link-post'],
  ['引用', 'quote-post'],
])('本文が空でも %s が取れていれば画像待ちにしない', (_name, id) => {
  const extracted = readPost(id);
  expect(extracted.snapshot.text).toBe('');
  expect(extracted.mediaPending).toBeUndefined();
  expect(hasPending(extracted)).toBe(false);
});

it('本文だけのポストの待ちを増やさない', async () => {
  keepOnly('text-post');
  expect(readPost('text-post').mediaPending).toBeUndefined();
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.sleeps).toEqual([]);
  expect(await listBookmarks()).toHaveLength(1);
});

it('本文が空でもサムネイル無しの動画は従来どおり待つ', () => {
  document.getElementById('video')!.removeAttribute('poster');
  expect(readPost('video-post').mediaPending).toBe(true);
});

it('1 秒後に写真リンクと画像が現れたら待って画像つきで保存する', async () => {
  keepOnly('empty-post');
  const article = document.getElementById('empty-post')!;
  const photo = document.getElementById('late-photo') as HTMLTemplateElement;
  const world = collectorWorld((now) => {
    if (now >= 1000 && !readPost('empty-post').snapshot.media.length) {
      article.append(photo.content.cloneNode(true));
    }
  });
  await world.read();
  await world.flush();
  expect(world.clock.now).toBeGreaterThanOrEqual(1000);
  expect(world.clock.now).toBeLessThan(SETTLE_MAX_MS);
  expect((await listBookmarks())[0].snapshot.media).toEqual(['https://pbs.twimg.com/media/sample-late-v50.jpg']);
});

it('本当に空のポストも既存の 8 秒で打ち切り保存する', async () => {
  keepOnly('empty-post');
  const world = collectorWorld();
  await world.read();
  await world.flush();
  expect(world.clock.now).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
  expect(world.clock.now).toBeLessThan(SETTLE_MAX_MS + SETTLE_POLL_MS);
  const saved = (await listBookmarks())[0].snapshot;
  expect(saved.text).toBe('');
  expect(saved.media).toEqual([]);
  expect(saved).not.toHaveProperty('mediaPending');
});

it('画像待ちを fillSource と missingFields が画面側の値として扱わない', () => {
  const extracted = readPost('empty-post');
  const source = fillSource(extracted);
  expect(extracted.mediaPending).toBe(true);
  expect(source.media).toEqual([]);
  expect(source).not.toHaveProperty('hasVideo');
  expect(source).not.toHaveProperty('videoPoster');
  expect(missingFields(source, source)).toBeNull();
});
