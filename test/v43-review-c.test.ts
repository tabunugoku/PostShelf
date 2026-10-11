import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue } from '../src/background/fulltext';
import { fakeFullText, items, finish } from './fulltext-fake';
beforeEach(()=>{installChromeMock();vi.useFakeTimers();vi.setSystemTime(1000000);});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('restarts idle workers for a join, restores three tabs, and keeps the run plan fixed',async()=>{
 const f=fakeFullText();f.d.ask=async(_tab,id)=>{await f.d.sleep(id==='3'?10000:1200);return {ok:true,text:'架空の全文 '+id};};
 const q=new FullTextQueue(f.d);const p=q.enqueue(items(1,3),'manual');await vi.advanceTimersByTimeAsync(5000);expect(f.live.size).toBe(1);
 const joined=q.enqueue(items(4,3),'manual');await vi.advanceTimersByTimeAsync(1100);expect(f.live.size).toBe(3);
 await finish(Promise.all([p,joined]));expect(f.max).toBe(3);expect(f.opened).toHaveLength(6);expect(f.plan).toHaveBeenCalledTimes(1);expect(q.state).toMatchObject({total:6,done:6,failed:0,skipped:0});
 for(let i=1;i<f.opened.length;i++)expect(f.opened[i].at-f.opened[i-1].at).toBeGreaterThanOrEqual(1000);
});
it('processes a join at the last worker completion without losing pending items or counts',async()=>{
 const f=fakeFullText();const q=new FullTextQueue(f.d);let joined:Promise<void>|undefined;
 const all=Promise.all.bind(Promise);
 vi.spyOn(Promise,'all').mockImplementation(((values:Iterable<unknown>)=>{
  const input=Array.from(values);const p=all(input);
  if(q.busy && input.length===3 && !joined) return p.then(result=>{if(!joined)joined=q.enqueue(items(4,3),'manual');return result;});
  return p;
 }) as typeof Promise.all);
 await finish(q.enqueue(items(1,3),'manual'));await finish(joined!);
 expect(f.opened).toHaveLength(6);expect(new Set(f.opened.map(o=>o.url)).size).toBe(6);expect(q.state).toMatchObject({total:6,done:6,failed:0,skipped:0});expect(f.plan).toHaveBeenCalledTimes(1);expect(f.live.size).toBe(0);
});
it('a resumed slot keeps its own close-to-open cooldown',async()=>{
 const f=fakeFullText();const closes=new Map<number,number>();const close=f.d.closeTab;f.d.closeTab=async id=>{closes.set(id,Date.now());await close(id);};
 f.d.ask=async(_tab,id)=>{await f.d.sleep(id==='3'?10000:1200);return {ok:true,text:'架空の全文 '+id};};
 const q=new FullTextQueue(f.d);const p=q.enqueue(items(1,3),'manual');await vi.advanceTimersByTimeAsync(2400);
 const joined=q.enqueue(items(4,2),'manual');await finish(Promise.all([p,joined]));
 const newStarts=f.opened.slice(3);expect(newStarts).toHaveLength(2);expect(newStarts[0].at-closes.get(1)!).toBeGreaterThanOrEqual(2000);expect(newStarts[1].at-closes.get(2)!).toBeGreaterThanOrEqual(2000);
});
