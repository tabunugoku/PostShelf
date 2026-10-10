import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderEdit } from '../src/manager/FolderEdit';
import { Triage } from '../src/manager/Triage';
import { App } from '../src/manager/App';
import { ICONS, iconLabel, type Folder } from '../src/shared/models';
import * as storage from '../src/shared/storage';
import { createFolderPicker } from '../src/shared/folderPicker';
import { t } from '../src/shared/strings';
import { installChromeMock, installPanelMock } from './chrome-mock';

const extra = 'palette brush pencil camera movie music microphone device-gamepad-2 dice puzzle trophy ghost leaf paw cat flame moon sun cloud plane bike coffee pizza gift shopping-bag map-pin calendar clock tag flag rocket diamond sparkles world ticket planet'.split(' ').map(i=>`ti-${i}`);
const main = ['ti-folder','ti-star','ti-code','ti-book','ti-bulb','ti-heart','ti-photo','ti-briefcase'];
const flush = () => act(() => new Promise<void>(r=>setTimeout(r,30)));
let folder: Folder;
let saved: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown');
  history.replaceState(null,'','/'); vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  folder=await storage.createFolder({name:'Sample folder'}); saved=vi.fn();
  document.body.innerHTML='<div id="app"></div>';
});
afterEach(async()=>{await act(()=>void render(null,document.querySelector('#app')!));vi.restoreAllMocks();});
const mount = async (f = folder) => {
  await act(()=>void render(<FolderEdit folder={f} onSaved={saved} onRequestDelete={()=>{}} />,document.querySelector('#app')!)); await flush();
};
const click = async (el: Element) => {expect(el).not.toBeNull();await act(()=>void (el as HTMLElement).click());await flush();};
const more = () => document.querySelector<HTMLButtonElement>('[data-icon-more]')!;

it('keeps the main eight, followed by the 36 additional icons without duplicates',()=>{
  expect(ICONS.slice(0,8)).toEqual(main);
  expect(ICONS.slice(8)).toEqual(extra);
  expect(new Set(ICONS).size).toBe(44);
});
it.each(['ja','en','zh_CN','zh_TW','ko','es','pt_BR','fr'])('names all extra icons in %s',lang=>{
  installChromeMock(lang);
  for(const icon of extra){expect(iconLabel(icon)).toBeTruthy();expect(iconLabel(icon)).not.toMatch(/^ti-|^icon/);}
  expect(t('iconMore')).not.toBe('iconMore');
});
it('opens a 36-button grid, picks a draft icon, closes the grid and saves only on Save',async()=>{
  await mount(); const update=vi.spyOn(storage,'updateFolder');
  expect(document.querySelectorAll('[data-main-icons] [data-icon]')).toHaveLength(8);
  await click(more()); expect(more().getAttribute('aria-expanded')).toBe('true');
  const grid=document.querySelector('[data-more-icons]')!;
  expect([...grid.querySelectorAll<HTMLElement>('button')].map(b=>b.dataset.icon)).toEqual(extra);
  for(const button of grid.querySelectorAll('button')){expect(button.getAttribute('aria-label')).toBeTruthy();expect(button.getAttribute('aria-pressed')).toBe('false');}
  await click(grid.querySelector('[data-icon="ti-cat"]')!);
  expect(document.querySelector<HTMLElement>('[data-more-icons]')?.hidden).toBe(true);
  expect(more().getAttribute('aria-pressed')).toBe('true');
  expect(more().querySelector('.ti-cat')).not.toBeNull();
  expect(document.activeElement).toBe(more());
  expect(update).not.toHaveBeenCalled();expect((await storage.listFolders()).find(f=>f.id===folder.id)?.icon).toBe('ti-folder');
  await click(document.querySelector('[data-folder-actions] [type=submit]')!);
  expect(update).toHaveBeenCalledExactlyOnceWith(folder.id,{icon:'ti-cat'});expect(saved).toHaveBeenCalledOnce();
});
it('toggles More closed and retains the selected icon on reopening',async()=>{
  await mount({...folder,icon:'ti-movie'}); expect(more().getAttribute('aria-pressed')).toBe('true');
  expect(more().querySelector('.ti-movie')).not.toBeNull();
  await click(more());expect(document.querySelector('[data-icon="ti-movie"]')?.getAttribute('aria-pressed')).toBe('true');
  await click(more());expect(document.querySelector<HTMLElement>('[data-more-icons]')?.hidden).toBe(true);
  await click(document.querySelector('[data-icon="ti-star"]')!);expect(more().getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('[data-icon="ti-star"]')?.getAttribute('aria-pressed')).toBe('true');
  await click(document.querySelector('[type=submit]')!);expect((await storage.listFolders()).find(f=>f.id===folder.id)?.icon).toBe('ti-star');
});
it('creates a new folder with its drafted extra icon only on Create',async()=>{
  await act(()=>void render(<FolderEdit onSaved={saved} />,document.querySelector('#app')!));await flush();
  const create=vi.spyOn(storage,'createFolder');
  const input=document.querySelector<HTMLInputElement>('.folder-editor-host input')!;
  await act(()=>{input.value='Sample new icon';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await click(more()); await click(document.querySelector('[data-icon="ti-rocket"]')!);
  expect(create).not.toHaveBeenCalled();
  await click(document.querySelector('[data-folder-actions] [type=submit]')!);
  expect(create).toHaveBeenCalledExactlyOnceWith({name:'Sample new icon',icon:'ti-rocket',color:undefined});
  expect((await storage.listFolders()).find(f=>f.name==='Sample new icon')?.icon).toBe('ti-rocket');
});
it('uses only icons available in the bundled Tabler font',()=>{
  const css=readFileSync('node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css','utf8');
  for(const icon of extra)expect(css).toContain(`.${icon}:before`);
});
it('defines a nine-column grid and a dashed More button inside the editor',async()=>{
  await mount(); await click(more());
  const grid=document.querySelector<HTMLElement>('[data-more-icons]')!;
  expect(grid.style.display).toBe('grid');expect(grid.style.gridTemplateColumns).toMatch(/repeat\(9,\s*1fr\)/);
  expect(more().style.borderStyle).toBe('dashed');
});
it('creates, updates and exports/imports every extra icon without changing its stored value',async()=>{
  const folders: Folder[]=[];
  for(const [n,icon] of extra.entries()){
    const f=await storage.createFolder({name:`Sample icon ${n}`,icon});
    await storage.updateFolder(f.id,{icon}); folders.push(f);
  }
  const exported=await storage.exportData();
  installChromeMock();installPanelMock();
  await storage.importData(exported);
  const loaded=await storage.listFolders();
  for(const f of folders)expect(loaded.find(row=>row.id===f.id)?.icon).toBe(f.icon);
});
it('displays an extra icon in the sidebar, triage and shared popover picker',async()=>{
  await storage.updateFolder(folder.id,{icon:'ti-planet'});
  await act(()=>void render(<App />,document.querySelector('#app')!));await flush();
  expect([...document.querySelectorAll('.fr')].find(el=>el.textContent?.includes('Sample folder'))?.querySelector('.ti-planet')).not.toBeNull();
  await storage.setBookmarkFolders('111',[],{text:'Sample post',author:'Sample',handle:'@sample_user',media:[],url:'https://x.com/sample_user/status/111'});
  const queue=await storage.listBookmarks();const folders=await storage.listFolders();
  await act(()=>void render(<Triage queue={queue} live={new Set(['111'])} folders={folders.filter(f=>f.id===folder.id)} pickerFolders={folders} onChanged={()=>{}} onClose={()=>{}} />,document.querySelector('#app')!));await flush();
  expect(document.querySelector('.triage-folder .ti-planet')).not.toBeNull();
  const picker=createFolderPicker({folders,selected:new Set(),theme:{fg:'#000',border:'#888',hover:'#eee',accent:'#00f'},onChange:()=>{}});
  expect(picker.el.querySelector('.ti-planet')).not.toBeNull();
});
