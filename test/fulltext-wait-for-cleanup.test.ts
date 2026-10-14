// 版: v65-b
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  installChromeMock();
  vi.resetModules();
});

async function loadBackground(cleanup: () => Promise<void>) {
  const enqueue = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  vi.doMock('../src/background/fulltext', () => ({
    AUTO_CAP: 30,
    MANUAL_CAP: 50,
    cleanupAtStartup: cleanup,
    cleanupLegacyTabs: async () => {},
    manualItems: async () => [{ accountId: 'me', tweetId: '1' }],
    FullTextQueue: class { enqueue = enqueue; stop = stop; },
  }));
  const calls = installPanelMock();
  await import('../src/background/index');
  return { calls, enqueue, stop };
}

it('掃除が終わるまで、全文の取得の依頼は始まらない', async () => {
  let finish = () => {};
  const { calls, enqueue } = await loadBackground(() => new Promise<void>((r) => { finish = r; }));
  calls.onMessage!({ type: 'fetchFullText', accountId: 'me', tweetId: '1' }, {});
  calls.onMessage!({ type: 'fetchFullText', accountId: 'me', kind: 'manual' }, {});
  await flush();
  expect(enqueue).not.toHaveBeenCalled();
  finish();
  await flush();
  expect(enqueue).toHaveBeenCalledTimes(2);
});

it('掃除が終わるまで、停止の依頼も待つ', async () => {
  let finish = () => {};
  const { calls, stop } = await loadBackground(() => new Promise<void>((r) => { finish = r; }));
  calls.onMessage!({ type: 'stopFullText' }, {});
  await flush();
  expect(stop).not.toHaveBeenCalled();
  finish();
  await flush();
  expect(stop).toHaveBeenCalledTimes(1);
});

it('掃除が失敗しても、取得の依頼は受け付ける', async () => {
  const { calls, enqueue } = await loadBackground(() => Promise.reject(new Error('失敗')));
  calls.onMessage!({ type: 'fetchFullText', accountId: 'me', tweetId: '1' }, {});
  await flush();
  expect(enqueue).toHaveBeenCalledTimes(1);
});
