// 版: v46-d
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import type { Bookmark,Folder } from '../src/shared/models';
const snap={text:'架空の本文',author:'Sample',handle:'@sample_user',media:[],url:'https://x.com/sample_user/status/1'};
let folders:Folder[],p:Folder,c:Folder,g:Folder;
const flush=()=>act(()=>new Promise<void>(r=>setTimeout(r,30)));
const button=(f:Folder)=>document.querySelector<HTMLButtonElement>('[data-tree-folder="'+f.id+'"]')!;
beforeEach(async()=>{const data=installChromeMock();data.schemaVersion=2;data.folderIdsRepaired=true;storage.setAccountScope('me');p=await storage.createFolder({name:'Sample A'});c=await storage.createFolder({name:'Sample B',parentId:p.id});g=await storage.createFolder({name:'Sample C',parentId:c.id});folders=(await storage.listFolders()).filter(f=>f.id!=='all'&&f.id!=='inbox');await storage.setBookmarkFolders('1',[],snap);document.body.innerHTML='<div id="app"></div>';});
afterEach(async()=>{await act(()=>void render(null,document.querySelector('#app')!));vi.restoreAllMocks();});
const mount=async(multi=true)=>{const queue=(await storage.listBookmarks()) as Bookmark[];await act(()=>void render(<Triage multi={multi} queue={queue} live={new Set(['1'])} folders={folders} pickerFolders={folders} onChanged={()=>{}} onClose={()=>{}}/>,document.querySelector('#app')!));await flush();};
it('shows a collapsible tree and propagates marks without saving until confirm',async()=>{await mount();expect(button(g).parentElement!.dataset.depth).toBe('3');const save=vi.spyOn(storage,'setBookmarkFolders');await act(()=>void button(g).click());await flush();for(const f of [p,c,g])expect(button(f).getAttribute('aria-pressed')).toBe('true');expect(save).not.toHaveBeenCalled();await act(()=>void button(c).click());await flush();expect(button(p).getAttribute('aria-pressed')).toBe('true');expect(button(g).getAttribute('aria-pressed')).toBe('false');await act(()=>void document.querySelector<HTMLButtonElement>('[data-tree-row="'+p.id+'"] [data-tree-toggle]')!.click());await flush();expect(button(g)).toBeNull();await act(()=>void document.querySelector<HTMLButtonElement>('[data-tree-row="'+p.id+'"] [data-tree-toggle]')!.click());await flush();await act(()=>void document.querySelector<HTMLButtonElement>('.triage-confirm')!.click());await flush();expect((await storage.getBookmark('1'))!.folderIds).toEqual([p.id]);});
it('single selection in a grandchild saves its ancestors and advances',async()=>{await mount(false);await act(()=>void button(g).click());await flush();expect(new Set((await storage.getBookmark('1'))!.folderIds)).toEqual(new Set([p.id,c.id,g.id]));expect(document.querySelector('.triage-post')).toBeNull();});
