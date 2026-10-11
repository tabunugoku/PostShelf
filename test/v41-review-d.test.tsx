import { readFileSync } from 'node:fs';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { assignments as ids, box, button as byText, click, confirm, flush, mount, setup, unmount } from './v44-helpers';
let folders: Folder[];
beforeEach(async () => { folders = await setup([[0], [0,1], [1]]); });
afterEach(unmount);
it.each(['tab','sidepanel'] as const)('shows mixed states and confirms additions on %s', async surface => {
  await mount(surface);
  for (const name of ['Sample A','Sample B']) {
    expect(box(name).indeterminate).toBe(true); expect(box(name).getAttribute('aria-checked')).toBe('mixed'); expect(box(name).checked).toBe(false);
  }
  expect(box('Sample C').checked).toBe(false); expect(box('Sample C').indeterminate).toBe(false);
  const before = await ids(); await click(box('Sample A')); expect(await ids()).toEqual(before);
  expect(box('Sample A').checked).toBe(true); expect(box('Sample A').indeterminate).toBe(false);
  expect(box('Sample B').indeterminate).toBe(true); expect(document.querySelector('.menu-bulk')).not.toBeNull();
  await confirm(); expect((await ids()).every(a=>a.includes(folders[0].id))).toBe(true);
  expect(document.querySelector('.toast')?.textContent).toContain(t('toastAdded',1));
});
it('removes folders on confirmation and returns posts with no folders to inbox', async()=>{
  await mount(); await click(box('Sample A')); await click(box('Sample A'));
  expect(box('Sample A').checked).toBe(false); expect(box('Sample B').indeterminate).toBe(true);
  await confirm(); expect(await ids()).toEqual([['inbox'],[folders[1].id],[folders[1].id]]);
  await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!); await click(byText(t('changeFolder')));
  await click(box('Sample B')); await click(box('Sample B')); await confirm();
  expect(await ids()).toEqual([['inbox'],['inbox'],['inbox']]);
});
it('sets every selected post to inbox on confirmation',async()=>{
  await mount(); await click(box(t('inboxName'))); await confirm();
  expect(await ids()).toEqual([['inbox'],['inbox'],['inbox']]);
});
it('creates with an extra icon and drafts the new folder for everyone',async()=>{
  await mount(); await click(byText(t('addFolder')));
  const input=document.querySelector<HTMLInputElement>('.menu-bulk form input')!;
  await act(()=>{input.value='Sample new';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await click(document.querySelector<HTMLButtonElement>('.menu-bulk [data-icon-more]')!);
  await click(document.querySelector<HTMLButtonElement>('.menu-bulk [data-icon="ti-cat"]')!);
  await act(()=>void document.querySelector('.menu-bulk form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))); await flush(); await flush();
  const f=(await storage.listFolders()).find(f=>f.name==='Sample new')!;
  expect(f.icon).toBe('ti-cat'); expect((await ids()).every(a=>!a.includes(f.id))).toBe(true);
  expect(box('Sample new').checked).toBe(true); expect(document.querySelector('.menu-bulk')).not.toBeNull();
  await confirm(); expect((await ids()).every(a=>a.includes(f.id))).toBe(true);
});
it('keeps persisted mixed states unchanged and retains the draft after failed confirmation',async()=>{
  await mount(); const before=await ids(); vi.spyOn(storage,'changeBookmarkFolders').mockRejectedValueOnce(new Error('Sample failure'));
  await click(box('Sample A')); await confirm();
  expect(await ids()).toEqual(before); expect(box('Sample A').checked).toBe(true); expect(box('Sample A').indeterminate).toBe(false);
  expect(box('Sample B').indeterminate).toBe(true); expect(document.querySelector('.toast')?.textContent).toBe(t('errorStorage'));
});
it('prevents a second confirmation while the bulk save is pending',async()=>{
  await mount(); const original=storage.changeBookmarkFolders; let finish!:()=>void; const gate=new Promise<void>(r=>finish=r);
  const save=vi.spyOn(storage,'changeBookmarkFolders').mockImplementation(async(...args)=>{await gate;return original(...args);});
  await click(box('Sample A')); const confirmBtn=byText(t('triageConfirm')); await act(()=>{confirmBtn.click();confirmBtn.click();}); await flush();
  expect(save).toHaveBeenCalledOnce(); expect(box('Sample B').closest('fieldset')!.disabled).toBe(true);
  await act(async()=>{finish();await gate;}); await flush(); await flush(); expect(document.querySelector('.menu-bulk')).toBeNull();
  expect((await ids()).every(a=>a.includes(folders[0].id))).toBe(true);
});
it('returns to the main menu and retains the four actions without unused translations',async()=>{
  await mount(); await click(byText(t('back')));
  expect([...document.querySelectorAll('.menu-bulk .menu-item')].map(b=>b.textContent?.trim())).toEqual([t('changeFolder'),t('delete'),t('selectAll'),t('clearSelection')]);
  for(const locale of ['ja','en','zh_CN','zh_TW','ko','es','pt_BR','fr']){
    const d=JSON.parse(readFileSync('static/_locales/'+locale+'/messages.json','utf8')); expect(d.bulkAdd).toBeUndefined();expect(d.bulkRemove).toBeUndefined();
  }
});
