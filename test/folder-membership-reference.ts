// 版: v76
import { ancestors, descendants } from '../src/shared/folderTree';
import { ALL_FOLDER_ID, INBOX_ID, type Folder } from '../src/shared/models';

/** v76 より前の withAncestors。所属 ID の順番まで比較するための参照実装 */
export function previousWithAncestors(ids: readonly string[], folders: readonly Folder[]): string[] {
  const real = [...new Set(ids.filter((id) => id !== ALL_FOLDER_ID && id !== INBOX_ID))];
  if (!real.length) return [INBOX_ID];
  return [...new Set([...real, ...real.flatMap((id) => ancestors(folders, id).map((f) => f.id))])];
}

/** v76 より前の withoutDescendants。解除対象とその子孫をポストごとに計算する */
export function previousWithoutDescendants(
  ids: readonly string[],
  removed: readonly string[],
  folders: readonly Folder[],
): string[] {
  const exclude = new Set(removed.flatMap((id) => [id, ...descendants(folders, id).map((f) => f.id)]));
  return ids.filter((id) => !exclude.has(id));
}

/** v76 より前の reparentedFolderIds。付け替え前後の所属を順番も含めて比較する */
export function previousReparentedFolderIds(
  ids: readonly string[],
  folders: readonly Folder[],
  movedId: string,
  oldAncestorIds: readonly string[],
): string[] {
  const subtree = new Set([movedId, ...descendants(folders, movedId).map((f) => f.id)]);
  if (!ids.some((id) => subtree.has(id))) return [...ids];
  const newAncestorIds = new Set(ancestors(folders, movedId).map((f) => f.id));
  const stale = new Set(oldAncestorIds.filter((id) => !newAncestorIds.has(id)));
  return previousWithAncestors(ids.filter((id) => !stale.has(id)), folders);
}

/** 祖先の復元や別の枝への所属も試せる、架空の三段の木 */
export function sampleFolderTree(): Folder[] {
  return [
    { id: 'parent', order: 0 }, { id: 'child', parentId: 'parent', order: 0 },
    { id: 'grandchild', parentId: 'child', order: 0 }, { id: 'sibling', parentId: 'parent', order: 1 },
    { id: 'other', order: 1 }, { id: 'inbox', order: 2 },
  ].map((f) => ({ ...f, accountId: 'me', name: 'Sample ' + f.id, icon: 'ti-folder' }));
}
