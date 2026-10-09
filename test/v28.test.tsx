import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons } from '../src/content/buttons';
import { openPopover } from '../src/content/popover';
import { createFolderPicker, FILTER_MIN_FOLDERS, RECENT_MIN_FOLDERS } from '../src/shared/folderPicker';
import { AutoCollectPanel, resetCollapsed } from '../src/content/autocollectPanel';
import type { AutoCollector, CollectState } from '../src/content/autocollect';
import { App } from '../src/manager/App';
import { createFolder, getBookmark, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { RECENT_FOLDERS, getSettings, pushRecentFolders, updateSettings } from '../src/shared/settings';
import { INBOX_ID } from '../src/shared/models';

const html = readFileSync('test/fixtures/tweet.html', 'utf8');
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };

async function folders(n: number) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await createFolder({ name: i === 1 ? 'Alpha' : i === 2 ? 'ＢＥＴＡ' : `F${i}` }));
  return out;
}
async function open() {
  injectButtons();
  return (await openPopover(document.querySelector('article')!, document.querySelector<HTMLElement>('[data-postshelf-btn]')!))!;
}
const rowNames = (pop: HTMLElement) => [...pop.querySelectorAll('label')].map((l) => l.textContent);

describe('v28-A: the x.com save popover', () => {
  beforeEach(() => {
    installChromeMock();
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    setAccountScope('me');
    document.body.innerHTML = html;
  });

  it('delete: no confirmation, removes the save and closes; side panel: sends the request and closes; both have aria-label and title', async () => {
    await folders(1);
    await setBookmarkFolders('1234567890', [INBOX_ID], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1234567890' });
    const calls: unknown[] = [];
    (chrome.runtime as any).sendMessage = (m: unknown) => void calls.push(m);
    let pop = await open();
    const side = pop.querySelector<HTMLButtonElement>('button[aria-label="サイドパネルで開く"]')!;
    const del = pop.querySelector<HTMLButtonElement>('button[aria-label="PostShelf の保存を削除"]')!;
    expect(side.title).toBe('サイドパネルで開く');
    expect(del.title).toBe('PostShelf の保存を削除');
    side.click();
    expect(calls).toEqual([{ type: 'openSidePanel' }]);
    expect($$('.postshelf-popover')).toHaveLength(0);
    pop = await open();
    pop.querySelector<HTMLButtonElement>('button[aria-label="PostShelf の保存を削除"]')!.click();
    await tick();
    expect(await getBookmark('1234567890')).toBeUndefined();
    expect($$('.postshelf-popover')).toHaveLength(0);
  });

  it(`filter: absent with ${FILTER_MIN_FOLDERS - 1} folders, present with ${FILTER_MIN_FOLDERS}; typing narrows (width / case insensitive)`, async () => {
    await folders(FILTER_MIN_FOLDERS - 1);
    let pop = await open();
    expect(pop.querySelector<HTMLElement>('input[type=text]')?.style.display ?? 'none').toBe('none'); // 出ない
    pop.remove();
    await createFolder({ name: 'Extra' });
    pop = await open();
    const input = pop.querySelector<HTMLInputElement>('input[type=text]')!;
    expect(input.getAttribute('aria-label')).toBe('フォルダを絞り込み');
    expect(input.placeholder).toBe('フォルダを絞り込み');
    expect(document.activeElement).toBe(input);
    const type = (v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    type('beta'); // 全角の「ＢＥＴＡ」に半角の小文字で当たる
    expect(rowNames(pop)).toEqual(['ＢＥＴＡ']);
    type('ALPHA');
    expect(rowNames(pop)).toEqual(['Alpha']);
    type('');
    expect(rowNames(pop)).toHaveLength(FILTER_MIN_FOLDERS + 1); // 未分類 + 8
    // ↓ で最初の行へ、↑ で絞り込み欄へ戻る
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const boxes = pop.querySelectorAll('label input');
    expect(document.activeElement).toBe(boxes[0]);
    boxes[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(boxes[1]);
    boxes[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    boxes[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
  });

  it(`recent: absent with ${RECENT_MIN_FOLDERS - 1} folders, present with ${RECENT_MIN_FOLDERS}; not repeated below; missing ids skipped`, async () => {
    const fs = await folders(RECENT_MIN_FOLDERS - 1);
    await updateSettings({ recentFolderIds: [fs[2].id] });
    let pop = await open();
    expect(pop.textContent).not.toContain('最近使った');
    pop.remove();
    await createFolder({ name: 'Six' });
    await updateSettings({ recentFolderIds: ['gone', fs[2].id, fs[0].id] });
    pop = await open();
    expect(pop.textContent).toContain('最近使った');
    expect(pop.textContent).toContain('すべてのフォルダ（6）');
    expect(rowNames(pop)).toEqual(['未分類', 'F3', 'Alpha', 'ＢＥＴＡ', 'F4', 'F5', 'Six']); // v31: 「未分類」は見出しの上
    // 「すべてのフォルダ（6）」の下の行数 (ユーザーのフォルダ 6 つのうち、最近使った 2 つを除く 4 つ) と、見出しの数 6 が合う: 2 + 4 = 6
    expect(rowNames(pop).length - 1).toBe(6);
  });

  it('recent is updated on save: newest first, at most 3, never 未分類; invalid stored values become empty', async () => {
    const fs = await folders(5);
    expect(pushRecentFolders(['a'], [INBOX_ID, 'all', 'b'])).toEqual(['b', 'a']);
    expect(RECENT_FOLDERS).toBe(3);
    const pop = await open();
    const boxes = () => [...pop.querySelectorAll<HTMLInputElement>('label input')];
    for (const i of [1, 2, 3, 4]) {
      const cb = boxes()[i];
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      await tick();
    }
    expect((await getSettings()).recentFolderIds).toEqual([fs[3].id, fs[2].id, fs[1].id]);
    // 未分類を選んでも入らない
    const inbox = boxes()[0];
    inbox.checked = true;
    inbox.dispatchEvent(new Event('change'));
    await tick();
    expect((await getSettings()).recentFolderIds).toEqual([fs[3].id, fs[2].id, fs[1].id]);
    await chrome.storage.local.set({ settings: { recentFolderIds: 'x' } });
    expect((await getSettings()).recentFolderIds).toEqual([]);
    await chrome.storage.local.set({ settings: { recentFolderIds: ['a', 'a', 3, 'b', 'c', 'd'] } });
    expect((await getSettings()).recentFolderIds).toEqual(['a', 'b', 'c']);
  });

  it('header: nothing when unsaved; 「未分類に保存済み」; 「N 個のフォルダに保存済み」 (未分類 not counted)', async () => {
    const fs = await folders(2);
    const pop = await open();
    const header = () => pop.firstElementChild!.nextElementSibling!.firstElementChild as HTMLElement; // 保存先の行のあとの、ピッカーの見出し
    expect(pop.textContent).not.toContain('保存済み');
    const boxes = () => [...pop.querySelectorAll<HTMLInputElement>('label input')];
    boxes()[0].checked = true;
    boxes()[0].dispatchEvent(new Event('change'));
    await tick();
    expect(pop.textContent).toContain('✓ 未分類に保存済み');
    for (const i of [1, 2]) {
      boxes()[i].checked = true;
      boxes()[i].dispatchEvent(new Event('change'));
      await tick();
    }
    expect(pop.textContent).toContain('✓ 2 個のフォルダに保存済み');
    expect(pop.textContent).not.toContain('未分類に保存済み');
    void header;
    void fs;
  });

  it('the manager picker (no extras) has no filter, headings or status', () => {
    const fs = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, icon: 'ti-folder', order: i }));
    const p = createFolderPicker({ folders: fs, selected: new Set(['f1']), theme, onChange: () => {} });
    document.body.append(p.el);
    expect(p.el.querySelector<HTMLElement>('input[type=text]')?.style.display ?? 'none').toBe('none');
    expect(p.el.textContent).not.toContain('最近使った');
    expect(p.el.textContent).not.toContain('保存済み');
    expect(p.focusFilter()).toBe(false);
  });
});

describe('v28-B: the collapsible auto-collect panel', () => {
  const stub = () => ({ pause: vi.fn(), resume: vi.fn(), resumeLater: vi.fn(), stop: vi.fn(), dismiss: vi.fn() }) as unknown as AutoCollector;
  const st = (over: Partial<CollectState> = {}): CollectState => ({ status: 'running', accountId: 'me', startedAt: 1, imported: 5, skipped: 2, failed: 1, speed: 'slow', cap: 300, updatedAt: 1, ...over });
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = '';
    history.replaceState(null, '', '/i/history');
    resetCollapsed();
  });

  it('running: collapse → a one-line bar (status role, 44px buttons, same numbers); the collector is untouched; expand restores', () => {
    const c = stub();
    const p = new AutoCollectPanel(c, () => {});
    p.update(st());
    $<HTMLElement>('[data-action=collapse]').click();
    const bar = $('.postshelf-autocollect-panel');
    expect(bar.getAttribute('role')).toBe('status');
    expect(bar.getAttribute('aria-live')).toBe('polite');
    expect(bar.textContent).toContain('取り込み中 · 5 件 · 失敗 1');
    expect($$('.postshelf-autocollect-panel button').map((b) => b.textContent)).toEqual(['開く']);
    expect($<HTMLElement>('[data-action=expand]').style.minHeight).toBe('44px');
    expect(document.documentElement.hasAttribute('data-postshelf-panel')).toBe(true);
    p.update(st({ imported: 9 })); // 取り込みが進んでも、畳んだまま
    expect(bar.textContent).toContain('取り込み 9');
    expect((c as any).pause).not.toHaveBeenCalled();
    expect((c as any).stop).not.toHaveBeenCalled();
    $<HTMLElement>('[data-action=expand]').click();
    expect($('.postshelf-autocollect-panel').textContent).toContain('ブックマークを取り込み中');
  });

  it('paused can collapse too; limit / done / stopped / countdown open it again by themselves and show no collapse button', () => {
    const p = new AutoCollectPanel(stub(), () => {});
    p.update(st({ status: 'paused', reason: 'user' }));
    $<HTMLElement>('[data-action=collapse]').click();
    expect($$('[data-action=expand]')).toHaveLength(1);
    for (const status of ['limit', 'done', 'stopped', 'countdown'] as const) {
      resetCollapsed();
      p.update(st());
      $<HTMLElement>('[data-action=collapse]').click();
      p.update(st({ status }));
      expect($$('[data-action=expand]')).toHaveLength(0);
      expect($$('[data-action=collapse]')).toHaveLength(0);
    }
    p.update(st()); // 自動で開いた後は、畳んだ状態を覚えていない
    expect($$('[data-action=expand]')).toHaveLength(0);
  });
});

describe('v28-C: the toolbar popup entrances', () => {
  beforeEach(async () => {
    installChromeMock();
    installPanelMock();
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/');
    setAccountScope('unknown');
    await noteAccount({ handle: 'me' }, 1);
    setAccountScope('me');
  });

  it('#inbox opens 未分類 even if lastFolderId is another folder; the hash is removed', async () => {
    const f = await createFolder({ name: 'Other' });
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    await updateSettings({ lastFolderId: f.id });
    history.replaceState(null, '', '/#inbox');
    await act(() => void render(<App />, $('#app')));
    await flush(60);
    expect($('.fr.on').textContent).toContain('未分類');
    expect(location.hash).toBe('');
  });

  it('#q=… puts the search words in the box (decoded) and removes the hash; other hashes are left alone', async () => {
    history.replaceState(null, '', '/#q=' + encodeURIComponent('猫 cat'));
    await act(() => void render(<App />, $('#app')));
    await flush(60);
    expect($<HTMLInputElement>('input[type=search]').value).toBe('猫 cat');
    expect(location.hash).toBe('');
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/#settings');
    await act(() => void render(<App />, $('#app')));
    await flush(60);
    expect(location.hash).toBe('#settings');
  });

  it('popup: the 未分類 tile opens #inbox; Enter in the search box opens #q=…; diagnostics is not in the popup but is in the settings', async () => {
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    const create = vi.fn(async () => ({}));
    (globalThis as any).chrome.tabs = { create, query: async () => [] };
    vi.resetModules();
    await act(async () => void (await import('../src/popup/index')));
    await flush(40);
    expect($$('.tiles .tile').map((t) => t.textContent)).toEqual(['1ポスト', '1未分類を仕分ける']);
    expect(document.body.textContent).not.toContain('診断情報をコピー');
    await act(async () => void $<HTMLElement>('.tile-inbox').click());
    await flush();
    const input = $<HTMLInputElement>('.popup-search');
    expect(input.placeholder).toBe('保存したポストを検索');
    await act(async () => {
      input.value = 'a b';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush();
    const urls = create.mock.calls.map((c: any) => c[0]?.url as string);
    expect(urls[0]).toMatch(/manager\.html#inbox$/);
    expect(urls[1]).toMatch(/manager\.html#q=a%20b$/);
  });
});

describe('v28: new Japanese strings stay short (buttons ~10 chars, no wrap)', () => {
  const ja = JSON.parse(readFileSync('static/_locales/ja/messages.json', 'utf8')) as Record<string, { message: string }>;
  it.each(['popupInbox', 'popupSearch', 'acBtnCollapse', 'acBtnExpand', 'folderFilter', 'folderRecent', 'savedInInbox'])('%s ≤ 12 chars', (k) => {
    expect(ja[k].message.length).toBeLessThanOrEqual(12);
  });
  it.each(['folderAll', 'savedInFolders'])('%s ≤ 20 chars including the placeholder', (k) => {
    expect(ja[k].message.length).toBeLessThanOrEqual(20);
  });
});
