// 版: v56-d
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import * as avatars from '../src/manager/avatars';
import type { Bookmark } from '../src/shared/models';
import { App } from '../src/manager/App';
import { installChromeMock } from './chrome-mock';
import { changeBookmarkFolders } from '../src/shared/storage';
import { updateSettings } from '../src/shared/settings';

const icon = 'https://pbs.twimg.com/profile_images/sample-v56.jpg';
const newer = 'https://pbs.twimg.com/profile_images/sample-v56-new.jpg';
const bookmark = (tweetId: string, savedAt: number, avatar?: string): Bookmark => ({
  accountId: 'me', tweetId, savedAt, folderIds: ['sample_folder'],
  snapshot: {
    text: '架空の本文。', author: 'Sample User', handle: '@sample_user', avatar, media: [],
    url: `https://x.com/sample_user/status/${tweetId}`,
  },
});
afterEach(async () => {
  const app = document.getElementById('app');
  if (app) await act(() => void render(null, app));
  vi.restoreAllMocks();
});

it('フォルダだけが変わる一覧では代用表の参照を変えない', () => {
  const bookmarks = [bookmark('1', 1, icon), bookmark('2', 2)];
  const previous = avatars.buildAvatarFallback(bookmarks);
  const changed = bookmarks.map((b) => ({ ...b, folderIds: ['sample_other_folder'] }));
  expect(avatars.buildAvatarFallback(changed, previous)).toBe(previous);
});

it('アイコンが変わったときは新しい参照を返す', () => {
  const previous = avatars.buildAvatarFallback([bookmark('1', 1, icon)]);
  const next = avatars.buildAvatarFallback([bookmark('1', 1, newer)], previous);
  expect(next).not.toBe(previous);
  expect(next.get('sample_user')).toBe(newer);
});

it('絵文字と空のアイコンを除き同じハンドルの最新の本物を使う', () => {
  const bookmarks = [
    bookmark('1', 1, icon), bookmark('2', 2, newer),
    bookmark('3', 3, 'https://abs.twimg.com/emoji/v2/svg/1f383.svg'), bookmark('4', 4, ''),
  ];
  const previous = avatars.buildAvatarFallback(bookmarks);
  expect([...previous]).toEqual([['sample_user', newer]]);
  expect(avatars.buildAvatarFallback(bookmarks.map((b) => ({ ...b })), previous)).toBe(previous);
});

it('空の表の内容が同じなら参照を変えず候補が消えれば新しくする', () => {
  const empty = avatars.buildAvatarFallback([bookmark('1', 1)]);
  expect(avatars.buildAvatarFallback([], empty)).toBe(empty);
  const filled = avatars.buildAvatarFallback([bookmark('1', 1, icon)]);
  expect(avatars.buildAvatarFallback([], filled)).not.toBe(filled);
});

it('管理画面のフォルダ変更は Context に渡す代用表の参照を変えない', async () => {
  const data = installChromeMock();
  Object.assign(data, {
    schemaVersion: 2, folderIdsRepaired: true,
    folders: [
      { id: 'sample_folder', accountId: 'me', name: 'Sample Folder', icon: 'ti-folder', order: 0 },
      { id: 'sample_other', accountId: 'me', name: 'Sample Other', icon: 'ti-folder', order: 1 },
    ],
    bookmarks: { 'me:1': bookmark('1', 1, icon), 'me:2': bookmark('2', 2) },
  });
  await updateSettings({ viewAccount: 'me' });
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const build = vi.spyOn(avatars, 'buildAvatarFallback');
  const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
  await act(() => void render(<App />, document.getElementById('app')!));
  await flush();
  await flush();
  const previous = build.mock.results.at(-1)!.value;
  const calls = build.mock.calls.length;
  await act(async () => { await changeBookmarkFolders(['1', '2'], ['sample_other'], []); });
  await flush();
  expect(build.mock.calls.length).toBeGreaterThan(calls);
  expect(build.mock.results.at(-1)!.value).toBe(previous);
  expect(document.querySelector<HTMLImageElement>('[data-row="2"] img.av')!.getAttribute('src')).toBe(icon);
});
