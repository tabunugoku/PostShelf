import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as s from '../src/shared/storage';

const snapshot = { text: '架空の本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };

beforeEach(() => {
  const data = installChromeMock();
  data.schemaVersion = 2;
  data.folderIdsRepaired = true;
  s.setAccountScope('me');
});

const ids = async (tweetId: string) => new Set((await s.getBookmark(tweetId))!.folderIds);

/** A > C と、別の根 B、A の別の子 D を作る */
async function setup() {
  const a = await s.createFolder({ name: 'Sample A' });
  const b = await s.createFolder({ name: 'Sample B' });
  const c = await s.createFolder({ name: 'Sample C', parentId: a.id });
  const d = await s.createFolder({ name: 'Sample D', parentId: a.id });
  return { a, b, c, d };
}

it('子フォルダを別の親へ移すと、ポストが古い親から外れる', async () => {
  const { a, b, c } = await setup();
  await s.setBookmarkFolders('1', [c.id], snapshot);
  await s.setBookmarkFolders('2', [c.id], snapshot);
  await s.updateFolder(c.id, { parentId: b.id });
  expect(await ids('1')).toEqual(new Set([b.id, c.id]));
  expect(await ids('2')).toEqual(new Set([b.id, c.id]));
  expect((await s.listBookmarks()).filter((x) => x.folderIds.includes(a.id))).toHaveLength(0);
});

it('古い親の別の子にも入っているポストは、古い親に残る', async () => {
  const { a, b, c, d } = await setup();
  await s.setBookmarkFolders('1', [c.id, d.id], snapshot);
  await s.updateFolder(c.id, { parentId: b.id });
  expect(await ids('1')).toEqual(new Set([a.id, b.id, c.id, d.id]));
});

it('1 段目へ移すと、古い祖先がすべて外れる', async () => {
  const { a, c } = await setup();
  const g = await s.createFolder({ name: 'Sample G', parentId: c.id });
  await s.setBookmarkFolders('1', [g.id], snapshot);
  await s.reorderFolders([c.id], { id: c.id, parentId: null });
  expect(await ids('1')).toEqual(new Set([c.id, g.id]));
  expect((await ids('1')).has(a.id)).toBe(false);
});

it('同じ親の中の並べ替えでは、所属が変わらない', async () => {
  const { a, c, d } = await setup();
  await s.setBookmarkFolders('1', [c.id], snapshot);
  const before = await ids('1');
  await s.reorderFolders([d.id, c.id], { id: c.id, parentId: a.id });
  expect(await ids('1')).toEqual(before);
  await s.reorderFolders([c.id, d.id]);
  expect(await ids('1')).toEqual(before);
});

it('孫を持つフォルダを移すと、孫のポストも古い祖先から外れる', async () => {
  const { a, b, c } = await setup();
  const g = await s.createFolder({ name: 'Sample G', parentId: c.id });
  await s.setBookmarkFolders('1', [g.id], snapshot);
  await s.reorderFolders([c.id], { id: c.id, parentId: b.id });
  expect(await ids('1')).toEqual(new Set([b.id, c.id, g.id]));
  expect((await ids('1')).has(a.id)).toBe(false);
});

it('動かすフォルダに関係ないポストは変わらない', async () => {
  const { a, b, c, d } = await setup();
  await s.setBookmarkFolders('1', [d.id], snapshot);
  await s.updateFolder(c.id, { parentId: b.id });
  expect(await ids('1')).toEqual(new Set([a.id, d.id]));
});

it('付け替えでは、フォルダとポストを 1 回の書き込みで保存する', async () => {
  const { b, c } = await setup();
  await s.setBookmarkFolders('1', [c.id], snapshot);
  const spy = vi.spyOn(chrome.storage.local, 'set');
  await s.updateFolder(c.id, { parentId: b.id });
  expect(spy).toHaveBeenCalledTimes(1);
});
