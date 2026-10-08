import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { createFolder, getBookmark, listAccounts, noteAccount, setAccountScope, setBookmarkFolders, addCollected, listBookmarks } from '../src/shared/storage';
import { getSettings, recordPending, updateSettings } from '../src/shared/settings';

const snap = (n: number) => ({ text: `post ${n}`, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const key = async (el: Element, k: string) => {
  await act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
  await flush();
};
const mount = async (surface: 'tab' | 'sidepanel' = 'tab') => {
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush();
  await flush(); // アクティブタブの問い合わせ (非同期) が終わるまで
};
const rowIds = () => $$('[data-row]').map((r) => r.getAttribute('data-row')).sort();
const switcherBtn = () => $<HTMLButtonElement>('.acct-btn');
const openSwitcher = async () => click(switcherBtn());
/** 行の「…」のメニューを開いて、「このアカウントのデータを削除」を押す (v19: ごみ箱は「…」の中) */
const deleteVia = async (name: string) => {
  const row = $$('.acct-row').find((r) => r.querySelector('.fr-name')!.textContent === name)!;
  await click(row.querySelector('[aria-haspopup=menu]')!);
  await click($('.acct-more [role=menuitem]'));
};
const acctRows = () => $$('.acct-row').map((r) => r.querySelector('.fr-name')!.textContent);

/** me: 2 件 / you: 1 件 (同じ tweetId 1 を両方で保存) / 旧データ (unknown): 1 件 */
async function seed({ withUnknown = false, lastSeen = 'me' }: { withUnknown?: boolean; lastSeen?: string | null } = {}) {
  await noteAccount({ handle: 'you', displayName: 'You' }, 1);
  await noteAccount({ handle: 'me', displayName: 'Me Name' }, 2);
  setAccountScope('me');
  const f = await createFolder({ name: 'MyFolder' });
  await setBookmarkFolders('1', [f.id], snap(1));
  await setBookmarkFolders('2', [f.id], snap(2));
  setAccountScope('you');
  const g = await createFolder({ name: 'YourFolder' });
  await setBookmarkFolders('1', [g.id], snap(1));
  if (withUnknown) {
    setAccountScope('unknown');
    await addCollected([{ tweetId: '9', snapshot: snap(9) }]);
  }
  if (lastSeen) await noteAccount({ handle: lastSeen }, 99);
}

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
});
afterEach(() => render(null, $('#app')));

describe('E-4: manager account switcher', () => {
  it('defaults to the account last seen on x.com; the sidebar top shows avatar-or-initial, @handle and ▾', async () => {
    await seed();
    await mount();
    expect(switcherBtn().textContent).toContain('@me');
    expect(switcherBtn().getAttribute('aria-haspopup')).toBe('menu');
    expect($('.side').firstElementChild!.contains(switcherBtn())).toBe(true); // 左サイドバーの最上部
    expect(rowIds()).toEqual(['1', '2']);
    expect($$('.side .fr .fr-name').map((x) => x.textContent)).toContain('MyFolder');
    expect($$('.side .fr .fr-name').map((x) => x.textContent)).not.toContain('YourFolder'); // 別アカウントのフォルダは見えない
  });

  it('lists accounts with saved counts, a note that X login is unchanged, and no "unknown" while it has no data', async () => {
    await seed();
    await mount();
    await openSwitcher();
    expect(acctRows()).toEqual(['@me', '@you']);
    expect($$('.acct-row .n').map((x) => x.textContent)).toEqual(['2', '1']);
    expect($('.menu-acct').textContent).toContain('X のログイン状態は変わりません');
    expect($('.acct-main[aria-checked=true] .fr-name').textContent).toBe('@me');
    expect($('.menu-acct').textContent).toContain('x.com でログイン中');
  });

  it('shows "アカウント未設定" only when it has data', async () => {
    await seed({ withUnknown: true });
    await mount();
    await openSwitcher();
    expect(acctRows()).toEqual(['@me', '@you', 'アカウント未設定']);
    expect($$('.acct-row .n').map((x) => x.textContent)).toEqual(['2', '1', '1']);
  });

  it('switching changes folders, rows, counts and search to that account; the manual choice is remembered', async () => {
    await seed();
    await mount();
    await openSwitcher();
    await click($$('.acct-main').find((x) => x.textContent?.includes('@you'))!);
    expect(switcherBtn().textContent).toContain('@you');
    expect(rowIds()).toEqual(['1']);
    expect($$('.side .fr .fr-name').map((x) => x.textContent)).toContain('YourFolder');
    expect($('.top .bar-count').textContent).toBe('1 件');
    expect((await getSettings()).viewAccount).toBe('you');
    // 次回もそれを使う
    await act(() => void render(null, $('#app')));
    await mount();
    expect(switcherBtn().textContent).toContain('@you');
    // ログイン中のアカウントに戻すと「選んでいない」に戻る (以降は x.com に追従)
    await openSwitcher();
    await click($$('.acct-main').find((x) => x.textContent?.includes('@me'))!);
    expect((await getSettings()).viewAccount).toBe('');
  });

  it('is keyboard operable: opens with Enter/click, arrows move the focus, Escape closes', async () => {
    await seed();
    await mount();
    await openSwitcher();
    const mains = () => $$<HTMLElement>('.acct-main');
    expect(document.activeElement).toBe(mains()[0]); // 現在のアカウントの行にフォーカス
    await key(mains()[0], 'ArrowDown');
    expect(document.activeElement).toBe(mains()[1]);
    await key(mains()[1], 'ArrowUp');
    expect(document.activeElement).toBe(mains()[0]);
    await key(document.body, 'Escape');
    expect($$('.menu-acct').length).toBe(0);
  });

  it('follows x.com: when another account is seen, switches to it and shows a short toast', async () => {
    await seed();
    await mount();
    await updateSettings({ viewAccount: 'you' }); // 手動で選んでいても、x.com で切り替えたら追従する
    await noteAccount({ handle: 'you' }, 500);
    await flush();
    expect(switcherBtn().textContent).toContain('@you');
    expect($('.toast').textContent).toContain('@you に切り替えました');
    expect($$('.toast button').length).toBe(0); // 元に戻す対象ではない
    expect((await getSettings()).viewAccount).toBe('');
    expect(rowIds()).toEqual(['1']);
  });

  it('a manual choice wins at start-up over the last seen account', async () => {
    await seed();
    await updateSettings({ viewAccount: 'you' });
    await mount();
    expect(switcherBtn().textContent).toContain('@you');
  });

  it('with no last seen account, falls back to the account that has data (e.g. only legacy data)', async () => {
    await seed({ lastSeen: null });
    // lastSeenAccount を消す
    await (chrome.storage.local as any).remove('lastSeenAccount');
    await mount();
    expect(switcherBtn().textContent).toMatch(/@(me|you)/);
  });

  it('works in the side panel layout too (switcher above the folder button)', async () => {
    installPanelMock();
    (window as any).innerWidth = 400;
    await seed();
    await mount('sidepanel');
    expect($('.phead').firstElementChild!.contains(switcherBtn())).toBe(true);
    await openSwitcher();
    await click($$('.acct-main').find((x) => x.textContent?.includes('@you'))!);
    expect(rowIds()).toEqual(['1']);
  });

  it('banner counts and import hints are per account', async () => {
    await seed();
    await recordPending('me', 5);
    await recordPending('you', 2);
    await mount();
    expect($('.banner').textContent).toContain('5 件');
    await openSwitcher();
    await click($$('.acct-main').find((x) => x.textContent?.includes('@you'))!);
    expect($('.banner').textContent).toContain('2 件');
  });
});

describe('E-4: deleting an account\'s data / assigning data', () => {
  it('"このアカウントのデータを削除" asks in-app with the count and says it cannot be undone; then removes only that account', async () => {
    await seed();
    await mount();
    await openSwitcher();
    await deleteVia('@you');
    const msg = $('[role=alertdialog] p').textContent!;
    expect(msg).toContain('@you');
    expect(msg).toContain('1 件');
    expect(msg).toContain('取り消しはできません');
    await click($$('[role=alertdialog] button').find((b) => b.textContent === '削除')!);
    setAccountScope('you');
    expect(await listBookmarks()).toEqual([]);
    setAccountScope('me');
    expect((await listBookmarks()).length).toBe(2); // me は無事
    expect(rowIds()).toEqual(['1', '2']);
  });

  it('cancel keeps everything', async () => {
    await seed();
    await mount();
    await openSwitcher();
    await deleteVia('@you');
    await click($$('[role=alertdialog] button').find((b) => b.textContent === 'キャンセル')!);
    expect((await listAccounts()).map((a) => a.count)).toEqual([2, 1]);
  });

  it('shows a banner for leftover "unknown" data and assigns it to the logged-in account (merging a duplicate tweet)', async () => {
    await seed();
    setAccountScope('unknown');
    await setBookmarkFolders('1', ['f_old'], snap(1)); // me にもある tweetId 1 → 統合
    await addCollected([{ tweetId: '9', snapshot: snap(9) }]);
    await mount();
    expect($('.banner[aria-label="アカウント未設定"]').textContent).toContain('2 件');
    await click($('.banner[aria-label="アカウント未設定"] button'));
    expect($('[role=dialog] h2').textContent).toBe('データの割り当て');
    expect($('[role=dialog] input[type=radio]:checked')).toBeTruthy();
    expect($('[role=dialog]').textContent).toContain('アカウント未設定');
    await click($$('[role=dialog] button').find((b) => b.textContent === '割り当て…')!);
    setAccountScope('me');
    expect((await listBookmarks()).map((b) => b.tweetId).sort()).toEqual(['1', '2', '9']);
    expect((await getBookmark('1'))!.folderIds.length).toBe(2);
    expect((await listAccounts()).some((a) => a.account.id === 'unknown')).toBe(false);
    expect($$('.banner[aria-label="アカウント未設定"]').length).toBe(0);
    expect($('.toast').textContent).toContain('2 件を割り当てました');
  });

  it('v19: rows switch on click (no arrow button); only the アカウント未設定 row has a 割り当て… button; the trash is inside each row\'s 「…」 menu', async () => {
    await seed({ withUnknown: true });
    await mount();
    await openSwitcher();
    expect($$('.acct-row [aria-label*="割り当て"]').length).toBe(1);
    expect(acctRows()).toEqual(['@me', '@you', 'アカウント未設定']);
    expect($$('.acct-row').find((r) => r.querySelector('.fr-name')!.textContent === 'アカウント未設定')!.querySelector('.acct-assign')!.textContent).toBe('割り当て…');
    expect($$('.acct-row .ti-arrows-exchange').length).toBe(0);
    expect($$('.acct-row .ti-trash').length).toBe(0); // ごみ箱は、「…」を開くまで出ない
    expect($$('.acct-more').length).toBe(0);
    await click($$('.acct-row')[1].querySelector('[aria-haspopup=menu]')!);
    expect($('.acct-more .menu-item').textContent).toContain('このアカウントのデータを削除');
    expect($('.acct-more .ti-trash')).toBeTruthy();
    await click($$('.acct-row .acct-assign')[0]); // 「割り当て…」から、データの割り当ての画面へ
    expect($('[role=dialog] h2').textContent).toBe('データの割り当て');
  });
});

describe('E-5/E-6: side panel save button and popup follow the account', () => {
  it('the save button is replaced by a reason when the viewed account differs from the logged-in one', async () => {
    installPanelMock();
    (window as any).innerWidth = 400;
    const c = (globalThis as any).chrome;
    c.tabs = { query: async () => [{ id: 5, url: 'https://x.com/a/status/12345' }], sendMessage: async () => ({ ok: false }), onActivated: { addListener() {}, removeListener() {} }, onUpdated: { addListener() {}, removeListener() {} }, create: async () => ({}) };
    await seed();
    await mount('sidepanel');
    expect($$('.cta').length).toBe(1);
    await openSwitcher();
    await click($$('.acct-main').find((x) => x.textContent?.includes('@you'))!);
    expect($$('.cta').length).toBe(0);
    expect($('.pfoot [role=alert]').textContent).toContain('@me');
  });

  it('with no detected account, the side panel cannot save', async () => {
    installPanelMock();
    (window as any).innerWidth = 400;
    const c = (globalThis as any).chrome;
    c.tabs = { query: async () => [{ id: 5, url: 'https://x.com/a/status/12345' }], sendMessage: async () => ({ ok: false }), onActivated: { addListener() {}, removeListener() {} }, onUpdated: { addListener() {}, removeListener() {} }, create: async () => ({}) };
    await seed({ lastSeen: null });
    await (chrome.storage.local as any).remove('lastSeenAccount');
    await mount('sidepanel');
    expect($$('.cta').length).toBe(0);
    expect($('.pfoot [role=alert]').textContent).toContain('判定できない');
  });

  it('popup shows the current account and its counts only', async () => {
    await seed();
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await act(async () => void (await import('../src/popup/index')));
    await flush();
    expect($('.popup-account').textContent).toBe('アカウント: @me');
    expect($('.sub:not(.popup-account)').textContent).toContain('2 ');
  });
});
