import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { buildAvatarFallback } from '../src/manager/avatars';
import { createFolder, setBookmarkFolders } from '../src/shared/storage';
import type { Bookmark } from '../src/shared/models';

const oldAvatar = 'https://pbs.twimg.com/profile_images/sample-old.jpg';
const newAvatar = 'https://pbs.twimg.com/profile_images/sample-new.jpg';
const snap = (id: number, handle: string, avatar?: string) => ({
  text: `架空の本文 ${id}`,
  author: 'Sample',
  handle,
  media: [],
  url: `https://x.com/${handle.slice(1)}/status/${id}`,
  ...(avatar ? { avatar } : {}),
});
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const row = (id: number) => $(`[data-row="${id}"]`);

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  const folder = (await createFolder({ name: 'Alpha' })).id;
  await setBookmarkFolders('1', [folder], snap(1, '@Sample_Same', oldAvatar));
  await setBookmarkFolders('2', [folder], snap(2, '@sample_same', newAvatar));
  await setBookmarkFolders('3', [folder], snap(3, '@sample_same'));
  await setBookmarkFolders('4', [folder], snap(4, '@sample_none'));
  const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
  for (const k of Object.keys(data)) data[k].savedAt = Number(k.split(':')[1]);
  await chrome.storage.local.set({ bookmarks: data });
  await act(() => void render(<App />, $('#app')));
  await flush();
});
afterEach(() => render(null, $('#app')));

it('uses the newest avatar of the same handle (case-insensitive) when the saved one is empty', () => {
  expect(row(3).querySelector<HTMLImageElement>('img.av')?.getAttribute('src')).toBe(newAvatar);
});

it('keeps the saved avatar and shows initials when no other post has one', () => {
  expect(row(1).querySelector<HTMLImageElement>('img.av')?.getAttribute('src')).toBe(oldAvatar);
  expect(row(4).querySelector('img.av')).toBeNull();
  expect(row(4).querySelector('span.av')?.textContent).toBe('SA');
});

it('builds the fallback table from the newest post per handle without touching the posts', () => {
  const b = (tweetId: string, savedAt: number, handle: string, avatar?: string) =>
    ({ accountId: 'me', tweetId, savedAt, folderIds: [], snapshot: snap(Number(tweetId), handle, avatar) }) as Bookmark;
  const table = buildAvatarFallback([
    b('1', 1, '@Sample_A', oldAvatar),
    b('2', 5, '@sample_a', newAvatar),
    b('3', 9, '@sample_a'),
  ]);
  expect([...table]).toEqual([['sample_a', newAvatar]]);
});
