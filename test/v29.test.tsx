import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { createFolder, deleteBookmarks, getBookmark, listBookmarks, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { updateSettings } from '../src/shared/settings';
import { digitOf } from '../src/manager/Triage';

const flush = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const snap = (n: number) => ({ text: `post ${n}`, author: `A${n}`, handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });

async function seed(inbox: number, folderNames: string[] = ['Dev', 'Fun']) {
  const fs = [];
  for (const name of folderNames) fs.push(await createFolder({ name }));
  for (let i = 1; i <= inbox; i++) await setBookmarkFolders(String(i), [], snap(i));
  const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
  Object.values(data).forEach((b: any) => (b.savedAt = Number(b.tweetId))); // 1 が最も古い → 新しい順なら 3, 2, 1
  await chrome.storage.local.set({ bookmarks: data });
  return fs;
}
async function mount(surface: 'tab' | 'sidepanel' = 'tab') {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush(60);
}
const key = async (code: string, init: KeyboardEventInit = {}) => {
  const target = $('[role=dialog].triage');
  await act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init })));
  await flush();
};
const openInbox = async () => {
  await updateSettings({ lastFolderId: 'inbox' });
  await mount();
};

beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  history.replaceState(null, '', '/');
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
});

describe('v29-B: the count in the top bar', () => {
  it('「N 件」 normally; 「N 件中 M 件」 and 「絞り込みを外す」 while searching; the button clears the search', async () => {
    await seed(3);
    await mount();
    expect($('.bar-count').textContent).toBe('3 件');
    expect($$('.bar-clear')).toHaveLength(0);
    const input = $<HTMLInputElement>('.top input[type=search]');
    await act(() => {
      input.value = 'post 2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    expect($('.bar-count').textContent).toBe('3 件中 1 件');
    await act(() => void $<HTMLElement>('.bar-clear').click());
    await flush();
    expect(input.value).toBe('');
    expect($('.bar-count').textContent).toBe('3 件');
    expect($$('.bar-clear')).toHaveLength(0);
  });
});

describe('v29-C: triage mode', () => {
  it('the button shows only for 未分類 with posts, and not in the side panel', async () => {
    await seed(0);
    await openInbox();
    expect($$('.triage-start')).toHaveLength(0);
    document.body.innerHTML = '';
    await seed(2, []);
    await openInbox();
    expect($$('.triage-start')).toHaveLength(1);
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    await mount('sidepanel');
    expect($$('.triage-start')).toHaveLength(0);
  });

  it('digit adds and advances; Shift+digit stays; → skips; ← goes back (✓ shows, pressing toggles); Esc ends; the key handler is on the dialog, not window', async () => {
    const [dev, fun] = await seed(3);
    await openInbox();
    await act(() => void $<HTMLElement>('.triage-start').click());
    await flush();
    const dlg = $('[role=dialog].triage');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect($('.triage-progress').textContent).toBe('1 / 3');
    expect(dlg.textContent).toContain('post 3'); // 新しい順の先頭
    // window に飛ばしても効かない
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    await flush();
    expect((await getBookmark('3'))!.folderIds).toEqual(['inbox']);
    await key('Digit1', { key: '1' });
    expect((await getBookmark('3'))!.folderIds).toEqual([dev.id]);
    expect($('.triage-progress').textContent).toBe('2 / 3');
    await key('Digit2', { key: '@', shiftKey: true }); // Shift: 追加して留まる
    expect((await getBookmark('2'))!.folderIds).toEqual([fun.id]);
    expect($('.triage-progress').textContent).toBe('2 / 3');
    expect($$('.triage-folder.on').map((b) => b.textContent)).toEqual(['2Fun']);
    await key('ArrowRight');
    expect($('.triage-progress').textContent).toBe('3 / 3');
    await key('ArrowLeft');
    await key('ArrowLeft');
    expect($('.triage-progress').textContent).toBe('1 / 3');
    expect($$('.triage-folder.on').map((b) => b.textContent)).toEqual(['1Dev']); // 戻った先で ✓
    await key('Digit1', { key: '1', shiftKey: true }); // ✓ を押すと外れる
    expect((await getBookmark('3'))!.folderIds).toEqual(['inbox']);
    await key('Escape');
    expect($$('[role=dialog].triage')).toHaveLength(0);
  });

  it('after the last post: 「仕分けが終わりました」 with the count and only a close button', async () => {
    const [dev] = await seed(2);
    await openInbox();
    await act(() => void $<HTMLElement>('.triage-start').click());
    await flush();
    await key('Digit1', { key: '1' });
    await key('ArrowRight'); // 最後を飛ばす
    const dlg = $('[role=dialog].triage');
    expect(dlg.textContent).toContain('仕分けが終わりました');
    expect(dlg.textContent).toContain('1 件を仕分けました');
    expect($$('[role=dialog].triage button').map((b) => b.textContent)).toEqual(['閉じる']);
    expect((await getBookmark('2'))!.folderIds).toEqual([dev.id]);
  });

  it('the queue is fixed at the start: data changes do not reorder it; a deleted post is skipped', async () => {
    const [dev] = await seed(4);
    await openInbox();
    await act(() => void $<HTMLElement>('.triage-start').click());
    await flush();
    await setBookmarkFolders('1', [dev.id], snap(1)); // 外から変わる
    await deleteBookmarks(['3']); // 次に出るはずのポストが消える
    await flush(60);
    expect($('.triage-progress').textContent).toBe('1 / 4');
    await key('ArrowRight');
    expect($('[role=dialog].triage').textContent).toContain('post 2');
    expect($('.triage-progress').textContent).toBe('3 / 4');
    expect((await listBookmarks()).length).toBe(3);
  });

  it('typing in an input does not take the digit keys; "N" opens the folder create menu', async () => {
    await seed(2);
    await openInbox();
    await act(() => void $<HTMLElement>('.triage-start').click());
    await flush();
    await key('KeyN', { key: 'n' });
    const input = $<HTMLInputElement>('.triage-new input');
    expect(input).toBeTruthy();
    await act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true, cancelable: true })));
    await flush();
    expect((await getBookmark('2'))!.folderIds).toEqual(['inbox']);
    expect($('.triage-progress').textContent).toBe('1 / 2');
    await key('Escape'); // まず作成メニューだけが閉じる
    expect($$('.triage-new')).toHaveLength(0);
    expect($$('[role=dialog].triage')).toHaveLength(1);
  });

  it('with more than 9 folders the 10th is reached via 「他のフォルダ」', async () => {
    await seed(1, Array.from({ length: 10 }, (_, i) => `F${i + 1}`));
    await openInbox();
    await act(() => void $<HTMLElement>('.triage-start').click());
    await flush();
    expect($$('.triage-folder kbd').map((k) => k.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'N']);
    expect($$('.triage-folder').some((b) => b.textContent?.includes('他のフォルダ'))).toBe(true);
    await key('Digit9', { key: '9' }); // 10 番目は数字キーに無い
    expect(digitOf({ code: 'Numpad3' })).toBe(3);
    expect(digitOf({ code: 'Digit0' })).toBeNull();
  });

  it('#triage opens 未分類 and starts the mode (hash removed); with 0 posts it only opens 未分類', async () => {
    await seed(2);
    history.replaceState(null, '', '/#triage');
    await mount();
    expect($$('[role=dialog].triage')).toHaveLength(1);
    expect(location.hash).toBe('');
    expect($('.fr.on').textContent).toContain('未分類');
    document.body.innerHTML = '';
    installChromeMock();
    installPanelMock();
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    history.replaceState(null, '', '/#triage');
    await mount();
    expect($$('[role=dialog].triage')).toHaveLength(0);
    expect($('.fr.on').textContent).toContain('未分類');
  });
});

describe('v29: new Japanese strings stay short', () => {
  const ja = JSON.parse(readFileSync('static/_locales/ja/messages.json', 'utf8')) as Record<string, { message: string }>;
  it.each(['triageStart', 'triageSkip', 'triageBack', 'triageOtherFolders', 'activeMoreFolders'])('%s ≤ 12 chars', (k) => {
    expect(ja[k].message.length).toBeLessThanOrEqual(12);
  });
  it('triageHint and activeSaved fit on one line (≤ 20)', () => {
    expect(ja.triageHint.message.length).toBeLessThanOrEqual(20);
    expect(ja.activeSaved.message.length).toBeLessThanOrEqual(20);
  });
});
