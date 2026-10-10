import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue, defaultDeps, cleanupAtStartup, AUTO_CAP, MANUAL_CAP, TAB_TIMEOUT_MS, RETRY_MS, type AskResult } from '../src/background/fulltext';
import { getFullTextTab, setFullTextTab, recordFullTextTry, getFullTextTries, type FullTextRun } from '../src/shared/settings';
import type { Bookmark } from '../src/shared/models';
let data: Record<string, unknown>;
beforeEach(() => { data = installChromeMock(); vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => vi.useRealTimers());
const items = (n: number) => Array.from({length:n}, (_,i)=>({accountId:'me',tweetId:String(i+1)}));
function fake(tabs: 1|2|3 = 3) {
  let serial = 0;
  const opened: {id:number; url:string; at:number}[] = [];
  const live = new Set<number>(); const closed: number[] = []; const closedAt = new Map<number, number>(); let max = 0;
  const plan = vi.fn(async () => ({gapMinMs:2000,gapMaxMs:5000,tabs}));
  const sleep = (ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
  const refresh = vi.fn(async (_item: {tweetId:string}, _full: {text:string;translated?:true}) => true);
  const saved: FullTextRun[] = [];
  const d = { ...defaultDeps(), now:()=>Date.now(), sleep, random:()=>0,
    plan, collectActive:async()=>false,
    lookup:async (it:{tweetId:string})=>({snapshot:{url:'https://x.com/sample_one/status/'+it.tweetId}} as Bookmark),
    tries:async()=>({}), recordTry:async()=>{}, refresh,
    openTab:async(url:string)=>{ const id=++serial; live.add(id); max=Math.max(max,live.size); opened.push({id,url,at:Date.now()}); return id; },
    closeTab:async(id:number)=>{ live.delete(id); closed.push(id); closedAt.set(id,Date.now()); },
    ask:async(_tab:number,id:string):Promise<AskResult>=>{await sleep(4500); return {ok:true,text:'架空の全文 '+id,translated:true};},
    saveRun:async(r:FullTextRun)=>{await sleep(r.done === 1 ? 300 : 10); saved.push({...r});},
  };
  return {d,opened,live,closed,closedAt,plan,refresh,saved,get max(){return max;}};
}
async function finish(p:Promise<void>) { await vi.runAllTimersAsync(); await p; }
it('three workers share spaced starts and unique claims; counters and translated survive concurrent updates', async()=>{
 const f=fake(); const q=new FullTextQueue(f.d);
 const p=q.enqueue([...items(9),...items(3)],'manual');
 await vi.advanceTimersByTimeAsync(2200);
 const join=q.enqueue(items(9),'manual');
 await finish(Promise.all([p,join]).then(()=>{}));
 expect(f.max).toBe(3); expect(f.opened).toHaveLength(9);
 expect(new Set(f.opened.map(o=>o.url)).size).toBe(9);
 for(let i=1;i<f.opened.length;i++) expect(f.opened[i].at-f.opened[i-1].at).toBeGreaterThanOrEqual(1000);
 expect(f.live.size).toBe(0); expect(f.plan).toHaveBeenCalledTimes(1);
 for(let i=3;i<f.opened.length;i++) {
   const gap=f.opened[i].at-f.closedAt.get(f.opened[i-3].id)!;
   expect(gap).toBeGreaterThanOrEqual(2000); expect(gap).toBeLessThanOrEqual(5000);
 }
 expect(q.state).toMatchObject({done:9,failed:0,skipped:0,total:9,running:false});
 expect(f.saved.at(-1)).toMatchObject({done:9,total:9,running:false});
 expect(f.saved.map(r=>r.done)).toEqual([...f.saved.map(r=>r.done)].sort((a,b)=>a-b));
 expect(f.refresh.mock.calls[0][1]).toMatchObject({translated:true});
});
it('a limit on one worker immediately closes all active tabs and prevents later starts',async()=>{
 const f=fake(); f.d.ask=async(tab)=>{ await f.d.sleep(tab===1 ? 2500 : 10000); return {ok:false,reason:tab===1?'limit':'wait'}; };
 const q=new FullTextQueue(f.d); const p=q.enqueue(items(10),'manual');
 await vi.advanceTimersByTimeAsync(2600);
 expect(f.live.size).toBe(0); expect(f.opened).toHaveLength(3);
 await finish(p); expect(q.state).toMatchObject({stopReason:'limit',failed:1,running:false});
 expect(new Set(f.closed).size).toBe(3); expect(await getFullTextTab()).toEqual([]);
});
it('three failures across workers stop together; a success resets their shared count',async()=>{
 const f=fake(); f.d.ask=async()=>({ok:true,text:'架空の成功'});
 // open failures are final failures, not polling, and span all workers.
 const original=f.d.openTab; let attempts=0;
 f.d.openTab=async(url)=>{ attempts++; if([1,2,4,5,6].includes(attempts)) throw Error('failed opening'); return original(url); };
 const q=new FullTextQueue(f.d); await finish(q.enqueue(items(12),'manual'));
 expect(attempts).toBe(6); expect(q.state).toMatchObject({failed:5,done:1,stopReason:'failures'}); expect(f.live.size).toBe(0);
});
it('stop closes all tabs, cancels waits, and does not count aborted requests',async()=>{
 const f=fake(); const q=new FullTextQueue(f.d); const p=q.enqueue(items(9),'manual');
 await vi.advanceTimersByTimeAsync(2200); expect(f.live.size).toBe(3);
 await finish(Promise.all([q.stop(),p]).then(()=>{}));
 expect(f.live.size).toBe(0); expect(q.state).toMatchObject({stopReason:'user',failed:0,running:false});
 expect(await getFullTextTab()).toEqual([]);
});
it('plan is fixed during a run, changes next run, and collection pauses every worker',async()=>{
 const f=fake(); let collecting=true; f.d.collectActive=async()=>collecting;
 const q=new FullTextQueue(f.d); const p=q.enqueue(items(4),'manual');
 await vi.advanceTimersByTimeAsync(6000); expect(f.opened).toHaveLength(0);
 f.plan.mockResolvedValue({gapMinMs:4000,gapMaxMs:8000,tabs:1}); collecting=false;
 await finish(p); expect(f.max).toBe(3); expect(f.plan).toHaveBeenCalledTimes(1);
 await finish(q.enqueue(items(2),'manual')); expect(f.plan).toHaveBeenCalledTimes(2);
 expect(AUTO_CAP).toBe(30); expect(MANUAL_CAP).toBe(50); expect(TAB_TIMEOUT_MS).toBe(15000); expect(RETRY_MS).toBe(3600000);
});
it('skipped items require no worker gaps or tabs',async()=>{
 const f=fake(); f.d.lookup=async()=>undefined as never;
 const q=new FullTextQueue(f.d); await finish(q.enqueue(items(8),'save'));
 expect(f.opened).toHaveLength(0); expect(q.state).toMatchObject({skipped:8,done:0,total:8});
});
it.each([[42],[[42,43,44]],[null]])('startup cleans legacy or array tab records %j',async(raw)=>{
 data.fullTextTab=raw; const f=fake(); await cleanupAtStartup(f.d);
 expect(f.closed).toEqual(raw===null?[]:Array.isArray(raw)?raw:[raw]); expect(await getFullTextTab()).toEqual([]);
});
it('serialized tab and retry records never lose concurrent additions',async()=>{
 data.fullTextTab=42;
 await Promise.all([setFullTextTab(43),setFullTextTab(44),setFullTextTab(42,false)]);
 expect(await getFullTextTab()).toEqual([43,44]);
 await Promise.all([recordFullTextTry('me:1',Date.now(),RETRY_MS),recordFullTextTry('me:2',Date.now(),RETRY_MS)]);
 expect(Object.keys(await getFullTextTries()).sort()).toEqual(['me:1','me:2']);
});

it('a nonresponding request is bounded by the same 15-second deadline',async()=>{
 const f=fake(1); f.d.ask=()=>new Promise(()=>{});
 const q=new FullTextQueue(f.d); const p=q.enqueue(items(1),'manual');
 await vi.advanceTimersByTimeAsync(15020);
 expect(f.live.size).toBe(0); await finish(p); expect(q.state.failed).toBe(1);
});
it('a join during final publishing is accepted as the next run',async()=>{
 const f=fake(1); const q=new FullTextQueue(f.d); const original=f.d.saveRun;
 let join:Promise<void>|undefined;
 f.d.saveRun=async r=>{ if(!r.running && !join) join=q.enqueue([{accountId:'me',tweetId:'2'}],'manual'); await original(r); };
 await finish(q.enqueue(items(1),'manual')); await finish(join!);
 expect(f.opened).toHaveLength(2); expect(f.plan).toHaveBeenCalledTimes(2);
});

it('failures from actual tabs are shared and an intervening success resets them',async()=>{
 const f=fake(); f.d.ask=async(_tab,id)=>{await f.d.sleep(2500);return {ok:true,text:'架空の全文 '+id};};
 f.refresh.mockImplementation(async item=>item.tweetId==='3');
 const q=new FullTextQueue(f.d); await finish(q.enqueue(items(12),'manual'));
 expect(q.state).toMatchObject({failed:5,done:1,stopReason:'failures'});
 expect(f.live.size).toBe(0); expect(f.max).toBe(3);
});
