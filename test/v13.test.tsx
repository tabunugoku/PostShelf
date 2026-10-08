import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { SettingsPage } from '../src/manager/Settings';
import { clearStorageError, installErrorHandlers, reportStorageError } from '../src/manager/errorBus';
import { noteRunVersion, getSettings, DEFAULT_IMAGE_CACHE } from '../src/shared/settings';
import { INSTALL_URL } from '../src/shared/links';
import { listBookmarks, listFolders, setAccountScope } from '../src/shared/storage';
import { UNKNOWN_ACCOUNT_ID } from '../src/shared/models';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 25)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock() as Record<string, any>;
  (globalThis as any).chrome.tabs = { query: async () => [] };
  document.body.innerHTML = '<div id="app"></div>';
  clearStorageError();
});
const mount = async (node: preact.VNode) => {
  await act(() => void render(node, $('#app')));
  await flush();
};

describe('v13-C-2: version display and the update notice', () => {
  it('noteRunVersion: nothing on the first install, nothing on the same version, the previous version after an update — and it records the new one', async () => {
    expect(await noteRunVersion('0.1.0')).toBeNull(); // 初回
    expect(data.lastRunVersion).toBe('0.1.0');
    expect(await noteRunVersion('0.1.0')).toBeNull();
    expect(await noteRunVersion('0.2.0')).toBe('0.1.0');
    expect(await noteRunVersion('0.2.0')).toBeNull(); // 1 回だけ
    expect(await noteRunVersion('')).toBeNull();
  });
  it('settings: shows the manifest version, the update guide, and a link to INSTALL.md', async () => {
    await mount(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />);
    const text = $('section').textContent!;
    expect(text).toContain('バージョン 9.9.9');
    expect(text).toContain('先に「エクスポート」で保存してから、同じフォルダに新しい版を上書き');
    const link = $$('a').find((a) => a.getAttribute('href') === INSTALL_URL)!;
    expect(link.getAttribute('rel')).toContain('noopener');
  });
  it('the manager shows a closable notice once after an update, and not on a first run or the same version', async () => {
    data.lastRunVersion = '0.0.9';
    await mount(<App />);
    expect($('[role=status]').textContent).toContain('PostShelf を更新しました（9.9.9）');
    await act(() => void $('[role=status] button').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect($$('[role=status]').length).toBe(0);
    // 次の起動では出ない
    document.body.innerHTML = '<div id="app"></div>';
    await mount(<App />);
    expect($$('[role=status]').length).toBe(0);
    // 初回インストール
    delete data.lastRunVersion;
    document.body.innerHTML = '<div id="app"></div>';
    await mount(<App />);
    expect($$('[role=status]').length).toBe(0);
    expect(data.lastRunVersion).toBe('9.9.9');
  });
});

describe('v13-C-4: empty state and errors on screen', () => {
  it('first install (no data): a natural empty state that points to the x.com history Bookmarks', async () => {
    await mount(<App />);
    expect($('.empty-title').textContent).toBe('まだ保存したポストがありません');
    expect($('.empty-state').textContent).toContain('x.com の履歴の「ブックマーク」から取り込めます');
    expect($$('.banner-error').length).toBe(0);
  });
  it('an unhandled failure (e.g. a storage write) shows an alert in the manager that can be closed', async () => {
    installErrorHandlers();
    await mount(<App />);
    await act(async () => {
      const p = Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
      p.catch(() => {});
      window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { promise: p, reason: 'x' }));
    });
    await flush();
    expect($('[role=alert].banner-error').textContent).toContain('保存または読み込みに失敗しました');
    await act(() => void $('.banner-error button').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect($$('.banner-error').length).toBe(0);
  });
  it('the initial load failing shows the alert instead of a blank page', async () => {
    (globalThis as any).chrome.storage.local.get = async () => {
      throw new Error('storage unavailable');
    };
    await mount(<App />);
    expect($('.banner-error')).toBeTruthy();
    reportStorageError();
  });
  it('the popover shows the failure inside itself when saving fails', async () => {
    const { openPopover } = await import('../src/content/popover');
    const { injectButtons } = await import('../src/content/buttons');
    const { resetAccount, setCurrentAccount } = await import('../src/content/account');
    const { createFolder } = await import('../src/shared/storage');
    const { readFileSync } = await import('node:fs');
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = readFileSync('test/fixtures/tweet.html', 'utf8');
    await createFolder({ name: '開発' });
    injectButtons();
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
    const alertEl = pop.querySelector<HTMLElement>('[role=alert]:not(.postshelf-account)')!;
    expect(alertEl.style.display).toBe('none');
    (globalThis as any).chrome.storage.local.set = async () => {
      throw new Error('QUOTA_BYTES quota exceeded');
    };
    const cb = pop.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 20));
    expect(alertEl.style.display).toBe('block');
    expect(alertEl.textContent).toContain('保存または読み込みに失敗しました');
  });
});

describe('v13-C-4: updating keeps the existing data (v1 data from before accounts, settings from before the image cache)', () => {
  it('old-format data is migrated without loss, old settings get the image cache defaults, and the version marker is separate', async () => {
    data.folders = [
      { id: 'inbox', name: '', icon: 'ti-star', order: 0 },
      { id: 'f_a', name: '旧フォルダ', icon: 'ti-code', color: '#378ADD', order: 1 },
    ];
    data.bookmarks = {
      '11': { tweetId: '11', folderIds: ['f_a'], savedAt: 5, snapshot: { text: '旧', author: 'A', handle: '@a', media: ['https://pbs.twimg.com/media/x?format=jpg&name=small'], url: 'https://x.com/a/status/11' } },
    };
    data.settings = { syncNative: true, buttonMode: 'replace', actionMode: 'sidepanel', viewMode: 'list', sortKey: 'savedDesc', lastFolderId: 'f_a' };
    data.lastRunVersion = '0.0.1';
    setAccountScope(UNKNOWN_ACCOUNT_ID); // 旧データの持ち主は「アカウント未設定」
    const s = await getSettings();
    expect(s).toMatchObject({ syncNative: true, buttonMode: 'replace', actionMode: 'sidepanel', viewMode: 'list', lastFolderId: 'f_a' });
    expect(s.imageCache).toEqual(DEFAULT_IMAGE_CACHE);
    expect(s.imageCache.enabled).toBe(false);
    const bm = await listBookmarks(); // schema 1 → 2 (v9)
    expect(bm).toHaveLength(1);
    expect(bm[0].snapshot.videoPoster).toBeUndefined(); // v11 の追加項目は無くても読める
    expect(bm[0].snapshot.media).toHaveLength(1);
    expect((await listFolders()).map((f) => f.name)).toContain('旧フォルダ');
    expect(data.lastRunVersion).toBe('0.0.1');
    // 画面でも、そのまま見える
    await mount(<App />);
    expect($$('[data-row]').length).toBe(1);
    expect($('[data-row]').textContent).toContain('旧');
    expect($('[role=status]').textContent).toContain('更新しました');
  });
});
