// 版: v76
import { afterEach, expect, it, vi } from 'vitest';
import {
  reparentedFolderIds, reparentedFolderResolver, withAncestorResolver, withoutDescendantsResolver,
} from '../src/shared/folderTree';
import {
  previousReparentedFolderIds, previousWithAncestors, previousWithoutDescendants, sampleFolderTree,
} from './folder-membership-reference';

const folders = sampleFolderTree();
const possibleIds = ['parent', 'child', 'grandchild', 'sibling', 'other', 'inbox', 'missing', 'all'];
const memberships = Array.from({ length: 1 << possibleIds.length }, (_, mask) =>
  possibleIds.filter((_, index) => mask & (1 << index)));
memberships.push(['grandchild', 'child', 'grandchild', 'parent'], ['inbox', 'inbox']);
afterEach(() => vi.restoreAllMocks());

it('祖先表を使った結果と ID の順番が変更前と一致する', () => {
  // 壊れた親・別アカウント・循環も、既存の ancestors の規則を保つ。
  const malformed = [
    ...folders,
    { ...folders[0], id: 'missing-parent', parentId: 'missing' },
    { ...folders[0], id: 'foreign', accountId: 'sample_other', parentId: 'parent' },
    { ...folders[0], id: 'cycle-a', parentId: 'cycle-b' },
    { ...folders[0], id: 'cycle-b', parentId: 'cycle-a' },
  ];
  for (const tree of [folders, malformed]) {
    const resolve = withAncestorResolver(tree);
    for (const ids of [...memberships, ['cycle-a', 'foreign', 'missing-parent']]) {
      expect(resolve(ids)).toEqual(previousWithAncestors(ids, tree));
    }
  }
});

it('解除する子孫集合を使った結果が変更前と一致する', () => {
  for (const removed of [[], ['parent'], ['child'], ['grandchild'], ['child', 'other'], ['missing'], ['inbox']]) {
    const resolve = withoutDescendantsResolver(removed, folders);
    for (const ids of memberships) {
      expect(resolve(ids)).toEqual(previousWithoutDescendants(ids, removed, folders));
    }
  }
});

it('付け替え用の計算関数と単発の関数の結果が変更前と一致する', () => {
  for (const parentId of ['other', undefined]) {
    const moved = folders.map((f) => f.id === 'child' ? { ...f, parentId } : f);
    const resolve = reparentedFolderResolver(moved, 'child', ['parent']);
    for (const ids of memberships) {
      const expected = previousReparentedFolderIds(ids, moved, 'child', ['parent']);
      expect(resolve(ids)).toEqual(expected);
      expect(reparentedFolderIds(ids, moved, 'child', ['parent'])).toEqual(expected);
    }
  }
});

it('子孫と祖先の木の走査は、ポストの件数が増えても増えない', () => {
  const tree = sampleFolderTree();
  // descendants は木を filter し、ancestors は find する。計算関数の呼び出しで増えないことを測る。
  const filter = vi.spyOn(tree, 'filter');
  const find = vi.spyOn(tree, 'find');
  const reparent = reparentedFolderResolver(tree, 'child', ['other']);
  const remove = withoutDescendantsResolver(['child', 'other'], tree);
  const include = withAncestorResolver(tree);
  expect(filter).toHaveBeenCalledTimes(3); // 付け替えの子孫と、解除する二つの子孫
  const findCount = find.mock.calls.length;
  expect(findCount).toBeGreaterThan(0);
  for (let index = 0; index < 1000; index++) {
    reparent(['grandchild', 'child', 'parent']);
    include(remove(['grandchild', 'child', 'parent', 'other']));
  }
  expect(filter).toHaveBeenCalledTimes(3);
  expect(find).toHaveBeenCalledTimes(findCount);
});
