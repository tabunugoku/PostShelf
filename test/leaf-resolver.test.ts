import { describe, expect, it } from 'vitest';
import type { Folder } from '../src/shared/models';
import { leafMemberFolders, leafMemberResolver } from '../src/shared/folderTree';

const folder = (id: string, order: number, parentId?: string, accountId = 'me'): Folder => ({
  id,
  name: id,
  icon: 'ti-folder',
  order,
  accountId,
  ...(parentId ? { parentId } : {}),
});

/** A > C > G、B、別アカウントの親を指す壊れた D、存在しない親を指す E */
const folders = [
  folder('A', 0),
  folder('C', 0, 'A'),
  folder('G', 0, 'C'),
  folder('B', 1),
  folder('X', 2, undefined, 'other'),
  folder('D', 3, 'X'),
  folder('E', 4, 'missing'),
];
const allIds = folders.map((f) => f.id);

describe('leafMemberResolver', () => {
  it('returns the same folders as leafMemberFolders for every combination of ids', () => {
    const resolve = leafMemberResolver(folders);
    for (let mask = 0; mask < 1 << allIds.length; mask++) {
      const ids = allIds.filter((_, i) => mask & (1 << i));
      expect(resolve(ids).map((f) => f.id)).toEqual(leafMemberFolders(folders, ids).map((f) => f.id));
    }
  });

  it('ignores ids that are not folders (Unsorted and unknown ids)', () => {
    const resolve = leafMemberResolver(folders);
    expect(resolve(['inbox', 'nope'])).toEqual([]);
    expect(resolve(['A', 'C', 'G', 'B']).map((f) => f.id)).toEqual(['G', 'B']);
  });
});
