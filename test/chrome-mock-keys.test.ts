// 版: v83
import { expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { seedBookmarks, storedBookmarks } from './stored-bookmarks';
import type { Bookmark } from '../src/shared/models';

it('getKeys は保存しているキーをすべて返す', async () => {
  installChromeMock();
  await chrome.storage.local.set({ first: 1, second: 2 });
  expect(await chrome.storage.local.getKeys()).toEqual(['first', 'second']);
});

it('同じ tweetId を別のアカウントで保存し、再準備で前のポストを消す', () => {
  const data = installChromeMock();
  const list: Bookmark[] = ['sample_a', 'sample_b'].map((accountId) => ({
    accountId,
    tweetId: '1',
    folderIds: ['inbox'],
    savedAt: 1,
    snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_author', media: [], url: '' },
  }));
  seedBookmarks(data, list);
  expect(Object.values(storedBookmarks(data))).toEqual(list);
  seedBookmarks(data, [list[1]]);
  expect(storedBookmarks(data)).toEqual({ 'sample_b:1': list[1] });
});

it.each(['first', ['first', 'second']])('remove はキーを消し、削除を通知する: %s', async (keys) => {
  installChromeMock();
  await chrome.storage.local.set({ first: 1, second: 2 });
  const changed = vi.fn();
  chrome.storage.onChanged.addListener(changed);
  await chrome.storage.local.remove(keys);
  expect(changed.mock.calls[0][0].first).toStrictEqual({ oldValue: 1, newValue: undefined });
  expect(await chrome.storage.local.get('first')).toEqual({});
  expect(await chrome.storage.local.getKeys()).not.toContain('first');
});
