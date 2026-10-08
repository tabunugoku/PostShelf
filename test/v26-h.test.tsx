import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { AutoCollector, type CollectDeps, type SeqEntry } from '../src/content/autocollect';
import { ImageViewer } from '../src/manager/Viewer';
import { App } from '../src/manager/App';
import { refreshCacheView } from '../src/manager/cacheView';
import { requestFullTextBatch } from '../src/shared/cacheRequest';
import { createFolder, addCollected, getSavedIds, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import type { CollectRun } from '../src/shared/settings';
import type { Extracted } from '../src/content/snapshot';

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];

const post = (n: number, truncated: boolean): Extracted => ({
  tweetId: `p${n}`,
  snapshot: { text: `post ${n}`, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${n}`, ...(truncated ? { truncated: true } : {}) },
});

function deps(total: number, failFrom = Infinity, store: { run: CollectRun | null } = { run: null }) {
  let start = 0;
  let adds = 0;
  const d: CollectDeps = {
    now: () => Date.now(),
    sleep: async () => void (await tick()),
    random: () => 0,
    scrollBy: () => void (start = Math.min(start + 5, total)),
    scrollToTop: () => void (start = 0),
    scrollY: () => start * 100,
    viewportHeight: () => 1000,
    visible: () => Array.from({ length: Math.max(0, Math.min(6, total - start)) }, (_, i) => post(start + i + 1, (start + i + 1) % 2 === 0)),
    isLoading: () => false,
    hasLimit: () => false,
    pageOk: () => true,
    isHidden: () => false,
    accountId: () => 'me',
    savedIds: (id) => getSavedIds(id),
    loadRun: async () => store.run,
    addCollected: async (seq: SeqEntry[], startedAt, id) => {
      if (++adds >= failFrom) throw new Error('write failed');
      return addCollected(seq, startedAt, id);
    },
    saveRun: async (r) => void (store.run = structuredClone(r)),
    clearRun: async () => void (store.run = null),
  };
  return d;
}

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

describe('v26-H: full-text requests only for posts that were really saved', () => {
  it('truncated posts of a save that failed are not requested', async () => {
    const c = new AutoCollector(deps(60, 2)); // 2 回目以降の保存は失敗する
    await c.start({ consent: true, speed: 'slow', cap: 0, accountId: 'me' });
    for (let i = 0; i < 2000 && c.state?.status !== 'done'; i++) await tick();
    const saved = await getSavedIds('me');
    const { ids } = c.takeTruncated();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(saved.has(id)).toBe(true);
    expect(c.state!.failed).toBeGreaterThan(0);
  });

  it('after a reload (adopt), the end of the import asks for a scan of the stored truncated posts', async () => {
    const store = { run: { status: 'paused', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: 0, updatedAt: 1, owner: 'old' } as CollectRun };
    const c = new AutoCollector(deps(30, Infinity, store));
    c.adopt(store.run);
    await c.resume();
    for (let i = 0; i < 2000 && c.state?.status !== 'done'; i++) await tick();
    const r = c.takeTruncated();
    expect(r.scan).toBe(true);
    // 最初から始めた取り込みは、scan しない
    const fresh = new AutoCollector(deps(10));
    await fresh.start({ consent: true, speed: 'slow', cap: 0, accountId: 'me' });
    for (let i = 0; i < 2000 && fresh.state?.status !== 'done'; i++) await tick();
    expect(fresh.takeTruncated().scan).toBe(false);
  });

  it('requestFullTextBatch sends scan: true even without ids', () => {
    const sent: unknown[] = [];
    (globalThis as any).chrome.runtime = { sendMessage: (m: unknown) => (sent.push(m), Promise.resolve()), getURL: (p: string) => p };
    requestFullTextBatch('me', [], true);
    requestFullTextBatch('me', []);
    expect(sent).toEqual([{ type: 'fetchFullText', accountId: 'me', ids: [], kind: 'auto', scan: true }]);
  });
});

describe('v26-H: the image viewer', () => {
  const props = { tweetId: '1', postUrl: 'https://x.com/a/status/1', onIndex: () => {}, onClose: () => {} };
  it('draws nothing when there are no images (no crash)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<ImageViewer {...props} urls={[]} index={-1} />, $('#app')));
    expect($$('.viewer').length).toBe(0);
  });

  it('switching images starts from a clean state on the very first render (no stale failure)', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const urls = ['https://pbs.twimg.com/media/A?format=jpg&name=small', 'https://pbs.twimg.com/media/B?format=jpg&name=small'];
    await refreshCacheView();
    await act(() => void render(<ImageViewer {...props} urls={urls} index={0} />, $('#app')));
    await flush();
    for (let i = 0; i < 2; i++) {
      await act(() => void $('.viewer-img img').dispatchEvent(new Event('error'))); // orig → large → 失敗
      await flush();
    }
    expect($$('.viewer [role=alert]').length).toBe(1);
    // 切り替え: 描画の直後 (effect を待たない) から失敗の表示が無い
    let seenStale = false;
    const obs = new MutationObserver(() => void (seenStale ||= $$('.viewer [role=alert]').length > 0));
    obs.observe(document.body, { childList: true, subtree: true });
    await act(() => void render(<ImageViewer {...props} urls={urls} index={1} />, $('#app')));
    obs.disconnect();
    expect(seenStale).toBe(false);
    expect($$('.viewer [role=alert]').length).toBe(0);
    expect($('.viewer-count').textContent).toBe('2 / 2');
  });

  it('a post with no media cannot open the viewer from the manager', async () => {
    await noteAccount({ handle: 'me' });
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App />, $('#app')));
    await flush(40);
    expect($$('.viewer').length).toBe(0);
  });
});

describe('v26-H / v28-C: the popup 未分類 count matches the manager menu', () => {
  it('counts 「未分類」 with the same function as the left menu', async () => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
    await noteAccount({ handle: 'me' }, 1);
    setAccountScope('me');
    await createFolder({ name: 'F' });
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' }); // 未分類が保存される
    vi.resetModules();
    await act(async () => void (await import('../src/popup/index')));
    await flush(40);
    const tiles = $$('.tiles .tile').map((t) => [t.querySelector('b')!.textContent, t.querySelector('span')!.textContent]);
    expect(tiles).toEqual([['1', 'ポスト'], ['1', '未分類を仕分ける']]);
    // 管理画面の左のメニューの、ユーザーのフォルダの数
    document.body.innerHTML = '<div id="app"></div>';
    installPanelMock();
    await act(() => void render(<App />, $('#app')));
    await flush(40);
    expect($$('.fr').filter((r) => r.textContent?.includes('F')).length).toBe(1);
    expect($$('.fr').find((r) => r.textContent?.includes('未分類'))!.querySelector('.badge')!.textContent).toBe('1');
  });
});
