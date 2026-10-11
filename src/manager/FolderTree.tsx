import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { displayName, userFoldersOf, type Folder } from '../shared/models';
import { flattenFolders } from '../shared/folderTree';
import { getCollapsedFolders, setCollapsedFolders } from '../shared/storage';
import { onSettingsChanged } from '../shared/settings';
import { t } from '../shared/strings';
import { reportStorageError } from './errorBus';

/** たたんだ親の一覧。端末の設定として保存し、他の画面での変更も反映する */
export function useFolderTreeState() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void getCollapsedFolders()
      .then((ids) => {
        if (live) setCollapsed(new Set(ids));
      })
      .catch(reportStorageError);
    const off = onSettingsChanged((s) => {
      if (live) setCollapsed(new Set(s.folderTreeCollapsed));
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    void setCollapsedFolders([...next]).catch(reportStorageError);
  };
  return { collapsed, toggle };
}

interface FolderTreeListProps {
  folders: Folder[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  selected: ReadonlySet<string>;
  onPick: (f: Folder) => void;
  disabled?: boolean;
  pickDisabled?: boolean;
  /** フォルダ ID → 数字キーの番号 */
  numbers?: ReadonlyMap<string, number>;
}

/** ツリーの行。開閉と選択は別のボタン。数字キーの枠の選択にも、祖先を巻き込まずに使える */
export function FolderTreeList(props: FolderTreeListProps) {
  return (
    <div class="folder-tree">
      {flattenFolders(userFoldersOf(props.folders), props.collapsed).map(({ folder: f, depth, hasChildren }) => {
        const closed = props.collapsed.has(f.id);
        const on = props.selected.has(f.id);
        return (
          <div key={f.id} class="folder-tree-row" data-tree-row={f.id} data-depth={depth} style={{ paddingLeft: (depth - 1) * 18 + 'px' }}>
            {hasChildren ? (
              <button
                class="tree-toggle"
                data-tree-toggle
                aria-label={t(closed ? 'treeExpand' : 'treeCollapse')}
                aria-expanded={!closed}
                disabled={props.disabled}
                onClick={() => props.onToggle(f.id)}
              >
                <Icon name={closed ? 'ti-chevron-right' : 'ti-chevron-down'} />
              </button>
            ) : (
              <span class="tree-spacer" />
            )}
            <button
              class={'tree-choice' + (on ? ' on' : '')}
              data-tree-folder={f.id}
              aria-pressed={on}
              disabled={props.disabled || props.pickDisabled}
              onClick={() => props.onPick(f)}
            >
              <Icon name={f.icon} color={f.color} />
              <span>{displayName(f)}</span>
              {props.numbers?.has(f.id) && <kbd>{props.numbers.get(f.id)}</kbd>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
