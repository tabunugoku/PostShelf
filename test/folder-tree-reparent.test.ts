import { describe, expect, it } from 'vitest';
import { INBOX_ID, type Folder } from '../src/shared/models';
import {
  ancestors,
  normalizeFolderIds,
  reparentedFolderIds,
  withoutDeletedFolders,
} from '../src/shared/folderTree';

const folder = (id: string, order: number, parentId?: string): Folder => ({
  id,
  name: id,
  icon: 'ti-folder',
  order,
  accountId: 'me',
  ...(parentId ? { parentId } : {}),
});

/** A > C > G と B の木。C を B の下へ移したあとの木も作る */
const before = [folder('A', 0), folder('C', 0, 'A'), folder('G', 0, 'C'), folder('B', 1)];
const after = [folder('A', 0), folder('C', 0, 'B'), folder('G', 0, 'C'), folder('B', 1)];
const oldAncestorIds = ancestors(before, 'C').map((f) => f.id);

describe('reparentedFolderIds', () => {
  it('moves a post out of the old ancestor and into the new one', () => {
    expect(reparentedFolderIds(['G', 'C', 'A'], after, 'C', oldAncestorIds).sort()).toEqual(['B', 'C', 'G']);
  });

  it('keeps A when the post is also in another folder under A', () => {
    const ids = reparentedFolderIds(['G', 'C', 'A', 'D'], [...after, folder('D', 1, 'A')], 'C', oldAncestorIds);
    expect(ids.sort()).toEqual(['A', 'B', 'C', 'D', 'G']);
  });

  it('removes A even when it was chosen directly', () => {
    expect(reparentedFolderIds(['C', 'A'], after, 'C', oldAncestorIds).sort()).toEqual(['B', 'C']);
  });

  it('leaves a post outside the moved subtree unchanged', () => {
    expect(reparentedFolderIds(['A'], after, 'C', oldAncestorIds)).toEqual(['A']);
  });
});

describe('withoutDeletedFolders', () => {
  it('removes the deleted folder and its descendants but keeps A', () => {
    expect(withoutDeletedFolders(['G', 'C', 'A'], new Set(['C', 'G']))).toEqual(['A']);
  });

  it('falls back to Unsorted through normalizeFolderIds when nothing is left', () => {
    expect(normalizeFolderIds(withoutDeletedFolders(['G', 'C'], new Set(['C', 'G'])))).toEqual([INBOX_ID]);
  });
});
