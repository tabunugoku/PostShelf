import { userFoldersOf, type Folder } from './models';
import { flattenFolders } from './folderTree';
import { normalizeTriageKeyFolders, type Settings } from './settings';

export const TRIAGE_KEY_COUNT = 9;
/** Resolving a missing manual ID leaves its original number empty. */
export function triageKeyTargets(settings: Pick<Settings,'triageKeyMode'|'triageKeyFolders'>, folders: Folder[], collapsed: ReadonlySet<string> = new Set()): (Folder | undefined)[] {
  const users = userFoldersOf(folders);
  const ids = normalizeTriageKeyFolders(settings.triageKeyFolders);
  const visible = flattenFolders(users,collapsed);
  return Array.from({length:TRIAGE_KEY_COUNT},(_,i) => settings.triageKeyMode === 'manual' ? users.find(f => f.id === ids[i]) : visible[i]?.folder);
}
