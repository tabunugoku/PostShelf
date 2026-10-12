import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as snapshot from '../src/content/snapshot';
import { getBookmark, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './v50-helpers';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  document.getElementById('main-post')!.remove();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it('既読の記事は解析せず未読だけを同じ順に保存する', async () => {
  const world = collectorWorld();
  const extract = vi.spyOn(snapshot, 'extractTweet');
  await world.read();
  expect(extract).toHaveBeenCalledTimes(2);
  extract.mockClear();
  const article = document.getElementById('last-post')!.cloneNode(true) as HTMLElement;
  article.querySelector('a')!.setAttribute('href', '/sample_last/status/1204');
  markLoaded(article.querySelector('img')!);
  document.body.append(article);
  expect(await world.read()).toBe(1);
  expect(extract).toHaveBeenCalledTimes(1);
  await world.flush();
  expect((await getBookmark('1204'))!.savedAt).toBe(-1000);
  expect(world.collector.state!.imported).toBe(3);
});

it('ID が読めない記事と重複 ID の扱いを変えない', async () => {
  const article = document.getElementById('last-post')!.cloneNode(true) as HTMLElement;
  article.querySelector('[data-testid="tweetText"]')!.textContent = '架空の重複の最後の本文。';
  document.body.append(article);
  const broken = article.cloneNode(true) as HTMLElement;
  broken.querySelector('a')!.removeAttribute('href');
  document.body.append(broken);
  const world = collectorWorld();
  expect(await world.read()).toBe(2);
  await world.flush();
  expect((await getBookmark('1203'))!.snapshot.text).toBe('架空の重複の最後の本文。');
  expect(await world.read()).toBe(0);
});

it('解析しない既読が前にあっても診断の画面内位置を保つ', async () => {
  const world = collectorWorld();
  await world.read();
  document.getElementById('last-post')!.querySelector('a')!.setAttribute('href', '/sample_last/status/1204');
  document.getElementById('last-post')!.querySelector('img')!.remove();
  await world.read();
  await (world.collector as any).finish();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0].position).toBe(2);
});
