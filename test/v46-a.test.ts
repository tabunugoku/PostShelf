import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as s from '../src/shared/storage';
import { ancestors, descendants, flattenFolders } from '../src/shared/folderTree';
const snapshot = { text: '架空の本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };
let data: Record<string, any>;
beforeEach(() => { data = installChromeMock(); data.schemaVersion=2; data.folderIdsRepaired=true; s.setAccountScope('me'); });
const tree = async () => { const p=await s.createFolder({name:'Sample A'}); const c=await s.createFolder({name:'Sample B', parentId:p.id}); const g=await s.createFolder({name:'Sample C',parentId:c.id}); return {p,c,g}; };
it('builds a three-level forest and assigns ancestors through all bookmark paths', async()=>{
 const {p,c,g}=await tree(); const folders=await s.listFolders();
 expect(ancestors(folders,g.id).map(f=>f.id)).toEqual([p.id,c.id]);
 expect(descendants(folders,p.id).map(f=>f.id)).toEqual([c.id,g.id]);
 expect(flattenFolders(folders.filter(f=>f.id!=='all')).map(r=>r.depth)).toEqual([1,2,3]);
 await s.setBookmarkFolders('1',[g.id],snapshot); expect((await s.getBookmark('1'))!.folderIds).toEqual([g.id,p.id,c.id]);
 await s.removeFromFolders(['1'],[c.id]); expect((await s.getBookmark('1'))!.folderIds).toEqual([p.id]);
 await s.addToFolders(['1'],[g.id]); await s.removeFromFolders(['1'],[p.id]); expect((await s.getBookmark('1'))!.folderIds).toEqual(['inbox']);
 await s.changeBookmarkFolders(['1'],[g.id],[]); expect((await s.getBookmark('1'))!.folderIds).toContain(c.id);
 await s.changeBookmarkFolders(['1'],[],[p.id]); expect((await s.getBookmark('1'))!.folderIds).toEqual(['inbox']);
 await s.moveToFolder(['1'],null,g.id); expect((await s.getBookmark('1'))!.folderIds).toContain(p.id);
 await s.moveToFolder(['1'],c.id,p.id); expect((await s.getBookmark('1'))!.folderIds).toEqual([p.id]);
});
it('rejects cycles, excess depth, builtins and other accounts',async()=>{
 const {p,c,g}=await tree();
 for(const input of [{parentId:g.id},{parentId:p.id}]) await expect(s.updateFolder(p.id,input)).rejects.toBeInstanceOf(s.StorageError);
 await expect(s.createFolder({name:'Sample D',parentId:g.id})).rejects.toBeInstanceOf(s.StorageError);
 for(const parentId of ['all','inbox','missing']) await expect(s.createFolder({name:'Sample D',parentId})).rejects.toBeInstanceOf(s.StorageError);
 await expect(s.updateFolder('inbox',{parentId:p.id})).rejects.toBeInstanceOf(s.StorageError);
 s.setAccountScope('sample_other'); await expect(s.createFolder({name:'Sample D',parentId:p.id})).rejects.toBeInstanceOf(s.StorageError);
});
it('reparents a subtree atomically and drops old ancestors',async()=>{
 const {p,c,g}=await tree();const q=await s.createFolder({name:'Sample D'});
 await s.setBookmarkFolders('1',[g.id],snapshot); await s.updateFolder(c.id,{parentId:q.id});
 expect(new Set((await s.getBookmark('1'))!.folderIds)).toEqual(new Set([q.id,c.id,g.id]));
 await s.reorderFolders([c.id],{id:c.id,parentId:null});expect((await s.listFolders()).find(f=>f.id===c.id)!.parentId).toBeUndefined();
});
it.each(['child','grandchild','root'])('deletes only the %s subtree in one write, preserving ancestors',async(which)=>{
 const {p,c,g}=await tree(); await s.setBookmarkFolders('1',[g.id],snapshot);
 const id=which==='root'?p.id:which==='child'?c.id:g.id;
 expect(await s.folderDeletionImpact(id)).toEqual({folders:which==='root'?3:which==='child'?2:1,posts:1});
 const spy=vi.spyOn(chrome.storage.local,'set');await s.deleteFolder(id);expect(spy).toHaveBeenCalledTimes(1);
 const remaining=which==='root'?['inbox']:which==='child'?[p.id]:[p.id,c.id];
 expect(new Set((await s.getBookmark('1'))!.folderIds)).toEqual(new Set(remaining));
 expect((await s.listFolders()).filter(f=>!['all','inbox'].includes(f.id)).map(f=>f.id)).toEqual(which==='root'?[]:which==='child'?[p.id]:[p.id,c.id]);
});
it('deletion handles inconsistent old membership without adding deleted ancestors',async()=>{
 const {p,c,g}=await tree(); data.bookmarks={'me:1':{accountId:'me',tweetId:'1',folderIds:[g.id],savedAt:1,snapshot}};
 await s.deleteFolder(c.id); expect((await s.getBookmark('1'))!.folderIds).toEqual(['inbox']);expect((await s.listFolders()).some(f=>f.id===p.id)).toBe(true);
});
it('imports parent links, repairs missing/cyclic/deep links and preserves flat data',async()=>{
 const f=(id:string,parentId?:string)=>({id,name:'Sample '+id,icon:'ti-folder',order:0,accountId:'me',...(parentId?{parentId}:{})});
 await s.importData({app:'PostShelf',version:2,folders:[f('p'),f('c','p'),f('g','c'),f('deep','g'),f('bad','missing'),f('x','y'),f('y','x')],bookmarks:[{accountId:'me',tweetId:'1',folderIds:['g'],savedAt:1,snapshot}]});
 const all=await s.listFolders();expect(all.find(f=>f.id==='c')!.parentId).toBe('p');for(const id of ['deep','bad','x','y'])expect(all.find(f=>f.id===id)!.parentId).toBeUndefined();
 expect((await s.getBookmark('1'))!.folderIds).toEqual(['g','p','c']);expect((await s.exportData()).folders.find(f=>f.id==='g')!.parentId).toBe('c');
});
it('undo and account reassignment retain ancestor membership',async()=>{
 const {p,c,g}=await tree();await s.setBookmarkFolders('1',[g.id],snapshot);const undo=await s.removeFromFolders(['1'],[c.id]);await s.restoreBookmarks(undo);expect((await s.getBookmark('1'))!.folderIds).toContain(p.id);
 await s.assignAccount('me','sample_other');s.setAccountScope('sample_other');expect((await s.getBookmark('1'))!.folderIds).toEqual(expect.arrayContaining([p.id,c.id,g.id]));
});
