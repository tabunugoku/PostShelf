import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue } from '../src/background/fulltext';
import { fakeFullText, items, finish } from './fulltext-fake';
beforeEach(()=>{installChromeMock();vi.useFakeTimers();vi.setSystemTime(1000000);});
afterEach(()=>vi.useRealTimers());
it('keeps at least 1000ms between starts across consecutive runs',async()=>{
 const f=fakeFullText(1);f.d.ask=async()=>({ok:true,text:'架空の全文'});const q=new FullTextQueue(f.d);
 await finish(q.enqueue(items(1,1),'save'));await finish(q.enqueue(items(2,1),'save'));
 expect(f.opened).toHaveLength(2);expect(f.opened[1].at-f.opened[0].at).toBeGreaterThanOrEqual(1000);
});
it('creates the read cancellation promise only once per run, regardless of polling',async()=>{
 const f=fakeFullText(1);f.d.ask=vi.fn(async()=>({ok:false,reason:'wait'} as const));const q=new FullTextQueue(f.d);
 let cancelled:Promise<void>;let registrations=0;
 Object.defineProperty(q,'cancelled',{get:()=>cancelled,set:(value:Promise<void>)=>{
  cancelled=value;const then=value.then.bind(value) as (...args:any[])=>Promise<unknown>;
  // Promise.race subscribes with two callbacks; the derived read promise uses one.
  (value as any).then=(...args:any[])=>{if(args.length===1)registrations++;return then(...args);};
 }});
 await finish(q.enqueue(items(1,1),'manual'));expect(f.d.ask).toHaveBeenCalledTimes(15);expect(registrations).toBe(1);
 await finish(q.enqueue(items(2,1),'manual'));expect(f.d.ask).toHaveBeenCalledTimes(30);expect(registrations).toBe(2);
});
