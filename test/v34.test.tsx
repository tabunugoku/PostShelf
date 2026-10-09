import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/shared/strings', async (orig) => {
  const m = await orig<typeof import('../src/shared/strings')>();
  return { ...m, formatDate: (iso: string) => (renders.n++, m.formatDate(iso)) }; // 「ポスト表示」のカードは、描画のたびに 1 回呼ぶ
});

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number) => ({ text: `post ${n}`, author: `A${n}`, handle: `@u${n}`, media: [], createdAt: '2026-01-01T00:00:00.000Z', url: `https://x.com/u${n}/status/${n}` });

async function seed(n: number) {
  const data: Record<string, any> = {};
  for (let i = 1; i <= n; i++) data[`me:${i}`] = { accountId: 'me', tweetId: String(i), folderIds: [], savedAt: i, snapshot: snap(i) };
  await chrome.storage.local.set({ bookmarks: data });
}
async function mountApp(surface: 'tab' | 'sidepanel' = 'tab') {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush(80);
}

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  renders.n = 0;
});

describe('v34-A: Card memo', () => {
  it('selecting a second post re-renders only that card, not all of them', async () => {
    await seed(25);
    await mountApp();
    const cards = $$('[data-row]');
    expect(cards.length).toBeGreaterThanOrEqual(25);
    await act(() => void cards[0].querySelector<HTMLInputElement>('input.sel')!.click());
    await flush(40); // 最初の選択: selectionActive が変わり、全カードが描き直される
    renders.n = 0;
    await act(() => void $$('[data-row]')[1].querySelector<HTMLInputElement>('input.sel')!.click());
    await flush(40);
    expect(renders.n).toBeGreaterThan(0);
    expect(renders.n).toBeLessThanOrEqual(3); // 全件 (25) ではなく、選択が変わった 1 件 (と、フォーカスで変わる分)
  });
});
