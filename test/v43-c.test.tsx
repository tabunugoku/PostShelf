import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { FullTextSection } from '../src/manager/FullText';
import { SavedContext } from '../src/manager/settingsSaved';
import { useStorageError, clearStorageError } from '../src/manager/errorBus';
import { getSettings, updateSettings, saveFullTextRun } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import { installChromeMock, loadMessages } from './chrome-mock';
const flush=()=>act(()=>new Promise<void>(r=>setTimeout(r,30)));
const saved=vi.fn();
const radio=(name:string,value:string)=>document.querySelector<HTMLInputElement>('input[name="'+name+'"][value="'+value+'"]')!;
function Screen(){const error=useStorageError();return <><FullTextSection/>{error && <p role="alert">{t('errorStorage')}</p>}</>;}
beforeEach(()=>{installChromeMock();clearStorageError();saved.mockClear();document.body.innerHTML='<div id="app"></div>';});
afterEach(()=>{act(()=>render(null,document.querySelector('#app')!));vi.restoreAllMocks();clearStorageError();});
const mount=async()=>{await act(()=>render(<SavedContext.Provider value={saved}><Screen/></SavedContext.Provider>,document.querySelector('#app')!));await flush();};
const click=async(el:HTMLElement)=>{await act(()=>el.click());await flush();};
it('defaults to slow, shows tabs only for standard, and saves each successful change',async()=>{
 await mount();expect(radio('ft-speed','slow').checked).toBe(true);expect(document.querySelector('[name="ft-tabs"]')).toBeNull();
 await click(radio('ft-speed','standard'));expect((await getSettings()).fullTextSpeed).toBe('standard');expect(radio('ft-tabs','1').checked).toBe(true);
 await click(radio('ft-tabs','3'));expect((await getSettings()).fullTextTabs).toBe(3);expect(radio('ft-tabs','3').checked).toBe(true);
 await click(radio('ft-speed','slow'));expect(document.querySelector('[name="ft-tabs"]')).toBeNull();expect(saved).toHaveBeenCalledTimes(3);
 expect(document.querySelector('.ft-speed-desc')!.textContent).toBe(t('fullTextSpeedDesc'));
});
it.each(['speed','tabs'])('failed %s save reports the error and restores the stored selection',async(which)=>{
 if(which==='tabs')await updateSettings({fullTextSpeed:'standard',fullTextTabs:2});await mount();
 vi.spyOn(chrome.storage.local,'set').mockRejectedValueOnce(Error('storage'));
 await click(radio(which==='speed'?'ft-speed':'ft-tabs',which==='speed'?'standard':'3'));
 expect(document.querySelector('[role="alert"]')!.textContent).toBe(t('errorStorage'));expect(saved).not.toHaveBeenCalled();
 if(which==='speed'){expect(radio('ft-speed','slow').checked).toBe(true);expect(radio('ft-speed','standard').checked).toBe(false);expect(document.querySelector('[name="ft-tabs"]')).toBeNull();}
 else {expect(radio('ft-tabs','2').checked).toBe(true);expect(radio('ft-tabs','3').checked).toBe(false);}
});
it('allows changes while fetching and preserves the current run display',async()=>{
 await saveFullTextRun({running:true,kind:'manual',total:4,done:1,failed:0,updatedAt:1});await mount();
 await click(radio('ft-speed','standard'));await click(radio('ft-tabs','2'));
 expect((await getSettings()).fullTextTabs).toBe(2);expect(document.querySelector('.ft-progress')).not.toBeNull();
});
it('has the six new labels and matching placeholders in all eight languages',()=>{
 const keys=['fullTextSpeed','fullTextSpeedSlow','fullTextSpeedStd','fullTextSpeedDesc','fullTextTabs','fullTextTabsN'];
 const en=loadMessages('en');for(const lang of ['ja','en','zh_CN','zh_TW','ko','es','pt_BR','fr']){const d=loadMessages(lang);for(const key of keys){expect(d[key]?.message).toBeTruthy();expect(d[key]?.placeholders).toEqual(en[key]?.placeholders);}}
 expect(t('fullTextTabsN',3)).toBe('3 個');
});
