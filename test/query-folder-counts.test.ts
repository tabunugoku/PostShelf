// 版: v76
import { describe, expect, it } from 'vitest';
import { countFolder, countFolders, RECENT_ID, RECENT_MS } from '../src/shared/query';
import { descendantsMap } from '../src/shared/folderTree';
import type { Bookmark, Folder } from '../src/shared/models';

const folders: Folder[] = [
  { id: 'parent', order: 0 },
  { id: 'child', parentId: 'parent', order: 1 },
  { id: 'grandchild', parentId: 'child', order: 2 },
  { id: 'sibling', parentId: 'parent', order: 3 },
  { id: 'other', order: 4 },
  { id: 'empty', order: 5 },
].map((f) => ({ ...f, accountId: 'me', name: 'Sample ' + f.id, icon: 'ti-folder' }));
const now = Date.parse('2026-10-15T00:00:00Z');
const memberships = [
  ['grandchild', 'child', 'parent', 'grandchild'], ['child', 'parent', 'sibling'],
  ['parent'], ['other', 'parent'], ['inbox', 'inbox'], [], ['missing'], ['all', RECENT_ID, 'inbox'],
];
const bookmarks: Bookmark[] = memberships.map((folderIds, index) => ({
  accountId: 'me', tweetId: String(index), folderIds,
  savedAt: now - RECENT_MS + index - 1,
  snapshot: { text: '架空の本文', author: 'Sample', handle: '@sample_counts', media: [], url: '' },
}));

describe('全フォルダの件数', () => {
  it.each([true, false])('祖先にも表示する = %s で変更前の countFolder と一致する', (showInAncestors) => {
    const descendantsOf = showInAncestors ? undefined : descendantsMap(folders);
    const counts = countFolders(bookmarks, now, descendantsOf);
    for (const id of ['all', 'inbox', RECENT_ID, 'missing', ...folders.map((f) => f.id)]) {
      expect(counts.get(id) ?? 0, id).toBe(countFolder(bookmarks, id, now, descendantsOf));
    }
  });

  it('空の一覧と子孫表でも変更前と一致する', () => {
    for (const all of [[], bookmarks]) {
      const counts = countFolders(all, now, new Map());
      for (const id of ['all', 'inbox', RECENT_ID, ...folders.map((f) => f.id)]) {
        expect(counts.get(id) ?? 0).toBe(countFolder(all, id, now, new Map()));
      }
    }
  });

  it('全ポストを一度だけ走査する', () => {
    let iterations = 0;
    const all = [...bookmarks];
    all[Symbol.iterator] = function* () {
      for (let index = 0; index < this.length; index++) {
        iterations++;
        yield this[index];
      }
      return undefined;
    };
    countFolders(all, now, descendantsMap(folders));
    expect(iterations).toBe(bookmarks.length);
  });
});
