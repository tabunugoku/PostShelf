import { userFoldersOf, type Folder } from './models';
import { flattenFolders } from './folderTree';
import { normalizeTriageKeyFolders, type Settings } from './settings';

export const TRIAGE_KEY_COUNT = 9;

/**
 * 仕分けの数字キー 1〜9 の対象。自動は、開いているツリーの上から 9 個。手動は、設定の番号どおり。
 * 手動で、存在しない ID の番号は空き (undefined) のままにして、後ろの番号を詰めない。
 */
export function triageKeyTargets(
  settings: Pick<Settings, 'triageKeyMode' | 'triageKeyFolders'>,
  folders: Folder[],
  collapsed: ReadonlySet<string> = new Set(),
): (Folder | undefined)[] {
  const users = userFoldersOf(folders);
  const ids = normalizeTriageKeyFolders(settings.triageKeyFolders);
  const visible = flattenFolders(users, collapsed);
  return Array.from({ length: TRIAGE_KEY_COUNT }, (_, i) =>
    settings.triageKeyMode === 'manual' ? users.find((f) => f.id === ids[i]) : visible[i]?.folder,
  );
}
