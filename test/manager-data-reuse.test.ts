// 版: v79
import { expect, it } from 'vitest';
import { reuseBookmarks, reuseFolders } from '../src/manager/reuse';
import type { Bookmark, Folder } from '../src/shared/models';

const bookmark = (tweetId: string, accountId = 'me'): Bookmark => ({
  accountId,
  tweetId,
  savedAt: 1,
  folderIds: ['sample_folder'],
  snapshot: {
    text: '架空の本文',
    author: 'サンプル',
    handle: '@sample_author',
    media: [],
    url: 'https://x.com/sample_author/status/' + tweetId,
  },
});
const folder = (id: string, accountId = 'me'): Folder => ({
  id, accountId, name: '架空の棚', icon: 'ti-folder', order: 0,
});

it('同じポストの配列と要素を使い回し、入力を変えない', () => {
  const previous = [bookmark('1'), bookmark('2')];
  const incoming = structuredClone(previous);
  expect(reuseBookmarks(previous, incoming)).toBe(previous);
  incoming[1].snapshot.text = '架空の全文';
  const result = reuseBookmarks(previous, incoming);
  expect(result).not.toBe(previous);
  expect(result[0]).toBe(previous[0]);
  expect(result[1]).toBe(incoming[1]);
  expect(previous[1].snapshot.text).toBe('架空の本文');
  expect(incoming[0]).not.toBe(previous[0]);
});

it('ポストの追加・削除・並べ替えでも変わらない要素を使う', () => {
  const previous = [bookmark('1'), bookmark('2')];
  const added = bookmark('3');
  const result = reuseBookmarks(previous, [structuredClone(previous[1]), added]);
  expect(result).toEqual([previous[1], added]);
  expect(result[0]).toBe(previous[1]);
  const reordered = reuseBookmarks(previous, structuredClone([...previous].reverse()));
  expect(reordered).toEqual([...previous].reverse());
  expect(reordered[0]).toBe(previous[1]);
});

it('同じフォルダの配列を使い回し、変更した要素だけを入れ替える', () => {
  const previous = [folder('sample_folder'), folder('sample_other')];
  const incoming = structuredClone(previous);
  expect(reuseFolders(previous, incoming)).toBe(previous);
  incoming[1].color = '#E24B4A';
  const result = reuseFolders(previous, incoming);
  expect(result[0]).toBe(previous[0]);
  expect(result[1]).toBe(incoming[1]);
  expect(reuseFolders(previous, structuredClone([...previous].reverse()))[1]).toBe(previous[0]);
});

it('同じIDのポストとフォルダをアカウントごとに区別する', () => {
  const posts = [bookmark('1'), bookmark('1', 'sample_other')];
  const folders = [folder('sample_folder'), folder('sample_folder', 'sample_other')];
  const reorderedPosts = reuseBookmarks(posts, structuredClone([...posts].reverse()));
  const reorderedFolders = reuseFolders(folders, structuredClone([...folders].reverse()));
  expect(reorderedPosts[0]).toBe(posts[1]);
  expect(reorderedPosts[1]).toBe(posts[0]);
  expect(reorderedFolders[0]).toBe(folders[1]);
  expect(reorderedFolders[1]).toBe(folders[0]);
  expect(reuseBookmarks([posts[0]], [structuredClone(posts[1])])[0]).not.toBe(posts[0]);
});

it('空から空・1件への追加・空への削除を扱う', () => {
  const posts: Bookmark[] = [];
  const folders: Folder[] = [];
  expect(reuseBookmarks(posts, [])).toBe(posts);
  expect(reuseFolders(folders, [])).toBe(folders);
  const addedPost = bookmark('1');
  const addedFolder = folder('sample_folder');
  expect(reuseBookmarks(posts, [addedPost])).toEqual([addedPost]);
  expect(reuseFolders(folders, [addedFolder])).toEqual([addedFolder]);
  expect(reuseBookmarks([addedPost], [])).toEqual([]);
  expect(reuseFolders([addedFolder], [])).toEqual([]);
});
