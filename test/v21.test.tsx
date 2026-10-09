import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const css = readFileSync('static/popup.css', 'utf8');
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number, text = `post ${n}`) => ({ text, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });

async function open(withSide = false, account: string | null = 'me') {
  installChromeMock();
  if (withSide) installPanelMock().behavior; // chrome.sidePanel あり
  document.body.innerHTML = '<div id="app"></div>';
  if (account) await noteAccount({ handle: account }, 1);
  setAccountScope(account ?? 'unknown');
  const f = await createFolder({ name: 'F' });
  await createFolder({ name: 'G' });
  for (let i = 1; i <= 4; i++) await setBookmarkFolders(String(i), [f.id], snap(i, i === 4 ? 'とても長い本文'.repeat(20) : undefined));
  const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
  Object.values(data).forEach((b: any) => (b.savedAt = Number(b.tweetId)));
  await chrome.storage.local.set({ bookmarks: data });
  vi.resetModules();
  await act(async () => void (await import('../src/popup/index')));
  await flush();
}

beforeEach(() => vi.resetModules());

describe('v21: ツールバーのポップアップ', () => {
  it('header: the account is a small chip on the right (ellipsis); the old 「アカウント: …」 line is gone', async () => {
    await open();
    const chip = $('.hd .acct-chip');
    expect(chip.textContent?.trim()).toBe('@me');
    expect(chip.getAttribute('title')).toBe('@me');
    expect(css).toMatch(/\.acct-chip\{[^}]*margin-left:auto[^}]*text-overflow:ellipsis/);
    expect(css).toMatch(/\.acct-chip\{[^}]*overflow:hidden/);
    expect(document.body.textContent).not.toContain('アカウント: ');
  });

  it('header: shows 「アカウント未設定」 in the same chip when the account is unknown', async () => {
    await open(false, null);
    expect($('.hd .acct-chip').textContent?.trim()).toBe('アカウント未設定');
  });

  it('counts: two tiles (posts / 未分類 — quiet and not a button when 0)', async () => {
    await open();
    const tiles = $$('.tiles .tile');
    expect(tiles.map((t) => [t.querySelector('b')!.textContent, t.querySelector('span')!.textContent])).toEqual([['4', 'ポスト'], ['0', '未分類']]);
    expect(document.body.textContent).not.toContain('·');
    expect($('.tiles .tile-quiet').tagName).toBe('DIV');
  });

  it('recent: at most 3, newest first; the handle and the text are separate elements; title holds the whole text', async () => {
    await open();
    const rows = $$('.rec-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector('.rec-handle')!.textContent)).toEqual(['@u4', '@u3', '@u2']);
    expect(rows[0].getAttribute('title')).toBe('とても長い本文'.repeat(20));
    expect(rows[1].textContent).toContain('post 3');
    expect(css).toMatch(/\.rec-row\{[^}]*text-overflow:ellipsis/);
    expect(css).toMatch(/\.rec-handle\{color:var\(--text-secondary\)/);
    expect($('.rec-head').textContent).toBe('最近保存した 3 件');
  });

  it('buttons: 「管理画面を開く」 is the filled main one; 「サイドパネルで開く」 only with the side panel; settings is the only small one, in the Tab order main → side → settings', async () => {
    await open(true);
    const order = $$('#app button').map((b) => b.textContent?.trim());
    expect(order).toEqual(['管理画面を開く', 'サイドパネルで開く', '設定']);
    expect($('.main-btn').textContent).toContain('管理画面を開く');
    expect($('.sub-btn').textContent).toContain('サイドパネルで開く');
    expect($$('.foot-row .pr.small')).toHaveLength(1);
    expect(css).toMatch(/\.main-btn\{background:var\(--accent-strong\)/);
    expect(css).toMatch(/width:320px/);
  });

  it('buttons: no 「サイドパネルで開く」 without chrome.sidePanel', async () => {
    await open(false);
    expect($$('.sub-btn')).toHaveLength(0);
    expect($$('#app button').map((b) => b.textContent?.trim())).toEqual(['管理画面を開く', '設定']);
  });

  it('buttons keep their actions: open manager (with the #settings hash)', async () => {
    await open(true);
    const create = vi.fn(async () => ({}));
    (globalThis as any).chrome.tabs = { create, query: async () => [] };
    await act(async () => void $<HTMLElement>('.main-btn').click());
    await flush();
    await act(async () => void $$<HTMLElement>('.foot-row .pr')[0].click());
    await flush();
    const urls = create.mock.calls.map((c: any) => c[0]?.url as string);
    expect(urls[0]).toMatch(/manager\.html$/);
    expect(urls[1]).toMatch(/manager\.html#settings$/);
  });
});
