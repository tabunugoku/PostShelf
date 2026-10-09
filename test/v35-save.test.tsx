import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { createFolder, getBookmark, noteAccount, setAccountScope } from '../src/shared/storage';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (id: string) => ({ text: `post ${id}`, author: `A${id}`, handle: '@u', media: [], url: `https://x.com/u/status/${id}` });

beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  vi.restoreAllMocks();
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
});

describe('v35-D: the side panel save state is per post', () => {
  /** アクティブタブのポストを切り替えられる模擬。ネイティブの同期 (保存の最後の手順) は遅くする */
  function tabs(slowMs: number) {
    const state = { id: '1111' };
    const listeners: (() => void)[] = [];
    (globalThis as any).chrome.tabs = {
      query: async () => [{ id: 5, url: `https://x.com/u/status/${state.id}` }],
      sendMessage: vi.fn(async (_id: number, m: any) => {
        if (m.type === 'getPostSnapshot') return { ok: true, tweetId: m.tweetId, snapshot: snap(m.tweetId) };
        await tick(slowMs);
        return { ok: true };
      }),
      onActivated: { addListener: (f: () => void) => listeners.push(f), removeListener() {} },
      onUpdated: { addListener: (f: () => void) => listeners.push(f), removeListener() {} },
      create: async () => ({}),
    };
    return {
      go: async (id: string) => {
        state.id = id;
        await act(() => void listeners.forEach((f) => f()));
        await flush(60);
      },
    };
  }
  const mount = async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="sidepanel" />, $('#app')));
    for (let i = 0; i < 3; i++) await flush(60);
  };

  it('switching to another (unsaved) post while saving: the first post keeps its folder and the second post is not written', async () => {
    const dev = await createFolder({ name: 'Dev' });
    const t = tabs(150);
    await mount();
    await act(() => void $$('.ap-chip')[0].click()); // 1111 を Dev へ (保存の最後の手順は遅い)
    await flush(20);
    await t.go('2222');
    await flush(400);
    expect((await getBookmark('1111'))!.folderIds).toEqual([dev.id]);
    expect(await getBookmark('2222')).toBeUndefined();
    expect($$('.ap-chip')[0].getAttribute('aria-pressed')).toBe('false'); // いま表示している 2222 は未保存のまま
  });

  it('two chips pressed quickly still end up in the last state', async () => {
    const dev = await createFolder({ name: 'Dev' });
    const fun = await createFolder({ name: 'Fun' });
    tabs(60);
    await mount();
    await act(() => {
      $$('.ap-chip')[0].click();
      $$('.ap-chip')[1].click();
    });
    await flush(300);
    expect((await getBookmark('1111'))!.folderIds.sort()).toEqual([dev.id, fun.id].sort());
  });
});
