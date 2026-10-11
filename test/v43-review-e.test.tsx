import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FullTextSection } from '../src/manager/FullText';
import { SavedContext } from '../src/manager/settingsSaved';
import { clearStorageError, useStorageError } from '../src/manager/errorBus';
import { getSettings } from '../src/shared/settings';
import { installChromeMock } from './chrome-mock';
const saved=vi.fn();const root=()=>document.querySelector('#app')!;
const radio=(value:string)=>document.querySelector<HTMLInputElement>('[name="ft-speed"][value="'+value+'"]')!;
const flush=async()=>{await act(async()=>{await vi.advanceTimersByTimeAsync(40);});};
function Screen(){const error=useStorageError();return <><FullTextSection/>{error && <p role="alert">error</p>}</>;}
beforeEach(()=>{installChromeMock();clearStorageError();saved.mockClear();vi.useFakeTimers();document.body.innerHTML='<div id="app"></div>';});
afterEach(()=>{act(()=>render(null,root()));vi.restoreAllMocks();vi.useRealTimers();clearStorageError();});
const mount=async()=>{await act(()=>render(<SavedContext.Provider value={saved}><Screen/></SavedContext.Provider>,root()));await flush();};
it('returns the failed radio selection through state, without direct DOM writes',async()=>{
 await mount();vi.spyOn(chrome.storage.local,'set').mockRejectedValueOnce(Error('storage'));
 await act(()=>radio('standard').click());await flush();
 expect(radio('slow').checked).toBe(true);expect(radio('standard').checked).toBe(false);expect((await getSettings()).fullTextSpeed).toBe('slow');expect(saved).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')).not.toBeNull();
 const source=readFileSync('src/manager/FullText.tsx','utf8');expect(source).not.toContain('querySelectorAll');expect(source).not.toContain('input.checked =');expect(source).not.toContain('HTMLFieldSetElement');
});
it('prevents a second request while saving and shows the stored result only after success',async()=>{
 await mount();let release!:()=>void;const gate=new Promise<void>(r=>release=r);const original=chrome.storage.local.set.bind(chrome.storage.local);
 const set=vi.spyOn(chrome.storage.local,'set').mockImplementationOnce(async(value:any)=>{await gate;await original(value);});
 await act(()=>radio('standard').click());await flush();expect(radio('standard').disabled).toBe(true);expect(radio('slow').disabled).toBe(true);
 await act(()=>radio('slow').click());expect(set).toHaveBeenCalledTimes(1);expect(saved).not.toHaveBeenCalled();
 await act(()=>release());await flush();expect(saved).toHaveBeenCalledTimes(1);expect(radio('standard').checked).toBe(true);expect((await getSettings()).fullTextSpeed).toBe('standard');
});
