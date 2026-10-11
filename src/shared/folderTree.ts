import { ALL_FOLDER_ID, INBOX_ID, displayName, type Folder } from './models';
export const MAX_FOLDER_DEPTH = 3;
const user = (id: string) => id !== ALL_FOLDER_ID && id !== INBOX_ID;
/** Parent links are account-local. Broken legacy links are treated as roots. */
export function ancestors(folders: readonly Folder[], id: string): Folder[] {
 const f=folders.find(f=>f.id===id); if(!f) return [];
 const seen=new Set([id]); const out:Folder[]=[]; let parent=f.parentId;
 while(parent && !seen.has(parent)) { const p=folders.find(p=>p.id===parent && p.accountId===f.accountId && user(p.id)); if(!p)break; seen.add(parent);out.unshift(p);parent=p.parentId; }
 return out;
}
export const folderDepth = (folders: readonly Folder[], id: string): number => ancestors(folders,id).length+1;
export function descendants(folders: readonly Folder[], id:string): Folder[] {
 return folders.filter(f=>f.id!==id && ancestors(folders,f.id).some(p=>p.id===id));
}
export function canParent(folders: readonly Folder[], id:string | undefined, parentId:string | null | undefined, accountId?:string):boolean {
 const f=id ? folders.find(f=>f.id===id) : undefined;
 if(id && (!f || !user(id))) return false;
 if(!parentId) return true;
 const p=folders.find(f=>f.id===parentId);
 if(!p || !user(p.id) || parentId===id || p.accountId!==(f?.accountId ?? accountId))return false;
 if(id && descendants(folders,id).some(f=>f.id===parentId))return false;
 const height=f ? Math.max(folderDepth(folders,f.id),...descendants(folders,f.id).map(c=>folderDepth(folders,c.id)))-folderDepth(folders,f.id)+1 : 1;
 return folderDepth(folders,parentId)+height<=MAX_FOLDER_DEPTH;
}
export interface FolderRow { folder:Folder; depth:number; hasChildren:boolean }
export function flattenFolders(folders: readonly Folder[], collapsed:ReadonlySet<string>=new Set()):FolderRow[] {
 const out:FolderRow[]=[];const visited=new Set<string>();
 const walk=(f:Folder,depth:number)=>{if(visited.has(f.id))return;visited.add(f.id);const children=folders.filter(c=>c.parentId===f.id && c.accountId===f.accountId).sort((a,b)=>a.order-b.order);out.push({folder:f,depth,hasChildren:children.length>0});if(!collapsed.has(f.id))children.forEach(c=>walk(c,depth+1));};
 folders.filter(f=>!f.parentId || !folders.some(p=>p.id===f.parentId && p.accountId===f.accountId)).sort((a,b)=>a.order-b.order).forEach(f=>walk(f,1));
 return out;
}
export function withAncestors(ids:readonly string[], folders:readonly Folder[]):string[] {
 const real=[...new Set(ids.filter(id=>user(id)))];
 return real.length ? [...new Set([...real,...real.flatMap(id=>ancestors(folders,id).map(f=>f.id))])] : [INBOX_ID];
}
export function withoutDescendants(ids:readonly string[], removed:readonly string[], folders:readonly Folder[]):string[] {
 const exclude=new Set(removed.flatMap(id=>[id,...descendants(folders,id).map(f=>f.id)]));return ids.filter(id=>!exclude.has(id));
}
export const folderPath = (folders:readonly Folder[], id:string, separator=' / '):string => {
 const f=folders.find(f=>f.id===id);return f ? [...ancestors(folders,id),f].map(displayName).join(separator) : '';
};
/** Validate against the original forest, so importing a cycle resets every member deterministically. */
export function sanitizeParents(folders:Folder[]):Folder[] {
 return folders.map(f=>{const next={...f};let p=f;const seen=new Set([f.id]);let depth=1;let valid=user(f.id);
 while(p.parentId && valid){const parent=folders.find(c=>c.id===p.parentId && c.accountId===f.accountId);if(!parent || !user(parent.id) || seen.has(parent.id) || ++depth>MAX_FOLDER_DEPTH){valid=false;break;}seen.add(parent.id);p=parent;}
 if(!valid || typeof f.parentId!=='string' || !f.parentId)delete next.parentId;return next;});
}

/** Full depth-first tree order, independent of membership order and collapsed rows. */
export function memberFoldersInTreeOrder(folders: readonly Folder[], ids: readonly string[]): Folder[] {
 const members = new Set(ids);
 return flattenFolders(folders).map(row=>row.folder).filter(f=>members.has(f.id));
}
/** Keep only memberships with no other member below them; never change stored memberships. */
export function leafMemberFolders(folders: readonly Folder[], ids: readonly string[]): Folder[] {
 const ordered = memberFoldersInTreeOrder(folders,ids);
 const parents = new Set(ordered.flatMap(f=>ancestors(folders,f.id).map(p=>p.id)));
 return ordered.filter(f=>!parents.has(f.id));
}
