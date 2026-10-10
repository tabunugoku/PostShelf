import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractTweet } from '../src/content/snapshot';
import { QuoteBlock } from '../src/manager/QuoteBlock';
import { Card, type RowHandlers } from '../src/manager/Cards';
import { refreshCacheView } from '../src/manager/cacheView';
import { exportData, getBookmark, importData, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { targetsOf } from '../src/shared/cacheops';
import { queryBookmarks } from '../src/shared/query';
import type { Bookmark, QuoteSnapshot } from '../src/shared/models';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';
const load = (kind = 'detail') => { document.body.innerHTML = readFileSync('test/fixtures/v42-quote-video-' + kind + '.html', 'utf8'); return document.querySelector('article')!; };
const quote: QuoteSnapshot = { author: 'Sample Quote', handle: '@sample_quote', text: 'Sample quote body', media: [], hasVideo: true, videoPoster: 'https://example.invalid/amplify_video_thumb/sample.jpg' };
const bookmark = (): Bookmark => ({ accountId: 'me', tweetId: '111', folderIds: [], savedAt: 1, snapshot: { author: 'Sample Main', handle: '@sample_main', text: 'Sample main body', media: [], url: 'https://x.com/sample_main/status/111', quote } });
beforeEach(() => { installChromeMock(); setAccountScope('me'); });
describe('v42-G: quote video DOM extraction', () => {
  it.each(['detail', 'timeline'])('reads %s video without operating it', kind => {
    const a = load(kind); expect(a.querySelector('div[role=link] a')).toBeNull(); const click = vi.fn(); a.addEventListener('click', click); const video = a.querySelector('video')!;
    const play = vi.spyOn(video, 'play'); const pause = vi.spyOn(video, 'pause'); const muted = video.muted;
    const ex = extractTweet(a)!; expect(ex.tweetId).toBe('111'); expect(ex.snapshot).toMatchObject({ text: 'Sample main body', media: [], hasVideo: false });
    expect(ex.snapshot.translated).toBeUndefined(); expect(ex.snapshot.quote).toMatchObject({ ...quote, text: 'Sample translated quote body', translated: true });
    expect(ex.snapshot.quote!.url).toBeUndefined(); expect(JSON.stringify(ex.snapshot)).not.toContain('blob:'); expect(JSON.stringify(ex.snapshot)).not.toContain('0:02');
    expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled(); expect(video.muted).toBe(muted); expect(click).not.toHaveBeenCalled();
  });
  it.each(['http://example.invalid/poster.jpg', 'blob:https://example.invalid/sample', ''])('omits unsafe or empty poster %s', poster => {
    const a = load(); a.querySelector('video')!.setAttribute('poster', poster); const q = extractTweet(a)!.snapshot.quote!;
    expect(q.hasVideo).toBe(true); expect(q.videoPoster).toBeUndefined();
  });
  it('keeps video-only quote even if text, images and identity are empty', () => {
    const a=load(); const q=a.querySelector('div[role=link]')!; q.querySelector('[data-testid=tweetText]')!.remove();
    expect(extractTweet(a)!.snapshot.quote).toMatchObject({ text:'', media:[], hasVideo:true, handle:'@sample_quote' });
    q.querySelector('[data-testid=Tweet-User-Avatar]')!.remove(); q.querySelector('[data-testid=User-Name]')!.innerHTML='';
    expect(extractTweet(a)!.snapshot.quote).toMatchObject({ text:'', author:'', handle:'', hasVideo:true });
  });
  it('uses video fallback if player test IDs are absent', () => {
    const a=load(); a.querySelectorAll('[data-testid=videoPlayer],[data-testid=videoComponent]').forEach(el=>el.removeAttribute('data-testid'));
    expect(extractTweet(a)!.snapshot.quote!.hasVideo).toBe(true);
  });
});
describe('v42-G: video import', () => {
  it('round-trips and preserves quote on resave without quote', async () => {
    await setBookmarkFolders('111',[],bookmark().snapshot); const out=await exportData(); installChromeMock(); setAccountScope('me'); await importData(JSON.parse(JSON.stringify(out)));
    expect((await getBookmark('111'))!.snapshot.quote).toEqual(quote);
    const {quote:_,...own}=bookmark().snapshot; await setBookmarkFolders('111',[],own); expect((await getBookmark('111'))!.snapshot.quote).toEqual(quote);
  });
  it.each(['true',false,undefined,1])('drops non-true flag %j and orphan poster',async hasVideo=>{
    await setBookmarkFolders('111',[],bookmark().snapshot); const out=await exportData(); (out.bookmarks[0].snapshot.quote as any).hasVideo=hasVideo; await importData(out);
    const q=(await getBookmark('111'))!.snapshot.quote!; expect(q.hasVideo).toBeUndefined(); expect(q.videoPoster).toBeUndefined(); expect(q.text).toBe(quote.text);
  });
  it.each(['http://example.invalid/poster.jpg','blob:https://example.invalid/poster',5])('drops invalid poster alone %j',async videoPoster=>{
    await setBookmarkFolders('111',[],bookmark().snapshot); const out=await exportData(); (out.bookmarks[0].snapshot.quote as any).videoPoster=videoPoster; await importData(out);
    const {videoPoster:_,...rest}=quote; expect((await getBookmark('111'))!.snapshot.quote).toEqual(rest);
  });
});
describe('v42-G: inert video tile',()=>{
  let host:HTMLDivElement;
  beforeEach(async()=>{document.body.innerHTML='<div id="app"></div>';host=document.querySelector('#app')!;await refreshCacheView();});
  afterEach(()=>{render(null,host);vi.restoreAllMocks();});
  const mount=async(q:QuoteSnapshot)=>{const click=vi.fn();await act(()=>void render(<div onClick={click}><QuoteBlock quote={q} tweetId="111"/></div>,host));return click;};
  it('shows poster, shared marks and accessible name with no button or native video',async()=>{
    const parent=await mount(quote);const tile=host.querySelector('.quote-video')!;
    expect(tile.getAttribute('aria-label')).toBe(t('videoBadge'));expect(tile.querySelector<HTMLImageElement>('img')!.src).toBe(quote.videoPoster);
    expect(tile.querySelector('.play')).not.toBeNull();expect(tile.querySelector('.badge')!.textContent).toContain(t('videoBadge'));expect(tile.tagName).toBe('DIV');expect(tile.querySelector('button,video,a')).toBeNull();
    await act(()=>void tile.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(parent).not.toHaveBeenCalled();expect(targetsOf(bookmark().snapshot,'orig')).toEqual([]);
  });
  it('shows play on black background without poster',async()=>{
    const{videoPoster:_,...q}=quote;await mount(q);expect(host.querySelector('.quote-video img')).toBeNull();expect(host.querySelector('.quote-video .play')).not.toBeNull();
    expect(readFileSync('static/manager.css','utf8')).toMatch(/\.quote-block \.quote-video\{[^}]*background:#000/);
  });
  it('prioritizes photos and adds video badge if both are present',async()=>{
    await mount({...quote,media:['https://example.invalid/photo.jpg']});expect(host.querySelector<HTMLImageElement>('.quote-photo img')!.src).toBe('https://example.invalid/photo.jpg');
    expect(host.querySelector('.quote-photo .badge')!.textContent).toContain(t('videoBadge'));expect(host.querySelector('.quote-video')).toBeNull();
  });
  it('does not call card handlers; shared play/badge remain identical to main tile',async()=>{
    const b=bookmark();b.snapshot.quote={...quote,url:'https://x.com/sample_quote/status/333'};b.snapshot.hasVideo=true;b.snapshot.videoPoster=quote.videoPoster;
    const h=Object.fromEntries(['select','focus','removeFromFolder','togglePicker','del','dragStart','openImage','openVideo'].map(k=>[k,vi.fn()])) as unknown as RowHandlers;
    await act(()=>void render(<Card b={b} view="post" compact={false} selected={false} selectionActive={false} tabbable folderOf={()=>undefined} pickerOpen={false} pickerNode={null} h={h}/>,host));
    await act(()=>void host.querySelector('.quote-video')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(h.select).not.toHaveBeenCalled();expect(h.openImage).not.toHaveBeenCalled();expect(h.openVideo).not.toHaveBeenCalled();
    expect(host.querySelector('.quote-open')!.getAttribute('href')).toBe(b.snapshot.quote.url);
    for(const cls of ['play','badge'])expect(host.querySelector('.quote-video .'+cls)!.outerHTML).toBe(host.querySelector('.post-body > .media .'+cls)!.outerHTML);
  });
  it('does not include quote body/video in main search and filter',()=>{
    const b=bookmark();expect(queryBookmarks([b],{folderId:'all',search:'quote body',sort:'savedDesc'})).toEqual([]);expect(queryBookmarks([b],{folderId:'all',search:'',sort:'savedDesc',filters:{video:true}})).toEqual([]);
  });
});
