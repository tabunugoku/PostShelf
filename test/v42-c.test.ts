import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteSnapshot, Snapshot } from '../src/shared/models';
import { exportData, getBookmark, importData, keepFullText, refreshFullText, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { FullTextQueue, defaultDeps, type AskResult } from '../src/background/fulltext';
import { handleMessage } from '../src/content/messages';
import { updateFromStatusPage } from '../src/content/fulltext';
import { resetAccount, setCurrentAccount } from '../src/content/account';
const quote: QuoteSnapshot = { text: 'Sample quote', author: 'Sample Quote', handle: '@sample_quote', media: ['https://example.invalid/q.jpg'], avatar: 'https://example.invalid/avatar.jpg', url: 'https://x.com/sample_quote/status/333', createdAt: '2026-10-10T00:00:00Z', segments: [{ t: 'link', v: 'link', href: 'https://example.invalid/link' }], translated: true };
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ text: 'Sample main', author: 'Sample Main', handle: '@sample_main', media: [], url: 'https://x.com/sample_main/status/111', ...over });
beforeEach(() => { installChromeMock(); resetAccount(); setAccountScope('me'); history.pushState(null, '', '/home'); });
describe('v42-C: resaving and import compatibility', () => {
  it('retains missing quote, replaces a present quote, and follows the replacement body translation', async () => {
    await setBookmarkFolders('111', [], snap({ quote, translated: true }));
    await setBookmarkFolders('111', [], snap({ text: 'Updated sample body' }));
    expect((await getBookmark('111'))!.snapshot).toMatchObject({ quote, text: 'Updated sample body' });
    expect((await getBookmark('111'))!.snapshot.translated).toBeUndefined();
    const replacement = { ...quote, text: 'New sample quote' };
    await setBookmarkFolders('111', [], snap({ quote: replacement, translated: true }));
    expect((await getBookmark('111'))!.snapshot).toMatchObject({ quote: replacement, translated: true });
  });
  it.each([true, undefined] as const)('keeps translation of retained full text (%s), not collapsed replacement', translated => {
    const prev = snap({ text: 'Full sample text with a longer continuation', quote, ...(translated ? { translated } : {}) });
    const result = keepFullText(prev, snap({ text: 'Short', truncated: true, ...(translated ? {} : { translated: true }) }));
    expect(result.text).toBe(prev.text); expect(result.quote).toEqual(quote); expect(result.translated).toBe(translated);
  });
  it('can refresh quote without overwriting already fetched full text', () => {
    const result = keepFullText(snap({ text: 'Full sample text', quote }), snap({ text: 'Short', truncated: true, quote: { ...quote, text: 'New quote' } }));
    expect(result.quote!.text).toBe('New quote'); expect(result.text).toBe('Full sample text');
  });
  it('round-trips all optional quote fields and translation unchanged', async () => {
    await setBookmarkFolders('111', [], snap({ quote, translated: true })); const out = await exportData();
    expect(out.bookmarks[0].snapshot).toEqual(snap({ quote, translated: true }));
    installChromeMock(); setAccountScope('me'); expect(await importData(JSON.parse(JSON.stringify(out)))).toBe(1);
    expect((await getBookmark('111'))!.snapshot).toEqual(snap({ quote, translated: true }));
  });
  it.each([{ media: 'not an array' }, { url: 'https://example.invalid/post' }, { url: 'https://x.com.example.invalid/sample_quote/status/333' }, { author: 5 }, { text: null }, { handle: [] }, { createdAt: 5 }])('drops only invalid quote %j', async invalid => {
    await setBookmarkFolders('111', [], snap({ quote, translated: true })); const out = await exportData();
    (out.bookmarks[0].snapshot as any).quote = { ...quote, ...invalid };
    installChromeMock(); setAccountScope('me'); expect(await importData(out)).toBe(1);
    const s = (await getBookmark('111'))!.snapshot; expect(s.quote).toBeUndefined(); expect(s.text).toBe('Sample main'); expect(s.translated).toBe(true);
  });
  it('drops non-true translation flags but keeps valid quote fields', async () => {
    await setBookmarkFolders('111', [], snap({ quote })); const out = await exportData();
    (out.bookmarks[0].snapshot as any).translated = 'yes'; (out.bookmarks[0].snapshot.quote as any).translated = false;
    await importData(out); const s = (await getBookmark('111'))!.snapshot;
    expect(s.translated).toBeUndefined(); expect(s.quote!.translated).toBeUndefined(); expect(s.quote!.text).toBe(quote.text);
  });
  it('reads legacy JSON with neither new field', async () => {
    expect(await importData({ app: 'PostShelf', version: 1, folders: [], bookmarks: [{ tweetId: '111', folderIds: [], savedAt: 1, snapshot: snap() }] })).toBe(1);
    setAccountScope('unknown'); expect((await getBookmark('111'))!.snapshot).toEqual(snap());
  });
});
describe('v42-C: full text preserves quote and follows the read body', () => {
  it.each([true, undefined] as const)('refreshes translated flag (%s) while preserving quote', async translated => {
    await setBookmarkFolders('111', [], snap({ quote, truncated: true, ...(translated ? {} : { translated: true }) }));
    expect(await refreshFullText('me', '111', { text: 'Full sample body', ...(translated ? { translated } : {}) })).toBe(true);
    const s = (await getBookmark('111'))!.snapshot; expect(s.text).toBe('Full sample body'); expect(s.quote).toEqual(quote); expect(s.translated).toBe(translated);
  });
  it('passes the DOM translation through readFullText and the background queue without clicking', async () => {
    document.body.innerHTML = readFileSync('test/fixtures/v42-translated-detail.html', 'utf8');
    const click = vi.fn(); document.addEventListener('click', click, { once: true });
    let answer!: AskResult; handleMessage({ type: 'readFullText', tweetId: '111' }, r => answer = r as AskResult);
    expect(answer).toMatchObject({ ok: true, translated: true });
    await setBookmarkFolders('111', [], snap({ quote, truncated: true }));
    const closeTab = vi.fn(async () => {});
    await new FullTextQueue({ ...defaultDeps(), openTab: async () => 7, closeTab, ask: async () => answer }).enqueue([{ accountId: 'me', tweetId: '111' }], 'save');
    expect((await getBookmark('111'))!.snapshot).toMatchObject({ text: '翻訳後の架空の本文', translated: true, quote });
    expect(closeTab).toHaveBeenCalledWith(7); expect(click).not.toHaveBeenCalled(); document.removeEventListener('click', click);
  });
  it('passes translation during a directly visited detail-page refresh and retains saved quote', async () => {
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = readFileSync('test/fixtures/v42-translated-detail.html', 'utf8').replaceAll('/status/111', '/status/114');
    await setBookmarkFolders('114', [], snap({ quote, truncated: true })); history.pushState(null, '', '/sample_main/status/114');
    expect(await updateFromStatusPage()).toBe(true); expect((await getBookmark('114'))!.snapshot).toMatchObject({ translated: true, quote, truncated: false });
  });
});
