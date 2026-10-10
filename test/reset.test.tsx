import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { initButtons } from '../src/content/buttons';
import { installGlobalHandlers } from '../src/content/popover';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { DEFAULT_SETTINGS, getImportHint, getSettings, recordPending, dismissImportHint, resetSettings, restoreSettings, updateSettings } from '../src/shared/settings';
import { addCollected, createFolder, getLastSeenAccount, listBookmarks, listFolders, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const snap = { text: 't', author: 'a', handle: '@a', media: [], url: 'u' };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const btn = (text: string) => $$<HTMLButtonElement>('button').find((b) => b.textContent?.includes(text))!;
/** 開いているダイアログの中のボタン (ページ側に同名のボタンがあっても取り違えない) */
const dlgBtn = (text: string) => $$<HTMLButtonElement>('[role=alertdialog] button').find((b) => b.textContent?.trim() === text)!;
const input = async (el: HTMLInputElement, value: string) => {
  await act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};

let data: Record<string, any>;
beforeEach(async () => {
  data = installChromeMock() as Record<string, any>;
  document.body.innerHTML = '<div id="app"></div>';
  await noteAccount({ handle: 'me', displayName: 'Me' }, 5);
  setAccountScope('me');
});
afterEach(() => {
  const app = document.getElementById('app');
  if (app) render(null, app);
});

describe('F-1: resetSettings', () => {
  const custom = { syncNative: true, buttonMode: 'replace' as const, actionMode: 'sidepanel' as const, lastFolderId: 'f_x', viewMode: 'grid' as const, sortKey: 'postedAsc' as const, viewAccount: 'you', imageCache: { enabled: true, backend: 'dir' as const, maxBytes: 5 * 1024 ** 3, quality: 'orig' as const, onFull: 'stop' as const }, autoCollect: { enabled: false, speed: 'normal' as const, cap: 100 as const, offers: { you: 'dismissed' as const } }, fullText: false, fullTextSpeed: 'standard' as const, fullTextTabs: 3 as const, triageMulti: true, recentFolderIds: ['f_x'] };

  it('puts every setting back to DEFAULT_SETTINGS (the only source of defaults), including the manually chosen account', async () => {
    await updateSettings(custom);
    expect(await getSettings()).toEqual(custom);
    await resetSettings();
    expect(data.settings).toEqual(DEFAULT_SETTINGS); // 保存内容そのものが既定値。キーの漏れがない
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(data.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('also drops unknown / future keys in the settings object (it replaces the whole `settings` key)', async () => {
    data.settings = { ...custom, futureOption: 123 };
    await resetSettings();
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('works when nothing was ever stored', async () => {
    await resetSettings();
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('forgets the dismissed import banner (dismissed → 0) but keeps the observed pending count', async () => {
    await recordPending('me', 12);
    await dismissImportHint('me');
    await recordPending('you', 3);
    expect((await getImportHint('me')).dismissed).toBe(12);
    await resetSettings();
    expect(await getImportHint('me')).toEqual({ pending: 12, dismissed: 0 });
    expect(await getImportHint('you')).toEqual({ pending: 3, dismissed: 0 });
  });

  it('does not touch folders, saved posts, accounts or lastSeenAccount', async () => {
    const f = await createFolder({ name: 'keep' });
    await setBookmarkFolders('1', [f.id], snap);
    await addCollected([{ tweetId: '2', snapshot: snap }]);
    await updateSettings(custom);
    const before = { folders: structuredClone(data.folders), bookmarks: structuredClone(data.bookmarks), accounts: structuredClone(data.accounts), last: await getLastSeenAccount(), schema: data.schemaVersion };
    await resetSettings();
    expect(data.folders).toEqual(before.folders);
    expect(data.bookmarks).toEqual(before.bookmarks);
    expect(data.accounts).toEqual(before.accounts);
    expect(await getLastSeenAccount()).toEqual(before.last);
    expect(data.schemaVersion).toBe(before.schema);
    expect((await listBookmarks()).length).toBe(2);
    expect((await listFolders()).length).toBe(3);
  });

  it('restoreSettings puts the previous settings and hints back (also when they did not exist)', async () => {
    await updateSettings(custom);
    await recordPending('me', 4);
    await dismissImportHint('me');
    const backup = await resetSettings();
    await restoreSettings(backup);
    expect(await getSettings()).toEqual(custom);
    expect((await getImportHint('me')).dismissed).toBe(4);
    // もともと何も保存されていなかった場合は、キーごと元に戻る
    installChromeMock();
    const empty = await resetSettings();
    await restoreSettings(empty);
    expect('settings' in (await chrome.storage.local.get('settings'))).toBe(false);
  });
});

describe('F-3: the content script follows a reset without reloading', () => {
  const html = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
  const nativeBtn = () => document.querySelector<HTMLElement>('[data-testid=bookmark], [data-testid=removeBookmark]')!;

  it('buttonMode replace → separate: the interceptor and the badge go away at once and the separate button comes back', async () => {
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = html;
    installGlobalHandlers();
    await updateSettings({ buttonMode: 'replace' });
    initButtons();
    await tick();
    const xHandler = vi.fn();
    nativeBtn().addEventListener('click', xHandler);
    nativeBtn().click();
    await tick();
    expect(xHandler).not.toHaveBeenCalled(); // 置き換えモード: 横取りされる
    expect(document.querySelector('.postshelf-popover')).not.toBeNull();
    expect(nativeBtn().querySelector('[data-postshelf-badge]')).not.toBeNull();
    expect(document.querySelector('[data-postshelf-btn]')).toBeNull();
    document.querySelector('.postshelf-popover')?.remove();

    await resetSettings();
    await tick();
    expect(nativeBtn().querySelector('[data-postshelf-badge]')).toBeNull(); // 標準ボタンのバッジが外れた
    expect(document.querySelector('[data-postshelf-btn]')).not.toBeNull(); // 横に足すボタンに戻った
    nativeBtn().click();
    await tick();
    expect(xHandler).toHaveBeenCalledTimes(1); // X 標準の動作 (横取りなし)
    expect(document.querySelector('.postshelf-popover')).toBeNull();
  });
});

describe('F-2/F-3/F-5: the reset UI in the manager', () => {
  const mount = async () => {
    installPanelMock();
    (window as any).innerWidth = 1200;
    await act(() => void render(<App />, $('#app')));
    await flush();
  };
  const openSettings = async () => click($$('.side .fr').find((r) => r.textContent?.includes('設定'))!);

  it('asks in-app (no window.confirm) with the specified wording; cancel changes nothing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    await updateSettings({ viewMode: 'list', syncNative: true });
    await mount();
    await openSettings();
    await click(btn('設定を初期の値に戻す'));
    expect($('[role=alertdialog] p').textContent).toBe('設定を初期の値に戻しますか？ 保存したポストとフォルダは消えません。');
    await click(dlgBtn('キャンセル'));
    expect($$('[role=alertdialog]').length).toBe(0);
    expect((await getSettings()).viewMode).toBe('list');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('resets, updates the open screens at once (view mode, switch), shows an Undo toast, and Undo restores the previous settings', async () => {
    const f = await createFolder({ name: 'Keep' });
    await setBookmarkFolders('1', [f.id], snap);
    await updateSettings({ viewMode: 'list', syncNative: true, sortKey: 'savedAsc', buttonMode: 'replace' });
    await mount();
    await openSettings();
    expect($<HTMLInputElement>('input[role=switch]').checked).toBe(true);
    await click(btn('設定を初期の値に戻す'));
    await click(dlgBtn('初期の値に戻す'));
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect($<HTMLInputElement>('input[role=switch]').checked).toBe(false); // 設定画面の表示が即座に変わる
    expect($<HTMLInputElement>('input[name=buttonMode]:checked').nextElementSibling!.textContent).toContain('別ボタンを追加');
    expect((await listBookmarks()).length).toBe(1); // データは変わらない
    expect($('.toast').textContent).toContain('設定を初期の値に戻しました');
    // 一覧に戻ると、表示形式も初期値 (ポスト表示) になっている
    await click($$('.side .fr').find((r) => r.textContent?.includes('すべて'))!);
    expect($$('.rows.view-post').length).toBe(1);
    // 元に戻す
    await click($$('.toast button').find((b) => b.textContent === '元に戻す')!);
    expect(await getSettings()).toMatchObject({ viewMode: 'list', syncNative: true, sortKey: 'savedAsc', buttonMode: 'replace' });
    expect($$('.toast').length).toBe(0);
  });

  it('the Undo toast is scheduled to disappear after 5 seconds', async () => {
    await mount();
    await openSettings();
    await click(btn('設定を初期の値に戻す'));
    const spy = vi.spyOn(globalThis, 'setTimeout');
    await click(dlgBtn('初期の値に戻す'));
    expect($$('.toast').length).toBe(1);
    expect(spy.mock.calls.some((c) => c[1] === 5000)).toBe(true);
    spy.mockRestore();
  });

  it('the manually chosen account is reset too: the view goes back to the last seen account', async () => {
    await noteAccount({ handle: 'you' }, 1);
    setAccountScope('you');
    await addCollected([{ tweetId: '5', snapshot: snap }]);
    await noteAccount({ handle: 'me' }, 9);
    await updateSettings({ viewAccount: 'you' });
    await mount();
    expect($('.acct-btn').textContent).toContain('@you');
    await openSettings();
    await click(btn('設定を初期の値に戻す'));
    await click(dlgBtn('初期の値に戻す'));
    expect($('.acct-btn').textContent).toContain('@me');
  });
});

describe('F-4/F-5: delete all data', () => {
  const mount = async () => {
    installPanelMock();
    (window as any).innerWidth = 1200;
    await act(() => void render(<App />, $('#app')));
    await flush();
    await click($$('.side .fr').find((r) => r.textContent?.includes('設定'))!);
  };
  const seed = async () => {
    const f = await createFolder({ name: 'A' });
    await setBookmarkFolders('1', [f.id], snap);
    await setBookmarkFolders('2', [f.id], snap);
    await updateSettings({ viewMode: 'grid' });
  };

  it('is in a separate danger area at the bottom of the settings, shows counts and a way to export first', async () => {
    await seed();
    await mount();
    const zones = $$('.setting-group');
    expect(zones[zones.length - 1].classList.contains('danger-zone')).toBe(true);
    await click(btn('すべてのデータを削除'));
    const dlg = $('[role=alertdialog]');
    expect(dlg.textContent).toContain('フォルダ 1 個、ポスト 2 件、アカウント 1 件');
    expect(dlg.textContent).toContain('取り消しはできません');
    expect(dlg.textContent).toContain('「削除」と入力');
    expect(Array.from(dlg.querySelectorAll('button')).some((b) => b.textContent?.includes('JSON を書き出す'))).toBe(true);
  });

  it('cannot run until the word is typed exactly; wrong input keeps the button disabled; nothing is deleted before', async () => {
    await seed();
    await mount();
    await click(btn('すべてのデータを削除'));
    const run = () => dlgBtn('削除');
    expect(run().disabled).toBe(true);
    await input($('[role=alertdialog] input'), '削');
    expect(run().disabled).toBe(true);
    await input($('[role=alertdialog] input'), 'いいえ');
    expect(run().disabled).toBe(true);
    await click(run()); // 無効なボタンは何もしない
    expect((await listBookmarks()).length).toBe(2);
    await input($('[role=alertdialog] input'), '削除');
    expect(run().disabled).toBe(false);
  });

  it('deletes folders, posts and accounts but keeps the settings; cancel and Escape delete nothing', async () => {
    await seed();
    await mount();
    await click(btn('すべてのデータを削除'));
    await click(dlgBtn('キャンセル'));
    expect((await listBookmarks()).length).toBe(2);
    await click(btn('すべてのデータを削除'));
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await flush();
    expect($$('[role=alertdialog]').length).toBe(0);
    expect((await listBookmarks()).length).toBe(2);

    await click(btn('すべてのデータを削除'));
    await input($('[role=alertdialog] input'), '削除');
    await click(dlgBtn('削除'));
    expect(data.bookmarks).toEqual({});
    expect(data.folders).toEqual([]);
    expect(data.accounts).toEqual({});
    expect('lastSeenAccount' in data).toBe(false);
    expect((await getSettings()).viewMode).toBe('grid'); // 設定は残る
    expect($('.toast').textContent).toContain('すべてのデータを削除しました');
  });
});
