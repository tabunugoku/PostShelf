// 版: v75
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MEDIA_VIEWS_MAX_AGE_MS, VisibleMediaBackfill } from '../src/content/media';
import { collectVisible } from '../src/content/collect';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { fillSource } from '../src/content/snapshot';
import * as snapshot from '../src/content/snapshot';
import * as storage from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = readFileSync('test/fixtures/v45-media.html', 'utf8');
  for (const image of document.querySelectorAll('img')) {
    Object.defineProperty(image, 'complete', { value: true });
    Object.defineProperty(image, 'naturalWidth', { value: 48 });
  }
});
afterEach(() => vi.restoreAllMocks());

function setup(savedIds: string[]) {
  const views = new Map<string, storage.FillView>(savedIds.map((id) => [
    id, { author: 'Sample Saved', handle: '@sample_saved', media: [], createdAt: '2026-01-01' },
  ]));
  const fillViews = vi.spyOn(storage, 'getFillViews').mockResolvedValue(views);
  const backfill = vi.spyOn(storage, 'fillMissing').mockResolvedValue(1);
  const extract = vi.spyOn(snapshot, 'extractTweet');
  return { views, fillViews, backfill, extract, watcher: new VisibleMediaBackfill() };
}

it('未保存と確認済みの記事を解析せず、従来と同じ補完を送る', async () => {
  const context = setup(['102']);
  const expected = collectVisible().filter((it) => it.tweetId === '102')
    .map((it) => ({ tweetId: it.tweetId, snapshot: fillSource(it) }));
  context.extract.mockClear();
  expect(await context.watcher.update()).toBe(1);
  expect(context.extract.mock.calls.map(([article]) => article.id)).toEqual(['image-ready']);
  expect(context.backfill).toHaveBeenCalledExactlyOnceWith(expected, 'me');
  context.extract.mockClear();
  context.backfill.mockClear();
  // 未保存の記事は残したまま、別の保存済み記事を新しい補完対象にする。
  context.views.set('104', { author: 'Sample Saved', handle: '@sample_saved', media: [] });
  context.watcher.invalidate();
  await context.watcher.update();
  expect(context.extract.mock.calls.map(([article]) => article.id)).toEqual(['video-ready']);
  expect(context.backfill.mock.calls[0][0].map((it) => it.tweetId)).toEqual(['104']);
});

it('同じ ID の後の記事だけを読み、従来と同じ値と順番を送る', async () => {
  const article = document.getElementById('image-ready')!;
  const duplicate = article.cloneNode(true) as Element;
  duplicate.id = 'last-image';
  duplicate.querySelector('[data-testid="tweetPhoto"] img')!
    .setAttribute('src', 'https://pbs.twimg.com/media/sample-last.jpg');
  for (const image of duplicate.querySelectorAll('img')) {
    Object.defineProperty(image, 'complete', { value: true });
    Object.defineProperty(image, 'naturalWidth', { value: 48 });
  }
  document.body.append(duplicate);
  const expected = collectVisible().filter((it) => ['102', '104'].includes(it.tweetId))
    .map((it) => ({ tweetId: it.tweetId, snapshot: fillSource(it) }));
  const context = setup(['102', '104']);
  await context.watcher.update();
  expect(context.extract.mock.calls.map(([element]) => element.id)).toEqual(['last-image', 'video-ready']);
  expect(context.backfill).toHaveBeenCalledExactlyOnceWith(expected, 'me');
});

it('保存データの待ち中に消えた記事を補完しない', async () => {
  const context = setup(['102']);
  let finish!: (views: Map<string, storage.FillView>) => void;
  context.fillViews.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const updating = context.watcher.update();
  document.getElementById('image-ready')!.remove();
  finish(context.views);
  expect(await updating).toBe(0);
  expect(context.extract).not.toHaveBeenCalled();
  expect(context.backfill).not.toHaveBeenCalled();
});

it('TTL と invalidate の読み直し条件を保つ', async () => {
  vi.useFakeTimers();
  try {
    const context = setup(['102']);
    await context.watcher.update();
    await context.watcher.update();
    expect(context.fillViews).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MEDIA_VIEWS_MAX_AGE_MS);
    await context.watcher.update();
    expect(context.fillViews).toHaveBeenCalledTimes(2);
    context.watcher.invalidate();
    await context.watcher.update();
    expect(context.fillViews).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it('読み込み中の記事は後の通知でも解析して補完できる', async () => {
  const context = setup(['101']);
  expect(await context.watcher.update()).toBe(0);
  expect(context.extract.mock.calls.map(([article]) => article.id)).toEqual(['image-pending']);
  expect(context.backfill).not.toHaveBeenCalled();
  document.querySelector('#image-pending img')!
    .setAttribute('src', 'https://pbs.twimg.com/media/sample-late.jpg');
  context.extract.mockClear();
  expect(await context.watcher.update()).toBe(1);
  expect(context.extract.mock.calls.map(([article]) => article.id)).toEqual(['image-pending']);
  expect(context.backfill.mock.calls[0][0]).toMatchObject([
    { snapshot: { media: ['https://pbs.twimg.com/media/sample-late.jpg'] } },
  ]);
});

it('一度消えた確認済みの記事は再表示時に解析する', async () => {
  const context = setup(['102']);
  await context.watcher.update();
  context.extract.mockClear();
  const article = document.getElementById('image-ready')!;
  article.remove();
  await context.watcher.update();
  expect(context.extract).not.toHaveBeenCalled();
  document.body.append(article);
  await context.watcher.update();
  expect(context.extract).toHaveBeenCalledExactlyOnceWith(article);
  expect(context.backfill).toHaveBeenCalledTimes(2);
});
