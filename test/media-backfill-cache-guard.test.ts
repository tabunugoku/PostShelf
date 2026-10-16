// 版: v80
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import type { FillView } from '../src/shared/storage';

let media: typeof import('../src/content/media');
let storage: typeof import('../src/shared/storage');
let account: typeof import('../src/content/account');
let collect: typeof import('../src/content/collect');
let stop: (() => void) | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function views(id = '102'): Map<string, FillView> {
  return new Map([[id, { author: 'Sample Saved', handle: '@sample_saved', media: [] }]]);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  installChromeMock();
  history.replaceState({}, '', '/home');
  document.body.innerHTML = readFileSync('test/fixtures/v45-media.html', 'utf8');
  for (const image of document.querySelectorAll('img')) {
    Object.defineProperty(image, 'complete', { value: true });
    Object.defineProperty(image, 'naturalWidth', { value: 48 });
  }
  storage = await import('../src/shared/storage');
  vi.spyOn(storage, 'getFillViews').mockResolvedValue(views());
  vi.spyOn(storage, 'fillMissing').mockResolvedValue(1);
  account = await import('../src/content/account');
  collect = await import('../src/content/collect');
  media = await import('../src/content/media');
  account.setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('未確認 ID が残っていても 30 秒未満は再利用し、30 秒で読み直す', async () => {
  const read = vi.mocked(storage.getFillViews).mockResolvedValue(views());
  const watcher = new media.VisibleMediaBackfill();
  await watcher.update();
  await vi.advanceTimersByTimeAsync(29_999);
  await watcher.update();
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await watcher.update();
  expect(read).toHaveBeenCalledTimes(2);
  watcher.invalidate();
  await watcher.update();
  expect(read).toHaveBeenCalledTimes(3);
});

it.each(['data', 'account', 'path'])('監視経由の %s の変更で 30 秒未満でも読み直す', async (change) => {
  const read = vi.mocked(storage.getFillViews).mockResolvedValue(views());
  stop = media.installMediaBackfill();
  await vi.advanceTimersByTimeAsync(300);
  expect(read).toHaveBeenCalledTimes(1);
  if (change === 'data') await chrome.storage.local.set({ bookmarks: {} });
  if (change === 'account') {
    account.setCurrentAccount({ id: 'sample_other', handle: 'sample_other', lastSeenAt: 0 });
  }
  if (change === 'path') {
    history.replaceState({}, '', '/search');
    collect.pathListeners.forEach((listener) => listener());
  }
  await vi.advanceTimersByTimeAsync(300);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(change === 'account' ? 'sample_other' : 'me');
});

it.each([1, 3])('読み込み中の invalidate %i 回をまとめ、古い結果では補完しない', async (count) => {
  const old = deferred<Map<string, FillView>>();
  const fresh = deferred<Map<string, FillView>>();
  const read = vi.mocked(storage.getFillViews)
    .mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise).mockResolvedValue(views('104'));
  const watcher = new media.VisibleMediaBackfill();
  const updating = watcher.update();
  for (let index = 0; index < count; index++) watcher.invalidate();
  expect(watcher.update()).toBe(updating);
  old.resolve(views());
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  expect(storage.fillMissing).not.toHaveBeenCalled();
  let finished = false;
  void updating.then(() => { finished = true; });
  expect(finished).toBe(false);
  fresh.resolve(views('104'));
  expect(await updating).toBe(1);
  expect(vi.mocked(storage.fillMissing).mock.calls.map(([items]) => items.map((item) => item.tweetId)))
    .toEqual([['104']]);
  await watcher.update();
  expect(read).toHaveBeenCalledTimes(2);
});

it('追加の読み込み中の破棄も再試行し、最後の結果だけで補完して止まる', async () => {
  const first = deferred<Map<string, FillView>>();
  const second = deferred<Map<string, FillView>>();
  const read = vi.mocked(storage.getFillViews)
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(views('104'));
  const watcher = new media.VisibleMediaBackfill();
  const updating = watcher.update();
  watcher.invalidate();
  first.resolve(views());
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  watcher.invalidate();
  second.resolve(views());
  expect(await updating).toBe(1);
  expect(read).toHaveBeenCalledTimes(3);
  expect(vi.mocked(storage.fillMissing).mock.calls.map(([items]) => items.map((item) => item.tweetId)))
    .toEqual([['104']]);
  await watcher.update();
  expect(read).toHaveBeenCalledTimes(3);
});

it('監視中にアカウントとデータが変わると、新しいアカウントだけを補完する', async () => {
  const old = deferred<Map<string, FillView>>();
  const read = vi.mocked(storage.getFillViews)
    .mockReturnValueOnce(old.promise).mockResolvedValue(views('104'));
  stop = media.installMediaBackfill();
  await vi.advanceTimersByTimeAsync(300);
  account.setCurrentAccount({ id: 'sample_other', handle: 'sample_other', lastSeenAt: 0 });
  await chrome.storage.local.set({ bookmarks: {} });
  await vi.advanceTimersByTimeAsync(300);
  old.resolve(views());
  await vi.advanceTimersByTimeAsync(0);
  expect(read.mock.calls).toEqual([['me'], ['sample_other']]);
  expect(storage.fillMissing).toHaveBeenCalledTimes(1);
  expect(storage.fillMissing).toHaveBeenLastCalledWith(
    [expect.objectContaining({ tweetId: '104' })], 'sample_other',
  );
});

it('読み込みが失敗しても次の update で再試行できる', async () => {
  const read = vi.mocked(storage.getFillViews)
    .mockRejectedValueOnce(new Error('sample failure')).mockResolvedValue(views());
  const watcher = new media.VisibleMediaBackfill();
  await expect(watcher.update()).rejects.toThrow('sample failure');
  expect(await watcher.update()).toBe(1);
  expect(read).toHaveBeenCalledTimes(2);
});

it('未確認 ID が無ければ期限と破棄の後でも保存データを読まない', async () => {
  document.body.replaceChildren();
  const read = vi.mocked(storage.getFillViews).mockResolvedValue(new Map());
  const watcher = new media.VisibleMediaBackfill();
  await watcher.update();
  watcher.invalidate();
  await vi.advanceTimersByTimeAsync(30_000);
  await watcher.update();
  expect(read).not.toHaveBeenCalled();
  expect(storage.fillMissing).not.toHaveBeenCalled();
});

