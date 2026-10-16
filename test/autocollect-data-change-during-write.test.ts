// 版: v77
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoCollector, FLUSH_EVERY, type CollectDeps } from '../src/content/autocollect';
import type { Extracted } from '../src/content/snapshot';
import { installChromeMock } from './chrome-mock';

const post = (index: number, truncated = false): Extracted => ({
  tweetId: `p${index}`,
  snapshot: {
    text: `架空の本文 ${index}`,
    author: 'Sample',
    handle: '@sample_user',
    media: [],
    url: `https://x.com/sample_user/status/${index}`,
    ...(truncated ? { truncated: true } : {}),
  },
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 最初の 20 件の保存を保留し、次の画面に未遭遇の保存済みポストを出す。 */
function world() {
  const deleted = post(FLUSH_EVERY + 1, true);
  const added = post(FLUSH_EVERY + 2, true);
  const stored = new Set([deleted.tweetId]);
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const finished = deferred();
  let screen = 0;
  let changed = () => {};
  let afterWrite = () => {};
  const savedIds = vi.fn(async () => new Set(stored));
  const addCollected = vi.fn<CollectDeps['addCollected']>(async (seq) => {
    if (addCollected.mock.calls.length === 1) {
      writeStarted.resolve();
      await releaseWrite.promise;
    }
    const fresh = seq.filter((item) => item.snapshot && !stored.has(item.tweetId));
    for (const item of fresh) stored.add(item.tweetId);
    return fresh.length;
  });
  const collector = new AutoCollector({
    now: () => 0,
    sleep: async () => {
      if (screen === 1) afterWrite();
    },
    random: () => 0,
    scrollBy: () => { screen++; },
    scrollToTop: () => { screen = 0; },
    scrollY: () => screen * 1000,
    viewportHeight: () => 1000,
    visible: () => {
      if (screen === 0) return Array.from({ length: FLUSH_EVERY }, (_, index) => post(index + 1));
      if (screen === 1) return [deleted, added];
      return [];
    },
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
    collector, stored, savedIds, addCollected, deleted, added, writeStarted, releaseWrite, finished,
    notify: () => changed(),
    afterWrite: (callback: () => void) => { afterWrite = callback; },
  };
}

beforeEach(() => {
  installChromeMock();
});

describe('保存データの変更と自動取り込みの保存済み ID', () => {
  it('書き込み中の通知を回収し、別画面での削除・保存を次の画面の判定に使う', async () => {
    const worldState = world();
    const { collector, savedIds, stored, deleted, added } = worldState;
    await collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.writeStarted.promise;
    stored.delete(deleted.tweetId);
    worldState.notify();
    stored.add(added.tweetId);
    worldState.notify();
    expect(savedIds).toHaveBeenCalledTimes(1);
    worldState.afterWrite(() => {
      // 書き込み後も、その次の読み取りまでは保存済み ID を問い合わせない。
      expect(savedIds).toHaveBeenCalledTimes(1);
    });
    worldState.releaseWrite.resolve();
    await worldState.finished.promise;

    expect(savedIds).toHaveBeenCalledTimes(2);
    expect(savedIds).toHaveBeenNthCalledWith(2, 'me');
    expect(stored.has(deleted.tweetId)).toBe(true);
    expect(worldState.addCollected).toHaveBeenCalledTimes(2);
    expect(collector.state).toMatchObject({ imported: FLUSH_EVERY + 1, skipped: 1, failed: 0 });
    expect(collector.takeTruncated()).toEqual({ ids: [deleted.tweetId], scan: false });
  });

  it('書き込み中に通知が無ければ、保存済み ID を読み直さない', async () => {
    const worldState = world();
    await worldState.collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.writeStarted.promise;
    worldState.releaseWrite.resolve();
    await worldState.finished.promise;

    expect(worldState.savedIds).toHaveBeenCalledTimes(1);
    expect(worldState.collector.state).toMatchObject({ imported: FLUSH_EVERY + 1, skipped: 1 });
    expect(worldState.collector.takeTruncated()).toEqual({ ids: [worldState.added.tweetId], scan: false });
  });

  it('書き込み中でない通知でも、保存済み ID を読み直す', async () => {
    const worldState = world();
    worldState.afterWrite(() => {
      worldState.afterWrite(() => {});
      worldState.stored.delete(worldState.deleted.tweetId);
      worldState.notify();
    });
    await worldState.collector.start({ consent: true, accountId: 'me', cap: 0 });
    await worldState.writeStarted.promise;
    worldState.releaseWrite.resolve();
    await worldState.finished.promise;

    expect(worldState.savedIds).toHaveBeenCalledTimes(2);
    expect(worldState.collector.state).toMatchObject({ imported: FLUSH_EVERY + 2, skipped: 0 });
    expect(worldState.collector.takeTruncated()).toEqual({
      ids: [worldState.deleted.tweetId, worldState.added.tweetId], scan: false,
    });
  });
});
