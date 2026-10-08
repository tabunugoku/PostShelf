import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { extractTweet } from '../src/content/snapshot';
import { updateFromStatusPage } from '../src/content/fulltext';
import { handleMessage } from '../src/content/messages';
import { PostText } from '../src/manager/PostText';
import { exportData, getBookmark, importData, listAllTruncated, refreshFullText, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { linkifyPlain, safeHref, sanitizeSegments, segmentsOf } from '../src/shared/segments';
import { requestFullTextBatch } from '../src/shared/cacheRequest';

const fx = (n: string) => readFileSync(`test/fixtures/${n}.html`, 'utf8');
const load = (n: string) => {
  document.body.innerHTML = fx(n);
  return extractTweet(document.querySelector('article')!)!;
};
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element>(s: string) => [...document.querySelectorAll<T>(s)];

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  setAccountScope('me');
  history.pushState(null, '', '/home');
});

describe('v24-A: 取得', () => {
  it('a collapsed post is truncated (the 「さらに表示」 link); a full post and the old fixtures are not', () => {
    expect(load('tweet-long').snapshot.truncated).toBe(true);
    expect(load('tweet-full').snapshot.truncated).toBeUndefined();
    expect(load('tweet').snapshot.truncated).toBeUndefined();
    expect(load('tweet').snapshot.segments).toBeUndefined(); // リンクが無ければ text だけ
  });

  it('segments: text and links in order; relative links get https://x.com; display text stays as shown; javascript: is not a link', () => {
    const ex = load('tweet-links');
    expect(ex.snapshot.text).toContain('https://example.com/very/long/pa…');
    expect(ex.snapshot.segments).toEqual([
      { t: 'text', v: '見てください ' },
      { t: 'link', v: 'https://example.com/very/long/pa…', href: 'https://t.co/abc123' },
      { t: 'text', v: ' ' },
      { t: 'link', v: '@someone', href: 'https://x.com/someone' },
      { t: 'text', v: ' ' },
      { t: 'link', v: '#test', href: 'https://x.com/hashtag/test?src=hashtag_click' },
      { t: 'text', v: ' bad' },
    ]);
  });

  it('safeHref / sanitizeSegments accept only http(s) and a valid shape', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('/a')).toBe('https://x.com/a');
    expect(sanitizeSegments('x')).toBeUndefined();
    expect(sanitizeSegments([{ t: 'bad', v: 'x' }])).toBeUndefined();
    expect(sanitizeSegments([{ t: 'link', v: 'x', href: 'javascript:1' }])).toEqual([{ t: 'text', v: 'x' }]);
  });

  it('export → import keeps segments and truncated; an invalid segments value is ignored (the text stays)', async () => {
    const ex = load('tweet-links');
    await setBookmarkFolders('888', [], { ...ex.snapshot, truncated: true });
    const out = await exportData();
    expect(out.bookmarks[0].snapshot.segments?.length).toBeGreaterThan(3);
    expect(out.bookmarks[0].snapshot.truncated).toBe(true);
    installChromeMock();
    setAccountScope('me');
    await importData(JSON.parse(JSON.stringify(out)));
    const back = (await getBookmark('888'))!;
    expect(back.snapshot.segments).toEqual(ex.snapshot.segments);
    expect(back.snapshot.truncated).toBe(true);
    const bad = JSON.parse(JSON.stringify(out));
    bad.bookmarks[0].snapshot.segments = [{ t: 'link', v: 'x' }, 5];
    bad.bookmarks[0].snapshot.truncated = 'yes';
    installChromeMock();
    setAccountScope('me');
    await importData(bad);
    const b2 = (await getBookmark('888'))!;
    expect(b2.snapshot.segments).toBeUndefined();
    expect(b2.snapshot.truncated).toBeUndefined();
    expect(b2.snapshot.text).toBe(ex.snapshot.text);
  });

  it('saving again from the collapsed timeline does not overwrite a full text that was already fetched', async () => {
    const long = load('tweet-long').snapshot;
    await setBookmarkFolders('777', [], long);
    const full = load('tweet-full').snapshot;
    expect(await refreshFullText('me', '777', { text: full.text })).toBe(true);
    await setBookmarkFolders('777', [], long); // たたまれた状態で、もう一度保存
    const b = (await getBookmark('777'))!;
    expect(b.snapshot.text).toBe(full.text);
    expect(b.snapshot.truncated).toBe(false);
  });
});

describe('v24-A: 個別ページでの全文の更新', () => {
  const stored = async (over: object = {}) => {
    const long = load('tweet-long').snapshot;
    await setBookmarkFolders('777', [], { ...long, ...over });
    return (await getBookmark('777'))!;
  };
  it('a saved truncated post becomes the full text; every other field stays', async () => {
    const before = await stored();
    history.pushState(null, '', '/longpost/status/777');
    const full = load('tweet-full').snapshot;
    expect(await updateFromStatusPage()).toBe(true);
    const after = (await getBookmark('777'))!;
    expect(after.snapshot.text).toBe(full.text);
    expect(after.snapshot.truncated).toBe(false);
    expect({ ...after, snapshot: { ...after.snapshot, text: '', truncated: undefined } }).toEqual({ ...before, snapshot: { ...before.snapshot, text: '', truncated: undefined } });
  });
  it('a post that is not saved is not saved; a post that is not truncated is not touched; a still-collapsed page changes nothing', async () => {
    history.pushState(null, '', '/longpost/status/777');
    load('tweet-full');
    expect(await updateFromStatusPage()).toBe(false);
    expect(await getBookmark('777')).toBeUndefined();
    await stored({ truncated: false, text: 'そのまま' });
    expect(await updateFromStatusPage()).toBe(false);
    expect((await getBookmark('777'))!.snapshot.text).toBe('そのまま');
  });
  it('a collapsed page (showMore still there) does not update', async () => {
    await stored();
    history.pushState(null, '', '/longpost/status/777');
    load('tweet-long');
    expect(await updateFromStatusPage()).toBe(false);
    expect((await getBookmark('777'))!.snapshot.truncated).toBe(true);
  });
});

describe('v24: 裏のタブのページで全文を返す (readFullText)', () => {
  const ask = (id: string) => {
    let r: unknown;
    handleMessage({ type: 'readFullText', tweetId: id }, (x) => (r = x));
    return r as { ok: boolean; reason?: string; text?: string };
  };
  it('waits while loading or collapsed, answers with the text when full, and reports a limit when X shows an error', () => {
    document.body.innerHTML = '';
    expect(ask('777')).toEqual({ ok: false, reason: 'wait' });
    load('tweet-long');
    expect(ask('777')).toEqual({ ok: false, reason: 'wait' });
    load('tweet-full');
    const r = ask('777');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('たたまれていた続き');
    document.body.innerHTML = '<div data-testid="error-detail"></div>';
    expect(ask('777')).toEqual({ ok: false, reason: 'limit' });
  });
});

describe('v24-C: 本文の表示', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    host = $('#app');
  });
  afterEach(() => render(null, host));
  const snap = (over: object = {}) => ({ text: 'short', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1', ...over });
  const mount = async (s: ReturnType<typeof snap>, onClick = vi.fn()) => {
    await act(() => void render(<div onClick={onClick}><PostText s={s} /></div>, host));
    return onClick;
  };

  it('a text longer than 6 lines is collapsed; 「さらに表示」 expands (aria-expanded) and 「閉じる」 collapses', async () => {
    await mount(snap({ text: Array.from({ length: 10 }, (_, i) => `行 ${i + 1}`).join('\n') }));
    const btn = $<HTMLButtonElement>('.more-btn');
    expect($('.text').classList.contains('clamp')).toBe(true);
    expect(btn.textContent).toBe('さらに表示');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe($('.text').id);
    await act(() => void btn.click());
    expect($('.text').classList.contains('clamp')).toBe(false);
    expect($('.more-btn').textContent).toBe('閉じる');
    expect($('.more-btn').getAttribute('aria-expanded')).toBe('true');
    await act(() => void $<HTMLButtonElement>('.more-btn').click());
    expect($('.text').classList.contains('clamp')).toBe(true);
  });

  it('a short text has no toggle; the collapse does not depend on whether X had collapsed it (truncated false, long text)', async () => {
    await mount(snap());
    expect($$('.more-btn')).toHaveLength(0);
    await act(() => void render(null, host));
    await mount(snap({ text: 'あ'.repeat(400), truncated: false }));
    expect($$('.more-btn')).toHaveLength(1);
    expect($$('.more-btn')[0].tagName).toBe('BUTTON'); // キーボードで操作できる
  });

  it('a post without the full text shows 「全文は X で見る」, a link to the post in a new tab', async () => {
    await mount(snap({ truncated: true }));
    const a = $<HTMLAnchorElement>('a.more-btn');
    expect(a.textContent).toBe('全文は X で見る');
    expect(a.href).toBe('https://x.com/a/status/1');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });

  it('segments links are <a target=_blank rel=noopener>; a javascript: href is never rendered; no HTML is interpreted', async () => {
    const onClick = await mount(
      snap({
        text: 'x <b>y</b> link',
        segments: [
          { t: 'text', v: 'x <b>y</b> ' },
          { t: 'link', v: 'link', href: 'https://t.co/a' },
          { t: 'link', v: 'evil', href: 'javascript:alert(1)' },
        ],
      }),
    );
    const links = $$<HTMLAnchorElement>('.tl');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://t.co/a');
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toContain('noopener');
    expect($('.text').querySelector('b')).toBeNull();
    expect($('.text').textContent).toBe('x <b>y</b> linkevil');
    await act(() => void links[0].click());
    expect(onClick).not.toHaveBeenCalled(); // リンクだけが動く (カードのクリックに届かない)
  });

  it('old saves without segments: only complete URLs become links (a URL cut with 「…」 does not)', () => {
    const segs = linkifyPlain('見て https://example.com/a. と https://example.com/cut… と http://example.org/ok');
    expect(segs.filter((s) => s.t === 'link').map((s) => s.v)).toEqual(['https://example.com/a', 'http://example.org/ok']);
    expect(segs.map((s) => s.v).join('')).toBe('見て https://example.com/a. と https://example.com/cut… と http://example.org/ok');
    expect(segmentsOf({ text: 'plain', segments: 'broken' })).toEqual([{ t: 'text', v: 'plain' }]); // 不正な segments は無視
  });
});

describe('v24: 件数の上限と権限', () => {
  it('an auto-collect batch asks for at most 30 posts; no permission was added', () => {
    const send = vi.fn(async () => undefined);
    (globalThis as any).chrome.runtime.sendMessage = send;
    requestFullTextBatch('me', Array.from({ length: 80 }, (_, i) => String(i)));
    expect((send.mock.calls[0] as any)[0].ids).toHaveLength(30);
    const m = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
    expect(m.permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel']);
    expect(m.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*']);
  });
  it('listAllTruncated lists only truncated posts', async () => {
    await setBookmarkFolders('1', [], { text: 'a', author: 'A', handle: '@a', media: [], url: 'u', truncated: true });
    await setBookmarkFolders('2', [], { text: 'b', author: 'A', handle: '@a', media: [], url: 'u' });
    expect((await listAllTruncated()).map((b) => b.tweetId)).toEqual(['1']);
  });
});
