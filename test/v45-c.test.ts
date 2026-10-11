import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { collectVisible } from '../src/content/collect';
import { VisibleMediaBackfill } from '../src/content/media';
import { addCollected, backfillMedia, getSavedIds, setAccountScope } from '../src/shared/storage';
import { AutoCollector, defaultDeps } from '../src/content/autocollect';

let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock(); data.schemaVersion = 2; data.folderIdsRepaired = true; setAccountScope('me');
  document.body.innerHTML = readFileSync('test/fixtures/v45-media.html','utf8');
});
const snapshot = { text: '架空の保存済み本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/102', translated: true as const,
  quote: { author: 'Sample Quote', handle: '@sample_quote', text: '架空の引用', media: [] } };
function seed(id: string, extra = {}, accountId = 'me') {
  const b = { accountId, tweetId: id, savedAt: 1234, folderIds: ['sample-folder'], snapshot: { ...snapshot, ...extra } };
  data.bookmarks = { ...(data.bookmarks as object), [`${accountId}:${id}`]: b }; return structuredClone(b);
}
function watcher() {
  let clock = 0, account: string | null = 'me', path = '/home';
  const savedIds = vi.fn(getSavedIds), fill = vi.fn(backfillMedia);
  const w = new VisibleMediaBackfill({ now: () => clock, accountId: () => account, path: () => path, visible: () => collectVisible(), savedIds, backfill: fill });
  return { w, savedIds, fill, time: (n:number) => clock=n, account: (id:string|null) => account=id, path: (p:string) => path=p };
}

it.each(['/home','/sample_image/status/102','/i/history','/i/bookmarks'])('fills only stored media on %s without creating unsaved posts', async path => {
  const old = seed('102'); const other = seed('102',{},'sample_other'); const r=watcher(); r.path(path);
  expect(await r.w.update()).toBe(1);
  expect(data.bookmarks).toEqual({ 'me:102': { ...old, snapshot: { ...old.snapshot, media:['https://pbs.twimg.com/media/sample-image.jpg'] } }, 'sample_other:102': other });
  expect(r.fill).toHaveBeenCalledTimes(1);
});

it('fills a saved video poster without changing anything else', async () => {
  const old=seed('104',{hasVideo:true}); const r=watcher();
  expect(await r.w.update()).toBe(1);
  expect((data.bookmarks as any)['me:104']).toEqual({ ...old, snapshot: { ...old.snapshot, videoPoster:'https://pbs.twimg.com/media/sample-video.jpg' } });
});

it('checks a saved post once per display, reuses IDs briefly and resets on disappearance', async () => {
  seed('102'); const r=watcher();
  await Promise.all([r.w.update(),r.w.update()]); await r.w.update();
  expect(r.fill).toHaveBeenCalledTimes(1); expect(r.savedIds).toHaveBeenCalledTimes(1);
  const article=document.getElementById('image-ready')!; article.remove(); await r.w.update();
  document.body.append(article); await r.w.update(); expect(r.fill).toHaveBeenCalledTimes(2);
  r.time(301); await r.w.update(); expect(r.savedIds).toHaveBeenCalledTimes(2);
});

it('does nothing while media is unreadable; a later DOM load can fill it', async () => {
  const old=seed('101'); const r=watcher(); const set=vi.spyOn(chrome.storage.local,'set');
  await r.w.update(); expect(r.fill).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
  expect((data.bookmarks as any)['me:101']).toEqual(old);
  document.querySelector('#image-pending img')!.setAttribute('src','https://pbs.twimg.com/media/sample-late.jpg');
  expect(await r.w.update()).toBe(1);
  expect((data.bookmarks as any)['me:101'].snapshot.media).toEqual(['https://pbs.twimg.com/media/sample-late.jpg']);
});

it('invalidates saved IDs on data changes and scopes attempts by account and path', async () => {
  const r=watcher(); await r.w.update(); seed('102'); r.w.invalidate();
  expect(await r.w.update()).toBe(1);
  seed('102',{},'sample_other'); r.account('sample_other'); expect(await r.w.update()).toBe(1);
  r.path('/sample_image/status/102'); await r.w.update(); expect(r.fill).toHaveBeenCalledTimes(3);
  r.account(null); await r.w.update(); expect(r.fill).toHaveBeenCalledTimes(3);
});

it('backfills during auto collection without losing the fresh posts being saved', async () => {
  const old=seed('102'); const r=watcher(); let c:AutoCollector;
  c=new AutoCollector({ ...defaultDeps(), visible: () => collectVisible(), savedIds: getSavedIds,
    now: () => 5000, sleep: async () => {}, random: () => 0, scrollToTop: () => {}, scrollY: () => 0, scrollBy: () => {}, viewportHeight: () => 1000,
    pageOk: () => true, isHidden: () => false, accountId: () => 'me', isLoading: () => false, hasUnseen: () => false, hasLimit: () => false,
    saveRun: async () => {}, clearRun: async () => {}, addCollected: async (seq,at,account) => {
      expect(c.state!.status).toBe('running'); const [n]=await Promise.all([addCollected(seq,at,account),r.w.update()]); return n;
    },
  });
  await c.start({consent:true,accountId:'me',cap:0,speed:'slow'});
  for(let i=0;i<50 && c.state?.status!=='done';i++) await new Promise(resolve=>setTimeout(resolve,0));
  expect(c.state!.status).toBe('done'); expect(c.state!.imported).toBe(4);
  expect(Object.keys(data.bookmarks as object)).toHaveLength(5);
  expect((data.bookmarks as any)['me:102']).toEqual({...old,snapshot:{...old.snapshot,media:['https://pbs.twimg.com/media/sample-image.jpg']}});
});

it('uses the existing DOM/path watchers, including late src and poster attribute loads', () => {
  const source=readFileSync('src/content/index.ts','utf8');
  expect(source).toContain('installMediaBackfill()'); expect(source).toContain('scheduleMediaBackfill()');
  expect(source).toMatch(/attributeFilter:\s*\['src',\s*'poster'\]/);
});
