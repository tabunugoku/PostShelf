import { ALL_FOLDER_ID, INBOX_ID, displayName, type Folder } from './models';

/** フォルダの段数の上限 (1 段目 → 子 → 孫) */
export const MAX_FOLDER_DEPTH = 3;

/** 組み込みフォルダ (すべて・未分類) ではない、ユーザーのフォルダか */
const user = (id: string) => id !== ALL_FOLDER_ID && id !== INBOX_ID;

/** 親子の関係は、同じアカウントの中だけで結ぶ。壊れた親の参照は、1 段目として扱う。祖先を、1 段目から順に返す */
export function ancestors(folders: readonly Folder[], id: string): Folder[] {
  const f = folders.find((f) => f.id === id);
  if (!f) return [];
  const seen = new Set([id]);
  const out: Folder[] = [];
  let parent = f.parentId;
  while (parent && !seen.has(parent)) {
    const p = folders.find((p) => p.id === parent && p.accountId === f.accountId && user(p.id));
    if (!p) break;
    seen.add(parent);
    out.unshift(p);
    parent = p.parentId;
  }
  return out;
}

/** フォルダの段数 (1 段目 = 1) */
export const folderDepth = (folders: readonly Folder[], id: string): number => ancestors(folders, id).length + 1;

/** 子・孫のフォルダすべて */
export function descendants(folders: readonly Folder[], id: string): Folder[] {
  return folders.filter((f) => f.id !== id && ancestors(folders, f.id).some((p) => p.id === id));
}

/** ancestors と同じ親の規則で、全フォルダの子孫 ID の対応表を作る */
export function descendantsMap(folders: readonly Folder[]): ReadonlyMap<string, ReadonlySet<string>> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map(folders.map((f) => [f.id, new Set<string>()]));
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent || parent.accountId !== folder.accountId || !user(parent.id)) break;
      seen.add(parentId);
      children.get(parentId)!.add(folder.id);
      parentId = parent.parentId;
    }
  }
  return children;
}

/**
 * id のフォルダを parentId の下に置けるか。parentId が空なら 1 段目 (いつも置ける)。
 * id が無いときは、新しく作るフォルダ (accountId はその所属先)。
 * 自分自身・自分の子孫・組み込みフォルダ・別アカウントの下、そして 3 段を超える位置には置けない。
 */
export function canParent(
  folders: readonly Folder[],
  id: string | undefined,
  parentId: string | null | undefined,
  accountId?: string,
): boolean {
  const f = id ? folders.find((f) => f.id === id) : undefined;
  if (id && (!f || !user(id))) return false;
  if (!parentId) return true;
  const p = folders.find((f) => f.id === parentId);
  if (!p || !user(p.id) || parentId === id || p.accountId !== (f?.accountId ?? accountId)) return false;
  if (id && descendants(folders, id).some((f) => f.id === parentId)) return false;
  // 動かすフォルダ自身を含む、その下の段の数
  const height = f
    ? Math.max(folderDepth(folders, f.id), ...descendants(folders, f.id).map((c) => folderDepth(folders, c.id))) - folderDepth(folders, f.id) + 1
    : 1;
  return folderDepth(folders, parentId) + height <= MAX_FOLDER_DEPTH;
}

export interface FolderRow {
  folder: Folder;
  depth: number;
  hasChildren: boolean;
}

/** 深さ優先で、親 → 子 → 孫の順に並べる。collapsed に入っている親の子孫は出さない */
export function flattenFolders(folders: readonly Folder[], collapsed: ReadonlySet<string> = new Set()): FolderRow[] {
  const out: FolderRow[] = [];
  const visited = new Set<string>();
  const walk = (f: Folder, depth: number) => {
    if (visited.has(f.id)) return;
    visited.add(f.id);
    const children = folders.filter((c) => c.parentId === f.id && c.accountId === f.accountId).sort((a, b) => a.order - b.order);
    out.push({ folder: f, depth, hasChildren: children.length > 0 });
    if (!collapsed.has(f.id)) children.forEach((c) => walk(c, depth + 1));
  };
  folders
    .filter((f) => !f.parentId || !folders.some((p) => p.id === f.parentId && p.accountId === f.accountId))
    .sort((a, b) => a.order - b.order)
    .forEach((f) => walk(f, 1));
  return out;
}

/** 所属先に、祖先を足す。ユーザーのフォルダが 1 つも無ければ未分類だけにする */
export function withAncestors(ids: readonly string[], folders: readonly Folder[]): string[] {
  const real = [...new Set(ids.filter((id) => user(id)))];
  if (!real.length) return [INBOX_ID];
  return [...new Set([...real, ...real.flatMap((id) => ancestors(folders, id).map((f) => f.id))])];
}

/** 所属先に祖先を補う関数を作る。一括操作中は同じ木の祖先表を使い回す */
export function withAncestorResolver(folders: readonly Folder[]): (ids: readonly string[]) => string[] {
  const ancestorIds = new Map(folders.map((f) => [f.id, ancestors(folders, f.id).map((p) => p.id)]));
  return (ids) => {
    const real = [...new Set(ids.filter((id) => user(id)))];
    if (!real.length) return [INBOX_ID];
    return [...new Set([...real, ...real.flatMap((id) => ancestorIds.get(id) ?? [])])];
  };
}

/** 解除するフォルダとその子孫を一度求め、所属先から外す関数を作る */
export function withoutDescendantsResolver(
  removed: readonly string[],
  folders: readonly Folder[],
): (ids: readonly string[]) => string[] {
  const exclude = new Set(removed.flatMap((id) => [id, ...descendants(folders, id).map((f) => f.id)]));
  return (ids) => ids.filter((id) => !exclude.has(id));
}

/** 所属先から、removed とその子孫を外す */
export function withoutDescendants(ids: readonly string[], removed: readonly string[], folders: readonly Folder[]): string[] {
  return withoutDescendantsResolver(removed, folders)(ids);
}

/** 祖先から自分までの名前を、separator でつないだもの。パンくずなど、経路を見せる所だけに使う */
export const folderPath = (folders: readonly Folder[], id: string, separator = ' / '): string => {
  const f = folders.find((f) => f.id === id);
  return f ? [...ancestors(folders, id), f].map(displayName).join(separator) : '';
};

/**
 * 取り込んだフォルダの親の参照を直す。もとの木のまま検査するので、循環があれば、その輪の全員が同じように 1 段目に戻る。
 * 親が無い・別アカウント・組み込み・4 段目以降のものは、parentId を外す。
 */
export function sanitizeParents(folders: Folder[]): Folder[] {
  return folders.map((f) => {
    const next = { ...f };
    let p = f;
    const seen = new Set([f.id]);
    let depth = 1;
    let valid = user(f.id);
    while (p.parentId && valid) {
      const parent = folders.find((c) => c.id === p.parentId && c.accountId === f.accountId);
      if (!parent || !user(parent.id) || seen.has(parent.id) || ++depth > MAX_FOLDER_DEPTH) {
        valid = false;
        break;
      }
      seen.add(parent.id);
      p = parent;
    }
    if (!valid || typeof f.parentId !== 'string' || !f.parentId) delete next.parentId;
    return next;
  });
}

/** ids に入っているフォルダを、管理画面のツリーの表示順 (深さ優先) に並べる。保存順・たたみ状態に左右されない */
export function memberFoldersInTreeOrder(folders: readonly Folder[], ids: readonly string[]): Folder[] {
  const members = new Set(ids);
  return flattenFolders(folders)
    .map((row) => row.folder)
    .filter((f) => members.has(f.id));
}

/** 所属先のうち、自分より下に別の所属先を持たないものだけ (いちばん下のフォルダ)。保存している所属は変えない */
export function leafMemberFolders(folders: readonly Folder[], ids: readonly string[]): Folder[] {
  const ordered = memberFoldersInTreeOrder(folders, ids);
  const parents = new Set(ordered.flatMap((f) => ancestors(folders, f.id).map((p) => p.id)));
  return ordered.filter((f) => !parents.has(f.id));
}

/**
 * ポストの所属フォルダ ID の並びを整える。
 * 重複と「すべて」を除く / 実際のフォルダが 1 つでもあれば「未分類」を外す / 何も残らなければ [「未分類」]。
 */
export function normalizeFolderIds(ids: readonly string[]): string[] {
  const list = [...new Set(ids.filter((id) => id !== ALL_FOLDER_ID))];
  const real = list.filter((id) => id !== INBOX_ID);
  return real.length ? real : [INBOX_ID];
}

/**
 * 親を付け替えたときの、1 件のポストの所属先。動かしたフォルダ (子孫を含む) に入っていないポストは、そのまま返す。
 * 古い祖先のうち新しい祖先に含まれないものは外し、新しい木で祖先を入れ直す。祖先への所属は、直接選んだものと区別できないため。
 * folders は付け替えたあとの木、oldAncestorIds は付け替える前の祖先 (付け替えたあとの木からは求められない)
 */
export function reparentedFolderIds(
  ids: readonly string[],
  folders: readonly Folder[],
  movedId: string,
  oldAncestorIds: readonly string[],
): string[] {
  return reparentedFolderResolver(folders, movedId, oldAncestorIds)(ids);
}

/** 付け替え後の木で所属先を直す関数を作る。子孫・新旧の祖先は一括操作中に使い回す */
export function reparentedFolderResolver(
  folders: readonly Folder[],
  movedId: string,
  oldAncestorIds: readonly string[],
): (ids: readonly string[]) => string[] {
  const subtree = new Set([movedId, ...descendants(folders, movedId).map((f) => f.id)]);
  const newAncestorIds = new Set(ancestors(folders, movedId).map((f) => f.id));
  const stale = new Set(oldAncestorIds.filter((id) => !newAncestorIds.has(id)));
  const includeAncestors = withAncestorResolver(folders);
  return (ids) => {
    if (!ids.some((id) => subtree.has(id))) return [...ids];
    return includeAncestors(ids.filter((id) => !stale.has(id)));
  };
}

/** 所属先から、削除したフォルダ (子孫を含む) を外す。空になったときの未分類への切り替えは normalizeFolderIds */
export const withoutDeletedFolders = (ids: readonly string[], removedIds: ReadonlySet<string>): string[] =>
  ids.filter((id) => !removedIds.has(id));

/**
 * leafMemberFolders と同じ結果を返す関数を作る。木の順番と祖先は 1 回だけ求めるので、ポストが多いとき (タイムラインの記事ごと) に使う。
 * folders が変わったら作り直す
 */
export function leafMemberResolver(folders: readonly Folder[]): (ids: readonly string[]) => Folder[] {
  const treeOrder = flattenFolders(folders).map((row) => row.folder);
  const ancestorIds = new Map(folders.map((f) => [f.id, ancestors(folders, f.id).map((p) => p.id)]));
  return (ids) => {
    const members = new Set(ids);
    const ordered = treeOrder.filter((f) => members.has(f.id));
    const parents = new Set(ordered.flatMap((f) => ancestorIds.get(f.id) ?? []));
    return ordered.filter((f) => !parents.has(f.id));
  };
}
