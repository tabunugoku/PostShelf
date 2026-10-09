import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons } from '../src/content/buttons';
import { openPopover } from '../src/content/popover';
import { App } from '../src/manager/App';
import { SettingsPage } from '../src/manager/Settings';
import { createFolder, getBookmark, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { getSettings, updateRecentFolders, updateSettings } from '../src/shared/settings';
import { queryBookmarks } from '../src/shared/query';
import { foldText } from '../src/shared/fold';
import { highlightRanges, searchTerms } from '../src/shared/highlight';
import type { Bookmark } from '../src/shared/models';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number, text = `post ${n}`) => ({ text, author: `A${n}`, handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });
const tweetHtml = readFileSync('test/fixtures/tweet.html', 'utf8');

async function seed(inbox: number, folderNames: string[] = ['Dev', 'Fun']) {
  const fs = [];
  for (const name of folderNames) fs.push(await createFolder({ name }));
  for (let i = 1; i <= inbox; i++) await setBookmarkFolders(String(i), [], snap(i));
  const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
  Object.values(data).forEach((b: any) => (b.savedAt = Number(b.tweetId)));
  await chrome.storage.local.set({ bookmarks: data });
  return fs;
}
async function mountApp(surface: 'tab' | 'sidepanel' = 'tab') {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush(60);
}
const triageKey = async (code: string, init: KeyboardEventInit = {}) => {
  await act(() => void $('[role=dialog].triage').dispatchEvent(new KeyboardEvent('keydown', { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init })));
  await flush();
};

beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
});

describe('v31-1/11/12: triage mode', () => {
  const start = async () => {
    await updateSettings({ lastFolderId: 'inbox' });
    await mountApp();
    await act(() => void $('.triage-start').click());
    await flush();
  };
  it('a repeated keydown (key held down) does nothing; a second digit while choose is running is ignored', async () => {
    const [dev] = await seed(3);
    await start();
    await triageKey('Digit1', { key: '1', repeat: true });
    expect((await getBookmark('3'))!.folderIds).toEqual(['inbox']);
    // 同じ tick で 2 回: 1 回目の保存の await のあいだの 2 回目は、受けない
    await act(async () => {
      const d = $('[role=dialog].triage');
      d.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true, cancelable: true }));
      d.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true, cancelable: true }));
    });
    await flush();
    expect((await getBookmark('3'))!.folderIds).toEqual([dev.id]);
    expect((await getBookmark('2'))!.folderIds).toEqual(['inbox']);
    expect($('.triage-progress').textContent).toBe('2 / 3');
    await triageKey('ArrowRight', { repeat: true });
    expect($('.triage-progress').textContent).toBe('2 / 3');
  });

  it('starting reads the stored data again: a post saved right before is in the queue (stale state); a failed read does not start', async () => {
    await seed(2);
    // 別タブの保存の通知が届かない状態をつくる
    (chrome.storage.onChanged as any).addListener = () => {};
    await updateSettings({ lastFolderId: 'inbox' });
    await mountApp();
    await setBookmarkFolders('9', [], snap(9)); // 画面は知らない
    await act(() => void $('.triage-start').click());
    await flush(60);
    expect($('.triage-progress').textContent).toBe('1 / 3');
    await triageKey('Escape');
    // 読み込みの失敗
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    (chrome.storage.local as any).get = async (k: any) => {
      if (k === 'bookmarks' || (Array.isArray(k) && k.includes('bookmarks'))) throw new Error('boom');
      return get(k);
    };
    await act(() => void $('.triage-start').click());
    await flush(60);
    expect($$('[role=dialog].triage')).toHaveLength(0);
  });

  it('a re-render with the same bookmarks passes the same live Set (the effect in Triage does not re-run)', async () => {
    await seed(3);
    await start();
    const has = vi.spyOn(Set.prototype, 'has');
    const input = $<HTMLInputElement>('.top input[type=search]');
    await act(() => {
      input.value = 'x';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    await act(() => {
      input.value = 'xy';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    // 仕分けモードに渡した live の Set (3 件) への問い合わせが、再描画で増えない
    expect(has.mock.contexts.filter((c) => (c as Set<string>).size === 3)).toHaveLength(0);
  });
});

describe('v31-2/3/4: side panel chips', () => {
  const tab = (slow = 0, fail = { on: false }) => {
    const sent: any[] = [];
    (globalThis as any).chrome.tabs = {
      query: async () => [{ id: 5, url: 'https://x.com/yamada/status/1234567890' }],
      sendMessage: vi.fn(async (_id: number, m: any) => {
        sent.push(m);
        if (m.type === 'getPostSnapshot') return { ok: true, tweetId: '1234567890', snapshot: snap(1) };
        if (slow) await tick(slow);
        return { ok: true };
      }),
      onActivated: { addListener() {}, removeListener() {} },
      onUpdated: { addListener() {}, removeListener() {} },
      create: async () => ({}),
    };
    void fail;
    return sent;
  };
  const mount = async () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    await mountApp('sidepanel');
    await flush(60); // アクティブタブの問い合わせ → スナップショット → 描画 (act は段階ごとに分ける)
    await flush(60);
    await flush(60);
  };

  it('two chips pressed in a row (before the first save ends): both are saved and shown; recentFolderIds has both', async () => {
    const [dev, fun] = await seed(0);
    tab(60);
    await mount();
    const chips = $$('.ap-chip');
    await act(() => {
      chips[0].click();
      chips[1].click();
    });
    await flush(300);
    expect((await getBookmark('1234567890'))!.folderIds.sort()).toEqual([dev.id, fun.id].sort());
    expect($$('.ap-chip').map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    expect((await getSettings()).recentFolderIds!.slice().sort()).toEqual([dev.id, fun.id].sort());
  });

  it('a failed save puts the chips back and shows the error', async () => {
    await seed(0);
    tab();
    await mount();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    (chrome.storage.local as any).set = async (o: any) => {
      if ('bookmarks' in o) throw new Error('boom');
      return set(o);
    };
    await act(() => void $('.ap-chip').click());
    await flush(100);
    expect($('.ap-chip').getAttribute('aria-pressed')).toBe('false');
    expect($('.active-post [role=alert]').textContent).toContain('保存または読み込みに失敗しました');
  });

  it('the names are joined by Intl.ListFormat (ja: 、 / en: ", ")', async () => {
    const [dev] = await seed(0, ['Dev', 'Fun']);
    void dev;
    tab();
    await mount();
    await act(() => {
      $$('.ap-chip')[0].click();
      $$('.ap-chip')[1].click();
    });
    await flush(100);
    expect($('.active-post [role=status]').textContent).toContain('保存しました（Dev、Fun）');
    (chrome.i18n as any).getUILanguage = () => 'en';
    await act(() => {
      $$('.ap-chip')[0].click();
    });
    await flush(100);
    await act(() => {
      $$('.ap-chip')[0].click();
    });
    await flush(100);
    expect($('.active-post [role=status]').textContent).toContain('Dev, Fun');
  });
});

describe('v31-4: 「最近使った」 on the x.com popover', () => {
  beforeEach(() => {
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = tweetHtml;
  });
  it('even when reading settings fails, the work after a successful save (cache request) runs and no error is shown', async () => {
    await createFolder({ name: 'A' });
    const sent: any[] = [];
    (chrome.runtime as any).sendMessage = (m: unknown) => void sent.push(m);
    injectButtons();
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector<HTMLElement>('[data-postshelf-btn]')!))!;
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    (chrome.storage.local as any).get = async (k: any) => {
      if (k === 'settings') throw new Error('boom');
      return get(k);
    };
    const cb = pop.querySelector<HTMLInputElement>('label input')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await tick(50);
    expect(await getBookmark('1234567890')).toBeTruthy();
    expect(sent.some((m) => m.type === 'cacheImages')).toBe(true);
    expect(pop.querySelector<HTMLElement>('.postshelf-save-error')!.style.display).toBe('none');
  });
  it('updateRecentFolders reads and writes in one serialized step: two calls in a row keep both', async () => {
    await Promise.all([updateRecentFolders(['a']), updateRecentFolders(['b']), updateSettings({ syncNative: true })]);
    const s = await getSettings();
    expect(s.recentFolderIds).toEqual(['b', 'a']);
    expect(s.syncNative).toBe(true);
  });
});

describe('v31-5: search normalization', () => {
  it('half-width kana with a voiced mark, decomposed kana, width and case all match', () => {
    expect(foldText('ｶﾞｲﾄﾞ')).toBe('ガイド');
    expect(foldText('ガイド')).toBe('ガイド');
    expect(foldText('が')).toBe('が');
    expect(foldText('ＡＢＣ１２３')).toBe('abc123');
    const b = (text: string) => ({ tweetId: text, folderIds: ['inbox'], savedAt: 1, accountId: 'me', snapshot: snap(1, text) }) as Bookmark;
    const all = [b('これはｶﾞｲﾄﾞです'), b('ガイドブック'), b('がめん'), b('other')];
    const hit = (q: string) => queryBookmarks(all, { folderId: 'all', search: q, sort: 'savedDesc' }).map((x) => x.tweetId);
    expect(hit('ガイド')).toEqual(['これはｶﾞｲﾄﾞです', 'ガイドブック']);
    expect(hit('ｶﾞｲﾄﾞ')).toEqual(['これはｶﾞｲﾄﾞです', 'ガイドブック']);
    expect(hit('が')).toEqual(['がめん']);
  });
  it('highlight ranges go back to the positions in the original text', () => {
    expect(highlightRanges('これはｶﾞｲﾄﾞです', searchTerms('ガイド'))).toEqual([[3, 8]]);
    expect(highlightRanges('x が y', searchTerms('が'))).toEqual([[2, 4]]);
    expect(highlightRanges('ＡＢＣ abc', searchTerms('B'))).toEqual([[1, 2], [5, 6]]);
  });
  it('the same snapshot is normalized once; ASCII does not call normalize', () => {
    const norm = vi.spyOn(String.prototype, 'normalize');
    foldText('Hello World');
    expect(norm).not.toHaveBeenCalled();
    const all = [{ tweetId: 'a', folderIds: ['inbox'], savedAt: 1, accountId: 'me', snapshot: snap(1, 'テキストです') }] as Bookmark[];
    queryBookmarks(all, { folderId: 'all', search: 'キスト', sort: 'savedDesc' });
    const first = norm.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    queryBookmarks(all, { folderId: 'all', search: 'キスト', sort: 'savedDesc' });
    expect(norm.mock.calls.length - first).toBeLessThanOrEqual(3); // 検索語 (3 文字) の分だけ。ポストの本文は再計算しない
  });
});

describe('v31-6/7: settings page', () => {
  const mountSettings = async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} onAutoCollect={() => {}} />, $('#app')));
    await flush(60);
  };
  const type = async (v: string) => {
    const input = $<HTMLInputElement>('.settings-search input');
    await act(() => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
  };

  it('many DOM changes in a burst re-scan once; changes inside the result line do not re-scan', async () => {
    await mountSettings();
    await type('全文');
    const root = $('.settings-page');
    const spy = vi.spyOn(root, 'querySelectorAll');
    const scans = () => spy.mock.calls.filter((c) => c[0] === 'fieldset.setting-group').length;
    const target = $('.nav-chip');
    await act(() => {
      for (let i = 0; i < 30; i++) target.appendChild(document.createTextNode(String(i)));
    });
    await flush(200);
    expect(scans()).toBe(1);
    const before = scans();
    await act(() => void ($('.settings-match').textContent += '!'));
    await flush(200);
    expect(scans()).toBe(before);
  });

  it('「変更を保存しました」 appears after a successful change here (switch / radio), not for other tabs, not when saving fails', async () => {
    await mountSettings();
    const box = $('.settings-saved');
    await chrome.storage.local.set({ settings: { recentFolderIds: ['x'] } }); // 他のタブの書き込み
    await flush(100);
    expect(box.textContent).toBe('');
    const radio = $$<HTMLInputElement>('input[type=radio][name=actionMode]').find((r) => !r.checked)!;
    await act(() => void radio.click());
    await flush(100);
    expect(box.textContent).toBe('変更を保存しました');
    await flush(2100);
    expect(box.textContent).toBe('');
    // 保存の失敗
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    (chrome.storage.local as any).set = async (o: any) => {
      if ('settings' in o) throw new Error('boom');
      return set(o);
    };
    const sw = $$<HTMLInputElement>('input[role=switch]')[0];
    await act(() => void sw.click());
    await flush(100);
    expect(box.textContent).toBe('');
  });
});

describe('v31-13: popup dots', () => {
  it('a folder without a colour gets a filled grey dot; 未分類 gets a hollow one', async () => {
    const f = await createFolder({ name: 'Plain' });
    const g = await createFolder({ name: 'Red', color: '#E24B4A' });
    await setBookmarkFolders('1', [f.id], snap(1));
    await setBookmarkFolders('2', [g.id], snap(2));
    await setBookmarkFolders('3', [], snap(3));
    const data = { ...(await chrome.storage.local.get('bookmarks')), ...(await chrome.storage.local.get('folders')) };
    Object.values(data.bookmarks as Record<string, any>).forEach((b: any) => (b.savedAt = Number(b.tweetId)));
    const folders = data.folders as any[];
    for (const x of folders) if (x.id === f.id) delete x.color;
    await chrome.storage.local.set({ bookmarks: data.bookmarks, folders });
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await act(async () => void (await import('../src/popup/index')));
    await flush(60);
    const dots = $$('.rec-row').map((r) => r.querySelector('.rec-dot')!);
    // 新しい順: 3 (未分類), 2 (赤), 1 (色なし)
    expect(dots[0].classList.contains('hollow')).toBe(true);
    expect(dots[1].classList.contains('hollow')).toBe(false);
    expect(dots[1].getAttribute('style')).toContain('background');
    expect(dots[2].classList.contains('hollow')).toBe(false);
    expect(dots[2].getAttribute('style')).toBeNull();
  });
});
