// 版: v76
import { seedBookmarks } from './stored-bookmarks';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Card, type CardOuterProps, type RowHandlers } from '../src/manager/Cards';
import { App } from '../src/manager/App';
import * as tree from '../src/shared/folderTree';
import { setAccountScope, updateFolder } from '../src/shared/storage';
import type { Bookmark, Folder } from '../src/shared/models';
import type { ViewMode } from '../src/shared/settings';
import { installChromeMock } from './chrome-mock';

const folders: Folder[] = [
  { id: 'other', order: 1 }, { id: 'parent', order: 0 },
  { id: 'sibling', parentId: 'parent', order: 1 },
  { id: 'grandchild', parentId: 'child', order: 0 },
  { id: 'child', parentId: 'parent', order: 0 }, { id: 'inbox', order: 2 },
].map((f) => ({ ...f, name: 'Sample ' + f.id, accountId: 'me', icon: 'ti-folder' }));
const bookmark: Bookmark = {
  accountId: 'me', tweetId: '1', savedAt: 1,
  folderIds: ['other', 'parent', 'sibling', 'grandchild', 'child'],
  snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_chips', media: [], url: '' },
};
const noop = () => {};
const handlers: RowHandlers = {
  select: noop, focus: noop, removeFromFolder: noop, togglePicker: noop,
  del: noop, dragStart: noop, openImage: noop, openVideo: noop,
};
const props: CardOuterProps = {
  b: bookmark, view: 'post', compact: false, selected: false, selectionActive: false, tabbable: true,
  folderOf: (id) => folders.find((f) => f.id === id), folders, pickerOpen: false, pickerNode: null, h: handlers,
};
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
const chipIds = () => [...document.querySelectorAll('[data-member-folder]')]
  .map((chip) => chip.getAttribute('data-member-folder'));

beforeEach(() => {
  installChromeMock();
  vi.spyOn(window, 'scrollTo').mockImplementation(noop);
});
afterEach(() => {
  render(null, document.body);
  vi.restoreAllMocks();
});

it.each<ViewMode>(['post', 'list', 'grid'])('%s のチップと順番が変更前と一致する', async (view) => {
  const leafMembers = tree.leafMemberResolver(folders);
  for (const folderIds of [bookmark.folderIds, ['child', 'parent'], ['inbox'], ['missing'], []]) {
    const current = { ...props, view, b: { ...bookmark, folderIds } };
    await act(() => void render(<Card {...current} />, document.body));
    const previousMarkup = document.body.innerHTML;
    expect(chipIds()).toEqual(tree.leafMemberFolders(folders, folderIds).map((f) => f.id));
    await act(() => void render(<Card {...current} leafMembers={leafMembers} />, document.body));
    expect(document.body.innerHTML).toBe(previousMarkup);
  }
});

it('同じ木の再描画で leafMemberFolders を呼ばず、カードの memo も保つ', async () => {
  const leafMembers = vi.fn(tree.leafMemberResolver(folders));
  const fallback = vi.spyOn(tree, 'leafMemberFolders');
  await act(() => void render(<Card {...props} leafMembers={leafMembers} />, document.body));
  expect(leafMembers).toHaveBeenCalledTimes(1);
  await act(() => void render(<Card {...props} leafMembers={leafMembers} />, document.body));
  expect(leafMembers).toHaveBeenCalledTimes(1);
  await act(() => void render(<Card {...props} selected leafMembers={leafMembers} />, document.body));
  expect(leafMembers).toHaveBeenCalledTimes(2);
  expect(fallback).not.toHaveBeenCalled();
});

it('folders と計算関数が無ければ変更前と同じチップを出す', async () => {
  const fallback = vi.spyOn(tree, 'leafMemberFolders');
  await act(() => void render(<Card {...props} folders={undefined} />, document.body));
  expect(fallback).toHaveBeenCalledOnce();
  const known = bookmark.folderIds.map(props.folderOf).filter((f): f is Folder => !!f);
  expect(chipIds()).toEqual(tree.leafMemberFolders(known, bookmark.folderIds).map((f) => f.id));
});

it('管理画面は検索時に計算関数を保ち、フォルダの変更で作り直す', async () => {
  const data = installChromeMock();
  setAccountScope('me');
  Object.assign(data, {
    folders,
  });
  seedBookmarks(data, Object.values({ 'me:1': bookmark }));
  const resolver = vi.spyOn(tree, 'leafMemberResolver');
  const fallback = vi.spyOn(tree, 'leafMemberFolders');
  await act(() => void render(<App />, document.body));
  await flush();
  await flush();
  resolver.mockClear();
  await act(() => {
    const search = document.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = '架空';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(resolver).not.toHaveBeenCalled();
  await act(async () => { await updateFolder('grandchild', { name: 'Sample renamed' }); });
  await flush();
  expect(resolver).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-member-folder="grandchild"] .folder-chip-label')!.textContent)
    .toBe('Sample renamed');
  expect(fallback).not.toHaveBeenCalled();
});
