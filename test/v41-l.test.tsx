import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { updateSettings, getSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
let folders: Folder[], queue: Bookmark[];
let changed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  folders = [];
  for (let i = 1; i <= 12; i++) folders.push(await storage.createFolder({ name: `Sample folder ${i}` }));
  for (const id of ['111', '222', '333']) await storage.setBookmarkFolders(id, [], { text: `Sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}` });
  queue = (await storage.listBookmarks()).sort((a,b) => a.tweetId.localeCompare(b.tweetId));
  changed = vi.fn(); document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const mount = async (multi = true, posts = queue) => {
  await act(() => void render(<Triage {...{ multi }} queue={posts} live={new Set(posts.map(b=>b.tweetId))} folders={folders} pickerFolders={folders} onChanged={changed} onClose={() => {}} />, document.querySelector('#app')!));
  await flush();
};
const root = () => document.querySelector<HTMLElement>('.triage')!;
const key = async (key: string, target: Element = root(), extra = {}) => {
  await act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, code: /^[1-9]$/.test(key) ? `Digit${key}` : key, bubbles: true, cancelable: true, ...extra })));
  await flush();
};
const click = async (el: Element) => { await act(() => void (el as HTMLElement).click()); await flush(); };
const folderButton = (n: number) => document.querySelectorAll<HTMLButtonElement>('.triage-folder')[n-1];
const progress = (n: number) => expect(document.querySelector('.triage-progress')?.textContent).toBe(t('triageProgress', n, 3));
const open = () => click(document.querySelector('.triage-folder[aria-haspopup]')!);
const box = (n: number) => [...document.querySelectorAll('.menu label')].find(el=>el.textContent === folders[n-1].name)!.querySelector<HTMLInputElement>('input')!;

it('marks two number keys without saving, then confirms once and advances', async () => {
  await mount(); const save = vi.spyOn(storage, 'setBookmarkFolders'); const add = vi.spyOn(storage, 'addToFolders');
  await key('1'); await key('2', root(), { shiftKey: true });
  progress(1); expect(save).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
  expect(folderButton(1).getAttribute('aria-pressed')).toBe('true');
  expect(folderButton(2).getAttribute('aria-pressed')).toBe('true');
  await key('Enter');
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[0].id,folders[1].id], queue[0].snapshot);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id,folders[1].id]);
  expect((await getSettings()).recentFolderIds).toEqual([folders[0].id,folders[1].id]);
  expect(changed).toHaveBeenCalledOnce(); progress(2);
});
it('toggles a mark off with the same key and with the folder button', async () => {
  await mount(); await key('1'); await key('1');
  expect(folderButton(1).getAttribute('aria-pressed')).toBe('false');
  await click(folderButton(2)); expect(folderButton(2).getAttribute('aria-pressed')).toBe('true');
  await click(folderButton(2)); expect(folderButton(2).getAttribute('aria-pressed')).toBe('false');
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
});
it('discards unconfirmed marks on skip and back, starting from saved assignments', async () => {
  await storage.setBookmarkFolders('111', [folders[2].id], queue[0].snapshot); queue[0].folderIds=[folders[2].id];
  await mount(); expect(folderButton(3).getAttribute('aria-pressed')).toBe('true');
  await key('1'); await key('ArrowRight'); await key('2'); await key('ArrowLeft');
  progress(1); expect(folderButton(1).getAttribute('aria-pressed')).toBe('false');
  expect(folderButton(3).getAttribute('aria-pressed')).toBe('true');
  await key('ArrowRight'); expect(folderButton(2).getAttribute('aria-pressed')).toBe('false');
});
it('advances without storage for an empty or unchanged selection', async () => {
  await mount(); const save=vi.spyOn(storage,'setBookmarkFolders'); await key('Enter');
  expect(save).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled(); progress(2);
});
it('returns to inbox when all saved marks are removed', async () => {
  queue[0].folderIds=[folders[0].id]; await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(); await key('1'); await key('Enter');
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']); progress(2);
});
it('keeps marks and position on failure, then retries with the confirm button', async () => {
  await mount(); await key('1'); const save=vi.spyOn(storage,'setBookmarkFolders').mockRejectedValueOnce(new Error('Sample failure'));
  await key('Enter'); progress(1); expect(root().querySelector('.error')?.textContent).toBe(t('errorStorage'));
  expect(folderButton(1).getAttribute('aria-pressed')).toBe('true');
  await click(document.querySelector('.triage-confirm')!); progress(2); expect(save).toHaveBeenCalledTimes(2);
});
it('keeps other-folder checks as marks and confirms from the checkbox in the portal', async () => {
  await mount(); const save=vi.spyOn(storage,'setBookmarkFolders'); await open();
  await click(box(10)); await click(box(11)); progress(1);
  expect(save).not.toHaveBeenCalled(); expect(document.querySelector('.menu')).not.toBeNull();
  box(11).focus(); await key('Enter', box(11));
  expect(save).toHaveBeenCalledExactlyOnceWith('111',[folders[9].id,folders[10].id],queue[0].snapshot);
  progress(2); expect(document.querySelector('.menu')).toBeNull(); expect(root().contains(document.activeElement)).toBe(true);
});
it('reopens other folders with the unconfirmed marks', async () => {
  await mount(); await key('1'); await open(); expect(box(1).checked).toBe(true);
  await click(box(10)); await key('Escape',box(10)); await open();
  expect(box(1).checked).toBe(true); expect(box(10).checked).toBe(true);
});
it('does not save an unchanged assigned set when revisiting a post', async () => {
  queue[0].folderIds=[folders[0].id,folders[1].id];
  await storage.setBookmarkFolders('111',queue[0].folderIds,queue[0].snapshot);
  await mount(); const save=vi.spyOn(storage,'setBookmarkFolders');
  await key('1'); await key('1'); await key('Enter');
  expect(save).not.toHaveBeenCalled(); progress(2);
});
it('creates from N with draft marks and advances', async () => {
  await mount(); await key('1'); await key('n');
  const input=document.querySelector<HTMLInputElement>('.triage-new form input')!;
  await act(()=>{input.value='Sample created';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(()=>void document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await flush();
  const created=(await storage.listFolders()).find(f=>f.name==='Sample created')!;
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, created.id]);
  progress(2); expect(root().contains(document.activeElement)).toBe(true);
});
it('leaves check marks uncommitted when closing with Escape', async () => {
  const closed=vi.fn();
  await act(()=>void render(<Triage multi queue={queue} live={new Set(queue.map(b=>b.tweetId))} folders={folders} pickerFolders={folders} onChanged={changed} onClose={closed}/>,document.querySelector('#app')!));
  await flush(); await key('1'); await key('Escape');
  expect(closed).toHaveBeenCalledOnce(); expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
});
it.each(['BUTTON','A','INPUT','TEXTAREA','SELECT'])('does not steal Enter from %s', async tag => {
  await mount(); await key('1'); const save=vi.spyOn(storage,'setBookmarkFolders');
  const el=document.createElement(tag); if(tag==='A') el.setAttribute('href','#'); root().append(el); el.focus();
  const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
  await act(()=>void el.dispatchEvent(event)); await flush();
  expect(event.defaultPrevented).toBe(false); expect(save).not.toHaveBeenCalled(); progress(1);
});
it('lets focused folder buttons handle Enter as a click that only toggles a mark', async () => {
  await mount(); folderButton(1).focus(); await key('Enter',folderButton(1));
  // jsdom does not synthesize the browser default click for keyboard activation.
  await click(folderButton(1)); progress(1); expect(folderButton(1).getAttribute('aria-pressed')).toBe('true');
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
});
it('ignores duplicate confirmation and repeated Enter while a save is pending', async () => {
  await mount(); await key('1'); const original=storage.setBookmarkFolders; let finish!:()=>void;
  const gate=new Promise<void>(r=>finish=r); const save=vi.spyOn(storage,'setBookmarkFolders').mockImplementation(async(...args)=>{await gate; return original(...args);});
  await key('Enter'); await key('Enter'); await click(document.querySelector('.triage-confirm')!);
  expect(save).toHaveBeenCalledOnce(); await act(async()=>{finish(); await gate;}); await flush(); progress(2);
  await key('Enter',root(),{repeat:true}); progress(2);
});
it('finishes the final post after confirming', async () => {
  await mount(true,[queue[0]]); await key('1'); await key('Enter');
  expect(document.querySelector('#triage-title')?.textContent).toBe(t('triageDone'));
});
it('keeps immediate save and Shift-stay behavior when off', async () => {
  await mount(false); expect(document.querySelector('.triage-confirm')).toBeNull();
  await key('1',root(),{shiftKey:true}); progress(1);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id]);
  await key('2'); progress(2); expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id,folders[1].id]);
});
it('reads the saved setting when starting from the manager', async () => {
  await updateSettings({triageMulti:true}); history.replaceState(null,'','/#triage');
  await act(()=>void render(<App />,document.querySelector('#app')!)); await flush(); await flush();
  expect(document.querySelector('.triage-confirm')?.textContent).toContain(t('triageConfirm'));
  await key('1'); expect((await storage.listBookmarks()).every(b=>b.folderIds[0]==='inbox')).toBe(true);
});
