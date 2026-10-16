// 版: v77
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoCollector, type CollectDeps } from '../src/content/autocollect';
import type { Extracted } from '../src/content/snapshot';
import { installChromeMock } from './chrome-mock';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 最初の ID 読み出しを保留し、次の画面で保存済みのポストに初めて出会う。 */
function world(showInitially = false) {
  const target: Extracted = {
    tweetId: 'p1',
    snapshot: {
      text: '架空の長い本文',
      author: 'Sample',
      handle: '@sample_user',
      media: [],
      url: 'https://x.com/sample_user/status/1',
      truncated: true,
    },
  };
  const stored = new Set([target.tweetId]);
  const readStarted = deferred();
  const releaseRead = deferred();
  const finished = deferred();
  let screen = 0;
  let changed = () => {};
  let afterRead = () => {};
  const savedIds = vi.fn(async () => {
    const ids = new Set(stored);
    if (savedIds.mock.calls.length === 1) {
      readStarted.resolve();
      await releaseRead.promise;
    }
    return ids;
  });
  const addCollected = vi.fn<CollectDeps['addCollected']>(async (seq) => {
    const fresh = seq.filter((item) => item.snapshot && !stored.has(item.tweetId));
    for (const item of fresh) stored.add(item.tweetId);
    return fresh.length;
  });
  const collector = new AutoCollector({
    now: () => 0,
    sleep: async () => {
      if (screen === 1) afterRead();
    },
    random: () => 0,
    scrollBy: () => { screen++; },
    scrollToTop: () => { screen = 0; },
    scrollY: () => screen * 1000,
    viewportHeight: () => 1000,
    visible: () => screen === 1 || (showInitially && screen === 0) ? [target] : [],
    hasUnseen: () => true,
    isLoading: () => false,
    hasLimit: () => false,
    pageOk: () => true,
    isHidden: () => false,
    accountId: () => 'me',
    savedIds,
    onDataChanged: (callback) => {
      changed = callback;
      return () => {};
    },
    addCollected,
    saveRun: async () => {},
    clearRun: async () => {},
  });
  collector.subscribe((state) => {
    if (state?.status === 'done') finished.resolve();
  });
  return {
    collector, stored, target, savedIds, addCollected, readStarted, releaseRead, finished,
    notify: () => changed(),
    afterRead: (callback: () => void) => { afterRead = callback; },
  };
}

beforeEach(() => {
  installChromeMock();
});

describe('保存済み ID の読み出し中の変更通知', () => {
  it('古い応答を読み直し、別画面で削除したポストだけでも保存と全文取得に含める', async () => {
    const worldState = world();
    const { collector, savedIds, stored, target } = worldState;
    await collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.readStarted.promise;
    stored.delete(target.tweetId);
    worldState.notify();
    worldState.releaseRead.resolve();
    await worldState.finished.promise;

    expect(savedIds).toHaveBeenCalledTimes(2);
    expect(savedIds).toHaveBeenNthCalledWith(2, 'me');
    expect(stored.has(target.tweetId)).toBe(true);
    expect(worldState.addCollected).toHaveBeenCalledTimes(1);
    expect(collector.state).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(collector.takeTruncated()).toEqual({ ids: [target.tweetId], scan: false });
  });

  it('読み出し中に通知が無ければ、保存済み ID は 1 回だけ読む', async () => {
    const worldState = world();
    await worldState.collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.readStarted.promise;
    worldState.releaseRead.resolve();
    await worldState.finished.promise;

    expect(worldState.savedIds).toHaveBeenCalledTimes(1);
    expect(worldState.addCollected).not.toHaveBeenCalled();
    expect(worldState.collector.state).toMatchObject({ imported: 0, skipped: 1 });
    expect(worldState.collector.takeTruncated()).toEqual({ ids: [], scan: false });
  });

  it('通知が続いても 3 回で読み出しを切り上げ、次の画面では読み直す', async () => {
    const worldState = world();
    const { collector, savedIds, stored, target } = worldState;
    savedIds.mockImplementation(async () => {
      const ids = new Set(stored);
      if (savedIds.mock.calls.length <= 3) {
        if (savedIds.mock.calls.length === 3) stored.delete(target.tweetId);
        worldState.notify();
      }
      return ids;
    });
    worldState.afterRead(() => {
      // 上限に達した応答をキャッシュせず、次画面の読み出しへ進む。
      expect(savedIds).toHaveBeenCalledTimes(3);
    });
    await collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.finished.promise;

    expect(savedIds).toHaveBeenCalledTimes(4);
    expect(stored.has(target.tweetId)).toBe(true);
    expect(collector.state).toMatchObject({ imported: 1, skipped: 0 });
    expect(collector.takeTruncated()).toEqual({ ids: [target.tweetId], scan: false });
  });

  it('読み直しの上限では最後の応答をその回の判定に使う', async () => {
    const worldState = world(true);
    const { collector, savedIds, stored, target } = worldState;
    savedIds.mockImplementation(async () => {
      if (savedIds.mock.calls.length === 3) stored.delete(target.tweetId);
      const ids = new Set(stored);
      if (savedIds.mock.calls.length <= 3) worldState.notify();
      return ids;
    });
    await collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.finished.promise;

    expect(stored.has(target.tweetId)).toBe(true);
    expect(collector.state).toMatchObject({ imported: 1, skipped: 0 });
    expect(collector.takeTruncated()).toEqual({ ids: [target.tweetId], scan: false });
  });
});
