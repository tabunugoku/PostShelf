import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card, type RowHandlers } from '../src/manager/Cards';
import { ImageViewer, VideoGuide } from '../src/manager/Viewer';
import { App } from '../src/manager/App';
import { refreshCacheView } from '../src/manager/cacheView';
import { installChromeMock, loadMessages } from './chrome-mock';
import { type Bookmark, type QuoteSnapshot } from '../src/shared/models';
import { queryBookmarks } from '../src/shared/query';
import { setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { targetsOf } from '../src/shared/cacheops';
import * as cacheops from '../src/shared/cacheops';
import { DEFAULT_IMAGE_CACHE, updateSettings } from '../src/shared/settings';
const quote: QuoteSnapshot = { author: 'Sample Quote', handle: '@sample_quote', avatar: 'https://example.invalid/avatar.jpg', text: 'Sample quote body', createdAt: '2026-10-10T00:00:00Z', media: Array.from({ length: 5 }, (_, i) => 'https://example.invalid/q' + i + '.jpg'), url: 'https://x.com/sample_quote/status/333', translated: true, segments: [{ t: 'text', v: 'Sample quote ' }, { t: 'link', v: 'body', href: 'https://example.invalid/link' }] };
const bookmark = (): Bookmark => ({ accountId: 'me', tweetId: '111', folderIds: [], savedAt: 1, snapshot: { text: 'Sample main', author: 'Sample Main', handle: '@sample_main', url: 'https://x.com/sample_main/status/111', media: ['https://example.invalid/main.jpg'], quote: structuredClone(quote), translated: true } });
let host: HTMLDivElement; let b: Bookmark; let h: RowHandlers;
const mount = async (view: 'post' | 'list' | 'grid' = 'post', compact = false) => { await act(() => void render(<Card b={b} view={view} compact={compact} selected={false} selectionActive={false} tabbable folderOf={() => undefined} pickerOpen={false} pickerNode={null} h={h} />, host)); };
const click = async (el: Element) => { await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); };
beforeEach(async () => {
  installChromeMock(); setAccountScope('me'); await refreshCacheView(); document.body.innerHTML = '<div id="app"></div>'; host = document.querySelector('#app')!;
  b = bookmark(); h = { select: vi.fn(), focus: vi.fn(), removeFromFolder: vi.fn(), togglePicker: vi.fn(), del: vi.fn(), dragStart: vi.fn(), openImage: vi.fn(), openVideo: vi.fn() };
});
afterEach(() => { render(null, host); vi.restoreAllMocks(); });
describe('v42-D: visible quotes and translation badges', () => {
  it.each([false, true])('renders own and quote contents with max four images (compact %s)', async compact => {
    await mount('post', compact); const q = host.querySelector('.quote-block')!;
    expect(q.getAttribute('aria-label')).toBe(t('quoteLabel')); expect(q.getAttribute('title')).toBe(t('quoteAsSeen'));
    expect(q.textContent).toContain('Sample Quote'); expect(q.textContent).toContain('@sample_quote'); expect(q.textContent).toContain('Sample quote body'); expect(q.textContent).toContain('2026');
    expect(q.querySelector<HTMLImageElement>('.quote-avatar')!.src).toBe(quote.avatar);
    expect([...q.querySelectorAll<HTMLImageElement>('.media img')].map(i => i.src)).toEqual(quote.media.slice(0, 4));
    expect(q.querySelector('.tl')!.getAttribute('href')).toBe('https://example.invalid/link');
    expect(host.querySelectorAll('.translated-badge')).toHaveLength(2); expect(q.querySelector('.translated-badge')!.textContent).toBe(t('translatedBadge'));
    expect(host.querySelector('.post-body > .post-text')!.textContent).toContain('Sample main');
  });
  it('has no quote or badges for old snapshots', async () => {
    delete b.snapshot.quote; delete b.snapshot.translated; await mount();
    expect(host.querySelector('.quote-block')).toBeNull(); expect(host.querySelector('.translated-badge')).toBeNull(); expect(host.textContent).toContain('Sample main');
  });
  it.each(['list', 'grid'] as const)('does not change %s layout', async view => {
    await mount(view); expect(host.querySelector('.quote-block')).toBeNull(); expect(host.querySelector('.translated-badge')).toBeNull();
  });
  it('uses a safe full-block link with a separate body link, never nested links', async () => {
    await mount(); const q = host.querySelector('.quote-block')!; const link = q.querySelector<HTMLAnchorElement>('.quote-open')!;
    expect(link.href).toBe(quote.url); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer'); expect(link.getAttribute('aria-label')).toBe(t('openOnX'));
    expect(q.querySelector('a a')).toBeNull(); await click(link); await click(q.querySelector('.tl')!);
    expect(h.select).not.toHaveBeenCalled(); expect(h.openImage).not.toHaveBeenCalled(); expect(h.openVideo).not.toHaveBeenCalled();
  });
  it('without a post URL only author and handle link to profile', async () => {
    delete b.snapshot.quote!.url; await mount(); const q = host.querySelector('.quote-block')!;
    expect(q.querySelector('.quote-open')).toBeNull(); expect(q.classList.contains('linked')).toBe(false);
    const profile = q.querySelector<HTMLAnchorElement>('.quote-author')!; expect(profile.href).toBe('https://x.com/sample_quote'); expect(profile.textContent).toContain('Sample Quote'); expect(profile.textContent).toContain('@sample_quote');
    await click(profile); expect(h.select).not.toHaveBeenCalled();
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'https://example.invalid/post'])('does not turn unsafe quote URL %s into a block link', async url => {
    b.snapshot.quote!.url = url; await mount(); expect(host.querySelector('.quote-open')).toBeNull(); expect(host.querySelector('a[href^="javascript:"],a[href^="data:"]')).toBeNull();
  });
  it('quote interaction does not start compact long-press selection', async () => {
    vi.useFakeTimers(); try { await mount('post', true); const q = host.querySelector('.quote-block')!;
      await act(() => { q.dispatchEvent(new Event('pointerdown', { bubbles: true })); vi.advanceTimersByTime(600); }); expect(h.select).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it.each(['image', 'video'])('renders the same quote and badge inside the %s viewer', async kind => {
    await act(() => void render(kind === 'image' ? <ImageViewer tweetId="111" urls={b.snapshot.media} index={0} postUrl={b.snapshot.url} snapshot={b.snapshot} onIndex={() => {}} onClose={h.del as () => void} /> : <VideoGuide tweetId="111" postUrl={b.snapshot.url} snapshot={b.snapshot} onClose={h.del as () => void} />, host));
    expect(host.querySelector('.viewer .quote-block')!.textContent).toContain('Sample quote body'); expect(host.querySelectorAll('.viewer .translated-badge')).toHaveLength(2);
    await click(host.querySelector('.quote-open')!); await click(host.querySelector('.quote-block .tl')!); expect(h.del).not.toHaveBeenCalled();
  });
  it('App passes the saved snapshot when opening the viewer', async () => {
    window.innerWidth = 1200; await setBookmarkFolders('111', [], b.snapshot); await act(() => void render(<App />, host)); await act(() => new Promise<void>(r => setTimeout(r, 30)));
    await click(host.querySelector('.post-body > .media .ph')!); expect(host.querySelector('.viewer .quote-block')!.textContent).toContain('Sample Quote');
  });
  it('quote images bypass cache reads and are absent from cache targets', async () => {
    const get = vi.fn(async () => null);
    vi.spyOn(cacheops, 'openStore').mockResolvedValue({ status: 'ok', store: { get } as any });
    await updateSettings({ imageCache: { ...DEFAULT_IMAGE_CACHE, enabled: true } }); await refreshCacheView();
    b.snapshot.media = []; await mount(); await act(() => Promise.resolve());
    expect(get).not.toHaveBeenCalled(); expect(host.querySelector<HTMLImageElement>('.quote-photo img')!.src).toBe(quote.media[0]);
    expect(targetsOf(b.snapshot, 'orig')).toEqual([]);
  });
  it('shows main and quote translation marks independently', async () => {
    delete b.snapshot.translated; await mount(); expect(host.querySelectorAll('.translated-badge')).toHaveLength(1); expect(host.querySelector('.quote-block .translated-badge')).not.toBeNull();
    b = bookmark(); delete b.snapshot.quote!.translated; await mount(); expect(host.querySelectorAll('.translated-badge')).toHaveLength(1); expect(host.querySelector('.quote-block .translated-badge')).toBeNull();
  });
  it('does not search quoted body or identity', () => {
    for (const search of ['quote body', 'sample_quote']) expect(queryBookmarks([b], { folderId: 'all', search, sort: 'savedDesc' })).toEqual([]);
    expect(queryBookmarks([b], { folderId: 'all', search: 'Sample main', sort: 'savedDesc' })).toEqual([b]);
  });
  it('all eight languages have the three labels, and quote CSS uses shared themes and shrinking widths', () => {
    for (const lang of ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr']) for (const key of ['translatedBadge', 'quoteLabel', 'quoteAsSeen']) expect(loadMessages(lang)[key]?.message).toBeTruthy();
    const css = readFileSync('static/manager.css', 'utf8'); expect(css).toMatch(/\.quote-block\{[^}]*border:[^}]*var\(--border/); expect(css).toMatch(/\.quote-block\{[^}]*min-width:0/); expect(css).toMatch(/\.translated-badge\{[^}]*color:var\(--text/);
  });
});
