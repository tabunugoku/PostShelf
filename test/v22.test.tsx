import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { AutoCollector, type CollectDeps } from '../src/content/autocollect';
import { hasImage, matchesFilters } from '../src/shared/query';
import { RESULT_TTL_MS, clearCollectRun, getCollectRun, saveCollectRun, staleResult, type CollectRun } from '../src/shared/settings';
import { noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { mediaKindOf } from '../src/manager/Cards';
import type { Bookmark } from '../src/shared/models';

const bm = (over: object): Bookmark => ({ accountId: 'me', tweetId: '1', folderIds: ['inbox'], savedAt: 1, snapshot: { text: 't', author: 'A', handle: '@a', media: [], url: 'u', ...over } });

describe('v22-1: 「画像あり」', () => {
  it('a video post whose media holds the thumbnail is not an image post; image-only and unknown posts behave as before', () => {
    expect(hasImage(bm({ hasVideo: true, media: ['thumb.jpg'] }))).toBe(false);
    expect(hasImage(bm({ hasVideo: true, media: [] }))).toBe(false);
    expect(hasImage(bm({ hasVideo: false, media: ['a.jpg'] }))).toBe(true);
    expect(hasImage(bm({ media: ['a.jpg'] }))).toBe(true); // hasVideo 未定義 (v7 より前)
    expect(hasImage(bm({}))).toBe(false);
    expect(matchesFilters(bm({ hasVideo: true, media: ['thumb.jpg'] }), { image: true })).toBe(false);
    expect(matchesFilters(bm({ hasVideo: true, media: ['thumb.jpg'] }), { video: true })).toBe(true);
  });
  it('the v20 count badge stays off for video posts', () => {
    expect(mediaKindOf(bm({ hasVideo: true, media: ['a', 'b'] }).snapshot)).toEqual({ kind: 'video' });
  });
});

describe('v22-2: 結果の帯', () => {
  const run = (over: Partial<CollectRun> = {}): CollectRun => ({ status: 'done', accountId: 'me', startedAt: 1, imported: 5, skipped: 1, failed: 0, speed: 'slow', cap: 300, updatedAt: Date.now(), ...over });
  const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 25)));
  const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
  const $$ = <T extends Element>(s: string) => [...document.querySelectorAll<T>(s)];
  const click = async (el: Element) => {
    await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await flush();
  };
  const mount = async () => {
    await act(() => void render(<App />, $('#app')));
    await flush();
    await flush();
  };
  beforeEach(async () => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
    await noteAccount({ handle: 'me' }, 1);
    setAccountScope('me');
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'u' });
  });
  afterEach(() => render(null, $('#app')));

  it('closing a done band deletes the saved record; reopening the manager shows no band', async () => {
    await saveCollectRun(run());
    await mount();
    expect($$('.ac-progress')).toHaveLength(1);
    await click($$('.ac-progress .ac-row button').at(-1)!);
    expect($$('.ac-progress')).toHaveLength(0);
    expect(await getCollectRun()).toBeNull();
    await act(() => void render(null, $('#app')));
    await mount();
    expect($$('.ac-progress')).toHaveLength(0);
  });

  it('closing a stopped band deletes the record too', async () => {
    await saveCollectRun(run({ status: 'stopped', reason: 'user' }));
    await mount();
    await click($$('.ac-progress .ac-row button').at(-1)!);
    expect(await getCollectRun()).toBeNull();
  });

  it('in-progress states have no close button, keep their record, and still show after reopening', async () => {
    for (const status of ['running', 'paused', 'limit'] as const) {
      await saveCollectRun(run({ status }));
      await mount();
      expect($$('.ac-progress')).toHaveLength(1);
      expect($$('.ac-progress button').map((b) => b.textContent)).not.toContain('閉じる');
      expect(await getCollectRun()).not.toBeNull();
      await act(() => void render(null, $('#app')));
    }
  });

  it('a done / stopped record older than 24 hours is not shown (in-progress ones always are)', async () => {
    const old = Date.now() - RESULT_TTL_MS - 1000;
    expect(staleResult(run({ updatedAt: old }))).toBe(true);
    expect(staleResult(run({ status: 'stopped', updatedAt: old }))).toBe(true);
    expect(staleResult(run({ status: 'paused', updatedAt: old }))).toBe(false);
    expect(staleResult(run())).toBe(false);
    await saveCollectRun(run({ updatedAt: old }));
    await mount();
    expect($$('.ac-progress')).toHaveLength(0);
  });

  it('the band disappears when the record is removed elsewhere (the x.com panel closed it)', async () => {
    await saveCollectRun(run());
    await mount();
    expect($$('.ac-progress')).toHaveLength(1);
    await act(async () => void (await clearCollectRun()));
    await flush();
    expect($$('.ac-progress')).toHaveLength(0);
  });
});

describe('v22-2: the x.com panel', () => {
  const deps = (cleared: { n: number }): CollectDeps => ({
    now: () => Date.now(), sleep: async () => {}, random: () => 0, scrollBy() {}, scrollToTop() {}, scrollY: () => 0, viewportHeight: () => 1000,
    visible: () => [], isLoading: () => false, hasLimit: () => false, pageOk: () => true, isHidden: () => false, accountId: () => 'me',
    savedIds: async () => new Set(), addCollected: async () => 0, saveRun: async () => {}, clearRun: async () => void cleared.n++,
  });
  const done = { status: 'done' as const, accountId: 'me', startedAt: 1, imported: 1, skipped: 0, failed: 0, speed: 'slow' as const, cap: 300 as const, updatedAt: 1 };

  it('dismiss() on a finished state clears the saved record; on an in-progress state it does nothing', () => {
    installChromeMock();
    const cleared = { n: 0 };
    const c = new AutoCollector(deps(cleared));
    c.state = { ...done };
    c.dismiss();
    expect(c.state).toBeNull();
    expect(cleared.n).toBe(1);
    c.state = { ...done, status: 'paused' };
    c.dismiss();
    expect(c.state).not.toBeNull();
    expect(cleared.n).toBe(1);
  });

  it('when the record is removed (closed in the manager), a finished panel closes; an in-progress one stays', () => {
    installChromeMock();
    const c = new AutoCollector(deps({ n: 0 }));
    const seen = vi.fn();
    c.subscribe(seen);
    c.state = { ...done };
    c.onRunChanged(null);
    expect(c.state).toBeNull();
    c.state = { ...done, status: 'paused' };
    c.onRunChanged(null);
    expect(c.state).not.toBeNull();
  });
});
