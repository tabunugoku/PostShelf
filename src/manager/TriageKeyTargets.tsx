import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { displayName, type Folder } from '../shared/models';
import { getSettings, updateSettings } from '../shared/settings';
import { triageKeyTargets } from '../shared/triageKeys';
import { t } from '../shared/strings';
import { FolderTreeList, useFolderTreeState } from './FolderTree';

/** Shared by Sort mode and Settings. Assignments are drafts until Save. */
export function TriageKeyTargets(props: {folders:Folder[];onClose:()=>void;onSaved?:()=>void}) {
  const tree = useFolderTreeState();
  const [mode,setMode] = useState<'auto'|'manual'>('auto');
  const [ids,setIds] = useState<string[]>(Array(9).fill(''));
  const [replacement,setReplacement] = useState<Folder|null>(null);
  const [ready,setReady] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const busy = useRef(false);
  const dragging = useRef<number|null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus();
    let live = true;
    void getSettings().then(s => {
      if (!live) return;
      setMode(s.triageKeyMode === 'manual' ? 'manual' : 'auto');
      setIds(triageKeyTargets({...s,triageKeyMode:'manual'},props.folders).map(f => f?.id ?? ''));
      setReady(true);
    }).catch(() => { if(live)setError(t('errorStorage')); });
    return () => {live=false;prev?.focus();};
  },[]);
  const slots = triageKeyTargets({triageKeyMode:mode,triageKeyFolders:ids},props.folders,tree.collapsed);
  const numbers = new Map<string,number>();
  slots.forEach((f,i)=>{if(f)numbers.set(f.id,i+1);});
  const pick = (f:Folder) => {
    if (mode !== 'manual' || busy.current || !ready) return;
    const at = ids.indexOf(f.id);
    if (at >= 0) {setIds(ids.map((id,i)=>i===at?'':id));setReplacement(null);return;}
    const free = slots.findIndex(f=>!f);
    if (free < 0) {setReplacement(f);return;}
    setIds(ids.map((id,i)=>i===free?f.id:id));
    setReplacement(null);
  };
  const save = async () => {
    if (busy.current || !ready || replacement) return;
    busy.current=true;setSaving(true);
    try {
      await updateSettings({triageKeyMode:mode,triageKeyFolders:triageKeyTargets({triageKeyMode:'manual',triageKeyFolders:ids},props.folders).map(f=>f?.id??'')});
      props.onSaved?.();props.onClose();
    } catch {setError(t('errorStorage'));}
    finally {busy.current=false;setSaving(false);}
  };
  const key = (e:KeyboardEvent) => {
    e.stopPropagation();
    if (e.key==='Escape') {e.preventDefault();if(!busy.current)props.onClose();}
    if (e.key==='Tab') {
      const items=[...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')??[])];
      if(!items.length){e.preventDefault();return;}
      const at=items.indexOf(document.activeElement as HTMLElement);
      if(e.shiftKey && at<=0){e.preventDefault();items[items.length-1].focus();}
      else if(!e.shiftKey && (at<0 || at===items.length-1)){e.preventDefault();items[0].focus();}
    }
  };
  return <div class="overlay key-target-overlay" onClick={()=>{if(!busy.current)props.onClose();}}>
    <div ref={root} class="dialog dialog-wide key-targets" role="dialog" aria-modal="true" aria-labelledby="key-target-title" tabIndex={-1} onClick={e=>e.stopPropagation()} onKeyDown={key}>
      <h2 id="key-target-title" class="dialog-title">{t('triageKeyTitle')}</h2>
      <div class="key-target-modes">{(['manual','auto'] as const).map(m=><label><input type="radio" name="triageKeyMode" value={m} checked={mode===m} disabled={!ready||saving} onChange={()=>{setMode(m);setReplacement(null);}}/>{t(m==='manual'?'triageKeyManual':'triageKeyAuto')}</label>)}</div>
      <div class="key-target-columns">
        <FolderTreeList folders={props.folders} collapsed={tree.collapsed} onToggle={tree.toggle} selected={new Set(numbers.keys())} numbers={numbers} onPick={pick} disabled={!ready||saving} pickDisabled={mode!=='manual'}/>
        <div class="key-target-slots">
          <b>{t('triageKeyOrder')}</b><span class="muted">{t('triageKeyOrderHint')}</span>
          {slots.map((f,i)=><button class={'key-target-slot'+(!f?' empty':'')} data-key-slot={i} draggable={mode==='manual'&&!saving&&!replacement} disabled={!ready||saving} onDragStart={e=>{dragging.current=i;e.dataTransfer?.setData('text/plain',String(i));if(e.dataTransfer)e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{dragging.current=null;}} onDragOver={e=>{if(mode==='manual'&&dragging.current!==null&&!saving&&!replacement)e.preventDefault();}} onDrop={e=>{e.preventDefault();const from=dragging.current;dragging.current=null;if(from===null||mode!=='manual'||saving||replacement)return;const next=slots.map(f=>f?.id??'');const [id]=next.splice(from,1);next.splice(i,0,id);setIds(next);}} onClick={()=>{if(replacement){setIds(slots.map((f,n)=>n===i?replacement.id:f?.id??''));setReplacement(null);}}}>
            <kbd>{i+1}</kbd>{f&&<Icon name={f.icon} color={f.color}/>}<span>{f?displayName(f):t('triageKeyEmpty')}</span>
          </button>)}
        </div>
      </div>
      {replacement&&<p data-key-replace role="status">{t('triageKeyReplace')} <b>{displayName(replacement)}</b></p>}
      {error&&<p class="error" role="alert">{error}</p>}
      <div class="dialog-actions"><button class="key-target-cancel" disabled={saving} onClick={props.onClose}>{t('cancel')}</button><button class="primary key-target-save" disabled={!ready||saving||!!replacement} onClick={()=>void save()}>{t('save')}</button></div>
    </div>
  </div>;
}
