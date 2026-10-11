import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue } from '../src/background/fulltext';
import { fakeFullText, items, finish } from './fulltext-fake';
beforeEach(()=>{installChromeMock();vi.useFakeTimers();vi.setSystemTime(1000000);});
afterEach(()=>vi.useRealTimers());
it('caps the collection wait at 360 five-second sleeps and then proceeds',async()=>{
 const f=fakeFullText(1);f.d.collectActive=vi.fn(async()=>true);const q=new FullTextQueue(f.d);const p=q.enqueue(items(1,1),'save');
 try{await vi.advanceTimersByTimeAsync(360*5000+1);expect(f.opened).toHaveLength(1);expect(f.d.collectActive).toHaveBeenCalledTimes(360);expect(f.opened[0].at).toBe(1000000+360*5000);}
 finally{await q.stop();await p;}
});
it('skips completed and recently tried items without waiting for collection',async()=>{
 const f=fakeFullText(1);f.d.collectActive=vi.fn(async()=>true);f.d.lookup=async it=>it.tweetId==='1'?undefined:({snapshot:{url:'https://x.com/sample_one/status/2'}} as never);f.d.tries=async()=>({'me:2':Date.now()});
 const q=new FullTextQueue(f.d);const p=q.enqueue(items(1,2),'save');try{await vi.advanceTimersByTimeAsync(1);expect(q.state).toMatchObject({running:false,skipped:2});expect(f.d.collectActive).not.toHaveBeenCalled();expect(f.opened).toHaveLength(0);}finally{await q.stop();await p;}
});
it('stop interrupts the collection wait without waiting for its cap',async()=>{
 const f=fakeFullText();f.d.collectActive=async()=>true;const q=new FullTextQueue(f.d);const p=q.enqueue(items(1,3),'save');await vi.advanceTimersByTimeAsync(1234);await q.stop();await p;expect(f.opened).toHaveLength(0);expect(q.state).toMatchObject({running:false,stopReason:'user',failed:0});expect(Date.now()).toBe(1001234);
});
