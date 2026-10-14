// 版: v47-d
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue, defaultDeps, type FullTextDeps } from '../src/background/fulltext';
import { getBookmark, setAccountScope, setBookmarkFolders, type FillView } from '../src/shared/storage';

const avatar = 'https://pbs.twimg.com/profile_images/sample-bg.jpg';
const view: FillView = { author: 'Sample', handle: '@sample_one', media: [], avatar };
const item = { accountId: 'me', tweetId: '1' };
function fake(over: Partial<FullTextDeps> = {}) {
  let t = 1_000_000;
  let next = 1;
  const d: FullTextDeps = {
    ...defaultDeps(),
    now: () => t,
    sleep: async (ms) => void ((t += ms), await Promise.resolve()),
    random: () => 0.5,
    openTab: async () => next++,
    closeTab: async () => {},
    ask: async () => ({ ok: true, text: '架空の全文', fill: view }),
    collectActive: async () => false,
    setTab: async () => {},
    ...over,
  };
  return d;
}

beforeEach(async () => {
  installChromeMock();
  setAccountScope('me');
  await setBookmarkFolders('1', [], {
    text: '短い',
    author: 'Sample',
    handle: '@sample_one',
    media: [],
    url: 'https://x.com/sample_one/status/1',
    truncated: true,
  });
});

it('fills the avatar together with the full text', async () => {
  await new FullTextQueue(fake()).enqueue([item], 'manual');
  const saved = (await getBookmark('1'))!.snapshot;
  expect(saved.text).toBe('架空の全文');
  expect(saved.avatar).toBe(avatar);
});

it('still fills missing fields when updating the text fails', async () => {
  const fill = vi.fn(async () => 1);
  const d = fake({ refresh: async () => { throw new Error('sample failure'); }, fill });
  await new FullTextQueue(d).enqueue([item], 'manual');
  expect(fill).toHaveBeenCalledWith(item, view);
});
