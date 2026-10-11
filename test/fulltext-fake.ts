import { vi } from 'vitest';
import { defaultDeps, type AskResult, type FullTextDeps } from '../src/background/fulltext';
import type { Bookmark } from '../src/shared/models';
import type { FullTextRun } from '../src/shared/settings';
export const items = (start:number,count:number) => Array.from({length:count},(_,i)=>({accountId:'me',tweetId:String(start+i)}));
export function fakeFullText(tabs:1|2|3=3) {
 let serial=0,max=0;const opened:{id:number;at:number;url:string}[]=[];const live=new Set<number>();const saved:FullTextRun[]=[];
 const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
 const plan=vi.fn(async()=>({gapMinMs:2000,gapMaxMs:5000,tabs}));
 const d:FullTextDeps={...defaultDeps(),now:()=>Date.now(),random:()=>0,sleep,plan,
  collectActive:vi.fn(async()=>false),
  lookup:async it=>({snapshot:{url:'https://x.com/sample_one/status/'+it.tweetId}} as Bookmark),
  tries:async()=>({}),recordTry:async()=>{},refresh:async()=>true,
  openTab:async url=>{const id=++serial;live.add(id);max=Math.max(max,live.size);opened.push({id,at:Date.now(),url});return id;},
  closeTab:async id=>{live.delete(id);},setTab:async()=>{},
  ask:async(_tab,id):Promise<AskResult>=>{await sleep(4500);return {ok:true,text:'架空の全文 '+id,translated:true};},
  saveRun:async r=>{saved.push({...r});},
 };
 return {d,plan,opened,live,saved,get max(){return max;}};
}
export async function finish(p:Promise<unknown>){await vi.runAllTimersAsync();await p;}
