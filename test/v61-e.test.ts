import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as snapshot from '../src/content/snapshot';
import { defaultDeps } from '../src/content/autocollect';
import { collectorWorld, loadFixture } from './v50-helpers';
import { installChromeMock } from './chrome-mock';
import { listBookmarks, setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v61-post-identities.html');
});

afterEach(() => vi.restoreAllMocks());

it.each([
  ['quoted-post', '6101'],
  ['reply-post', '6102'],
  ['reposted-post', '6103'],
])('%s は本体の ID と解析結果が一致する', (articleId, expectedId) => {
  const article = document.getElementById(articleId)!;
  expect(snapshot.tweetIdOf(article)).toBe(expectedId);
  expect(snapshot.extractTweet(article)?.tweetId).toBe(expectedId);
});

it('引用を解析しても引用元の ID と本文を本体へ混ぜない', () => {
  const item = snapshot.extractTweet(document.getElementById('quoted-post')!)!;
  expect(item.snapshot.text).toBe('架空の引用を含む本文。');
  expect(item.snapshot.quote?.text).toBe('架空の引用元の本文。');
});

/** 将来の軽い ID 判定の食い違いを、fixture の本体を変えずに模擬する。 */
function mismatch(): void {
  const original = snapshot.tweetIdOf;
  vi.spyOn(snapshot, 'tweetIdOf').mockImplementation((article) => {
    if (article.id === 'reply-post') return '6198';
    if (article.id === 'reposted-post') return null;
    return original(article);
  });
}

it('既読の返信先を誤って返しても未読の本体を保存する', async () => {
  mismatch();
  const world = collectorWorld();
  (world.collector as any).seen.add('6198');
  await world.read();
  await world.flush();
  expect((await listBookmarks()).map((it) => it.tweetId).sort()).toEqual(['6101', '6102', '6103']);
});

it('only と軽い ID が食い違っても解析結果の対象を取りこぼさない', () => {
  mismatch();
  const deps = defaultDeps();
  const items = deps.visible(undefined, new Set(['6102', '6103']));
  expect(items.map((it) => it.tweetId)).toEqual(['6102', '6103']);
  expect(deps.visiblePosition!('6102')).toBe(2);
  expect(deps.visiblePosition!('6103')).toBe(3);
});

it('軽い ID では未読に見えても解析結果の既読を返さない', () => {
  mismatch();
  const deps = defaultDeps();
  expect(deps.visible(new Set(['6102', '6103'])).map((it) => it.tweetId)).toEqual(['6101']);
});

it('再確認する ID も軽い ID でなく解析結果で判定する', () => {
  mismatch();
  const items = defaultDeps().visible(new Set(['6102', '6103']), undefined, new Set(['6102']));
  expect(items.map((it) => it.tweetId)).toEqual(['6101', '6102']);
});

it('一致する既読と only 対象外はスナップショットを解析しない', () => {
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const deps = defaultDeps();
  expect(deps.visible(new Set(['6101']), new Set(['6101', '6102'])).map((it) => it.tweetId))
    .toEqual(['6102']);
  expect(extract.mock.calls.map(([article]) => article.id)).toEqual(['reply-post']);
});
