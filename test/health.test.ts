import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { installChromeMock } from './chrome-mock';
import { EMPTY_GRACE_MS, THROTTLE_MS, getLocalHealth, inspect, isBroken, resetHealth, runHealthCheck, scheduleHealthCheck } from '../src/content/health';
import { applyButtonMode, injectButtons } from '../src/content/buttons';
import { installGlobalHandlers } from '../src/content/popover';
import { setNativeBookmark } from '../src/content/native';
import { getHealth } from '../src/shared/settings';
import { buildReport, safePath } from '../src/shared/diagnostics';
import { queryFirst } from '../src/shared/selectors';

const fx = (n: string) => readFileSync(resolve(process.cwd(), `test/fixtures/${n}.html`), 'utf8');
const NORMAL = fx('tweet');
const DEGRADED = fx('tweet-degraded');
const BROKEN = fx('tweet-broken');
const tick = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  resetHealth();
  document.body.innerHTML = '';
  applyButtonMode('separate');
});
afterEach(() => {
  vi.useRealTimers();
  resetHealth();
  applyButtonMode('separate');
});

describe('queryFirst reports which candidate matched', () => {
  it('first candidate = index 0, structural fallback = index 1', () => {
    document.body.innerHTML = NORMAL;
    expect(queryFirst(document, 'tweet')!.index).toBe(0);
    document.body.innerHTML = DEGRADED;
    expect(queryFirst(document, 'tweet')!.index).toBe(1);
    expect(queryFirst(document, 'userName')!.index).toBe(1);
    expect(queryFirst(document, 'tweetText')!.index).toBe(1);
    expect(queryFirst(document, 'bookmarkButton')!.index).toBe(0);
    expect(queryFirst(document, 'removeBookmark')).toBeNull();
  });
});

describe('inspect: ok / degraded / broken', () => {
  it('ok when everything is found by the first candidate', () => {
    document.body.innerHTML = NORMAL;
    expect(inspect()).toMatchObject({ state: 'ok', missing: [], fallback: [], articles: 1 });
  });
  it('degraded when some elements are only found by fallbacks', () => {
    document.body.innerHTML = DEGRADED;
    const r = inspect()!;
    expect(r.state).toBe('degraded');
    expect(r.missing).toEqual([]);
    expect(r.fallback.sort()).toEqual(['tweet', 'tweetText', 'userName']);
  });
  it('broken when required elements are not found', () => {
    document.body.innerHTML = BROKEN;
    const r = inspect()!;
    expect(r.state).toBe('broken');
    expect(r.missing.sort()).toEqual(['bookmarkButton', 'userName']);
  });
  it('broken when post links exist but no post container is found', () => {
    document.body.innerHTML = '<div><a href="/a/status/1"><time datetime="2026-01-01T00:00:00Z"></time></a></div>';
    expect(inspect()).toMatchObject({ state: 'broken', missing: ['tweet'] });
  });
  it('no judgement when there are no posts at all', () => {
    document.body.innerHTML = '<main><h1>Settings</h1></main>';
    expect(inspect()).toBeNull();
  });
  it('a text-less post is fine, but 3+ posts without any text are broken', () => {
    const noText = NORMAL.replace(/<div data-testid="tweetText">.*<\/div>/, '');
    document.body.innerHTML = noText;
    expect(inspect()!.state).toBe('ok');
    document.body.innerHTML = noText.repeat(3);
    expect(inspect()).toMatchObject({ state: 'broken', missing: ['tweetText'] });
  });
  it('uses all visible posts: one post with the elements is enough', () => {
    document.body.innerHTML = BROKEN + NORMAL;
    expect(inspect()!.state).toBe('ok');
  });
});

describe('runHealthCheck stores the result locally', () => {
  it('saves state, time, missing and fallback under `health` (and only on change or every 5 minutes)', async () => {
    document.body.innerHTML = DEGRADED;
    const h = runHealthCheck(document, 1_000)!;
    await tick();
    expect(await getHealth()).toEqual({ state: 'degraded', checkedAt: 1_000, missing: [], fallback: h.fallback, path: '/' });
    const set = vi.spyOn(chrome.storage.local, 'set');
    runHealthCheck(document, 2_000); // 変化なし
    await tick();
    expect(set).not.toHaveBeenCalled();
    runHealthCheck(document, 1_000 + 5 * 60_000 + 1); // 5 分経過
    await tick();
    expect(set).toHaveBeenCalledTimes(1);
    document.body.innerHTML = BROKEN;
    runHealthCheck(document, 400_000);
    await tick();
    expect((await getHealth())!.state).toBe('broken');
  });
  it('keeps the previous state when the page has no posts', async () => {
    document.body.innerHTML = BROKEN;
    runHealthCheck(document, 1);
    document.body.innerHTML = '<main></main>';
    runHealthCheck(document, 2);
    expect(isBroken()).toBe(true);
  });
});

describe('throttle (10 s)', () => {
  it('runs immediately the first time, then at most once per 10 s no matter how many DOM changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    document.body.innerHTML = NORMAL;
    scheduleHealthCheck();
    vi.advanceTimersByTime(0);
    expect(getLocalHealth()!.checkedAt).toBe(100_000);
    for (let i = 0; i < 5; i++) scheduleHealthCheck(); // 連続した DOM 変化
    vi.advanceTimersByTime(THROTTLE_MS - 1);
    expect(getLocalHealth()!.checkedAt).toBe(100_000); // まだ 2 回目は走らない
    vi.advanceTimersByTime(2);
    expect(getLocalHealth()!.checkedAt).toBe(100_000 + THROTTLE_MS); // 10 秒後に 1 回だけ
    scheduleHealthCheck();
    vi.advanceTimersByTime(THROTTLE_MS + 1);
    expect(getLocalHealth()!.checkedAt).toBe(100_000 + 2 * THROTTLE_MS);
  });
});

describe('broken disables every PostShelf action and leaves X alone', () => {
  beforeEach(() => installGlobalHandlers());

  it('does not insert the button on broken pages, but does on ok / degraded pages', () => {
    document.body.innerHTML = BROKEN.replace('<div role="group"></div>', '<div role="group"><div><button data-testid="bookmark"></button></div></div>');
    runHealthCheck(); // userName 欠落 → broken
    expect(isBroken()).toBe(true);
    injectButtons();
    expect(document.querySelectorAll('[data-postshelf-btn], [data-postshelf-badge]').length).toBe(0);
    resetHealth();
    document.body.innerHTML = DEGRADED;
    runHealthCheck();
    expect(isBroken()).toBe(false);
    injectButtons();
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBe(1); // degraded でも動き続ける
  });

  it('replace mode does not intercept the native button when broken', async () => {
    document.body.innerHTML = BROKEN.replace('<div role="group"></div>', '<div role="group"><div><button data-testid="bookmark"></button></div></div>');
    runHealthCheck();
    applyButtonMode('replace');
    const x = vi.fn();
    document.querySelector('[data-testid=bookmark]')!.addEventListener('click', x);
    (document.querySelector('[data-testid=bookmark]') as HTMLElement).click();
    await tick();
    expect(x).toHaveBeenCalledTimes(1); // X 標準のまま
    expect(document.querySelector('.postshelf-popover')).toBeNull();
  });

  it('sync mode does not click the native button when broken', () => {
    document.body.innerHTML = BROKEN.replace('<div role="group"></div>', '<div role="group"><div><button data-testid="bookmark"></button></div></div>');
    runHealthCheck();
    const x = vi.fn();
    document.querySelector('[data-testid=bookmark]')!.addEventListener('click', x);
    expect(setNativeBookmark(document.querySelector('article')!, true)).toBe(false);
    expect(x).not.toHaveBeenCalled();
  });

  it('existing buttons are removed when the page turns broken, and come back when it recovers', () => {
    document.body.innerHTML = NORMAL;
    runHealthCheck();
    injectButtons();
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBe(1);
    document.body.innerHTML = BROKEN;
    runHealthCheck();
    applyButtonMode('separate');
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBe(0);
    document.body.innerHTML = NORMAL;
    runHealthCheck();
    applyButtonMode('separate');
    expect(document.querySelectorAll('[data-postshelf-btn]').length).toBe(1);
  });
});

describe('v9-C: no posts on the bookmarks page', () => {
  afterEach(() => history.pushState({}, '', '/'));

  it('inspect: 0 posts on /i/history is degraded (emptyBookmarks); other pages stay "no judgement"', () => {
    document.body.innerHTML = '<main></main>';
    expect(inspect(document, '/i/history')).toMatchObject({ state: 'degraded', emptyBookmarks: true, fallback: ['bookmarkPosts'] });
    expect(inspect(document, '/i/history/')).toMatchObject({ state: 'degraded' });
    expect(inspect(document, '/i/history/likes')).toBeNull();
    expect(inspect(document, '/home')).toBeNull();
  });

  it('runHealthCheck waits for the grace period (loading) before reporting degraded, then recovers when posts appear', async () => {
    history.pushState({}, '', '/i/history');
    document.body.innerHTML = '<main></main>';
    vi.useFakeTimers();
    expect(runHealthCheck(document, 1_000)).toBeNull(); // 読み込み中かもしれない
    expect(getLocalHealth()).toBeNull();
    vi.setSystemTime(1_000 + EMPTY_GRACE_MS);
    const h = runHealthCheck(document, 1_000 + EMPTY_GRACE_MS)!;
    expect(h).toMatchObject({ state: 'degraded', fallback: ['bookmarkPosts'], path: '/i/history' });
    document.body.innerHTML = NORMAL;
    expect(runHealthCheck(document, 2_000 + EMPTY_GRACE_MS)!.state).toBe('ok');
  });

  it('the empty timer is reset when the user leaves the page', () => {
    history.pushState({}, '', '/i/history');
    document.body.innerHTML = '<main></main>';
    runHealthCheck(document, 1_000);
    history.pushState({}, '', '/home');
    runHealthCheck(document, 5_000); // 判定なし → 計測をやり直す
    history.pushState({}, '', '/i/history');
    expect(runHealthCheck(document, 1_000 + EMPTY_GRACE_MS)).toBeNull(); // 5_000 から数え直し
  });
});

describe('v9-C: the diagnostics path never contains user names or ids', () => {
  it('keeps known screen names and masks everything else', () => {
    expect(safePath('/i/history')).toBe('/i/history');
    expect(safePath('/i/history/likes')).toBe('/i/history/likes');
    expect(safePath('/')).toBe('/');
    expect(safePath('/someone/status/123456')).toBe('/?/status/?');
    expect(safePath('/search')).toBe('/search');
    expect(safePath('/tabunugoku_dev')).toBe('/?');
  });
  it('the report includes the path line', () => {
    const r = buildReport({ version: '1', userAgent: 'ua', uiLanguage: 'ja', health: null, path: '/i/history', skeleton: null });
    expect(r).toContain('path: /i/history');
    const fromHealth = buildReport({ version: '1', userAgent: 'ua', uiLanguage: 'ja', health: { state: 'degraded', checkedAt: 0, missing: [], fallback: [], path: '/i/history' }, skeleton: null });
    expect(fromHealth).toContain('path: /i/history');
  });
});
