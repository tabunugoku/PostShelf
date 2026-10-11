import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { displayName, userFoldersOf, type Folder } from '../shared/models';
import { flattenFolders } from '../shared/folderTree';
import { getCollapsedFolders, setCollapsedFolders } from '../shared/storage';
import { onSettingsChanged } from '../shared/settings';
import { t } from '../shared/strings';
import { reportStorageError } from './errorBus';

export function useFolderTreeState() {
 const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
 useEffect(()=>{let live=true;void getCollapsedFolders().then(ids=>{if(live)setCollapsed(new Set(ids));}).catch(reportStorageError);const off=onSettingsChanged(s=>{if(live)setCollapsed(new Set(s.folderTreeCollapsed));});return()=>{live=false;off();};},[]);
 const toggle=(id:string)=>{const next=new Set(collapsed);if(next.has(id))next.delete(id);else next.add(id);setCollapsed(next);void setCollapsedFolders([...next]).catch(reportStorageError);};
 return {collapsed,toggle};
}
/** A tree row separates expansion from selection; key slots may use the same rows without ancestor selection. */
export function FolderTreeList(props:{folders:Folder[];collapsed:ReadonlySet<string>;onToggle:(id:string)=>void;selected:ReadonlySet<string>;onPick:(f:Folder)=>void;disabled?:boolean;pickDisabled?:boolean;numbers?:ReadonlyMap<string,number>}) {
 return <div class="folder-tree">{flattenFolders(userFoldersOf(props.folders),props.collapsed).map(({folder:f,depth,hasChildren})=><div key={f.id} class="folder-tree-row" data-tree-row={f.id} data-depth={depth} style={{paddingLeft:((depth-1)*18)+'px'}}>
 {hasChildren ? <button class="tree-toggle" data-tree-toggle aria-label={t(props.collapsed.has(f.id)?'treeExpand':'treeCollapse')} aria-expanded={!props.collapsed.has(f.id)} disabled={props.disabled} onClick={()=>props.onToggle(f.id)}><Icon name={props.collapsed.has(f.id)?'ti-chevron-right':'ti-chevron-down'}/></button> : <span class="tree-spacer"/>}
 <button class={'tree-choice'+(props.selected.has(f.id)?' on':'')} data-tree-folder={f.id} aria-pressed={props.selected.has(f.id)} disabled={props.disabled || props.pickDisabled} onClick={()=>props.onPick(f)}><Icon name={f.icon} color={f.color}/><span>{displayName(f)}</span>{props.numbers?.has(f.id)&&<kbd>{props.numbers.get(f.id)}</kbd>}</button>
 </div>)}</div>;
}
