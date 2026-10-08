import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { detectAccount, resetAccount, setCurrentAccount } from '../src/content/account';
import { openPopover } from '../src/content/popover';
import { ensureCollectButton, refreshCollectButton } from '../src/content/collect';
import { injectButtons } from '../src/content/buttons';
import { UNKNOWN_ACCOUNT_ID } from '../src/shared/models';
import {
  addCollected,
  assignAccount,
  countAllData,
  createFolder,
  deleteAccountData,
  deleteFolder,
  deleteAllData,
  exportData,
  getBookmark,
  getLastSeenAccount,
  importData,
  listAccounts,
  listBookmarks,
  listFolders,
  migrateToV2,
  noteAccount,
  setAccountScope,
  setBookmarkFolders,
} from '../src/shared/storage';

const snap = (id = '1') => ({ text: `t${id}`, author: 'a', handle: '@a', media: [], url: `https://x.com/a/status/${id}` });
const tweetFixture = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));

let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock() as Record<string, any>;
  resetAccount();
  document.body.innerHTML = '';
  history.pushState({}, '', '/');
});

describe('E-1: detecting the logged-in account from the screen', () => {
  const switcher = (inner: string) => `<nav><div data-testid="SideNav_AccountSwitcher_Button">${inner}</div></nav>`;

  it('reads handle, display name and avatar from the account switcher button', () => {
    document.body.innerHTML = switcher('<img src="https://pbs.example/a.jpg"><div><span>たぶ 開発</span><span>@Tabunugoku_Dev</span></div>');
    expect(detectAccount()).toEqual({ handle: 'Tabunugoku_Dev', displayName: 'たぶ 開発', avatar: 'https://pbs.example/a.jpg' });
  });

  it('falls back to later candidates: profile link href, then the avatar test id', () => {
    document.body.innerHTML = '<header><a data-testid="AppTabBar_Profile_Link" href="/Some_User"></a></header>';
    expect(detectAccount()?.handle).toBe('Some_User');
    document.body.innerHTML = '<header><div data-testid="UserAvatar-Container-other_one"><img src="x"></div></header>';
    expect(detectAccount()?.handle).toBe('other_one');
  });

  it('tries the next candidate when the first one has no readable handle', () => {
    document.body.innerHTML = switcher('<span>no handle here</span>') + '<a data-testid="AppTabBar_Profile_Link" href="/fallback_user"></a>';
    expect(detectAccount()?.handle).toBe('fallback_user');
  });

  it('returns null (no exception) when nothing readable is there, and for the reserved id', () => {
    expect(detectAccount()).toBeNull();
    document.body.innerHTML = switcher('<span>name</span>');
    expect(detectAccount()).toBeNull();
    document.body.innerHTML = switcher('<span>x</span><span>@unknown</span>');
    expect(detectAccount()).toBeNull();
  });

  it('noteAccount normalizes the handle (lowercase id, original case kept) and stores lastSeenAccount', async () => {
    const a = await noteAccount({ handle: '@Tabunugoku_Dev', displayName: 'Dev' }, 1000);
    expect(a).toMatchObject({ id: 'tabunugoku_dev', handle: 'Tabunugoku_Dev', displayName: 'Dev', lastSeenAt: 1000 });
    expect(await getLastSeenAccount()).toEqual(a);
    // 変化がなければ 1 分以内は書き込まない
    const set = vi.spyOn(chrome.storage.local, 'set');
    await noteAccount({ handle: 'Tabunugoku_Dev', displayName: 'Dev' }, 2000);
    expect(set).not.toHaveBeenCalled();
    await noteAccount({ handle: 'Tabunugoku_Dev', displayName: 'Dev' }, 1000 + 61_000);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe('E-2: data is kept per account', () => {
  it('saving binds to the current account; other accounts never mix; the same tweet can be saved by two accounts', async () => {
    setAccountScope('alice');
    const fa = await createFolder({ name: 'A-folder' });
    await setBookmarkFolders('100', [fa.id], snap('100'));
    setAccountScope('bob');
    expect((await listFolders()).map((f) => f.id)).toEqual(['all']); // 他のアカウントのフォルダは見えない
    expect(await listBookmarks()).toEqual([]);
    expect(await getBookmark('100')).toBeUndefined();
    const fb = await createFolder({ name: 'B-folder' });
    await setBookmarkFolders('100', [fb.id], snap('100')); // 同じ tweetId を別アカウントで
    expect((await getBookmark('100'))!.folderIds).toEqual([fb.id]);
    setAccountScope('alice');
    expect((await getBookmark('100'))!.folderIds).toEqual([fa.id]);
    expect((await listFolders()).map((f) => f.name)).toEqual(['', 'A-folder']);
    expect(Object.keys(data.bookmarks).sort()).toEqual(['alice:100', 'bob:100']);
    expect(data.bookmarks['alice:100'].accountId).toBe('alice');
  });

  it('deleting a folder, collecting and bulk edits touch only the current account', async () => {
    setAccountScope('alice');
    const fa = await createFolder({ name: 'x' });
    await setBookmarkFolders('1', [fa.id], snap('1'));
    setAccountScope('bob');
    await addCollected([{ tweetId: '1', snapshot: snap('1') }]);
    expect((await getBookmark('1'))!.folderIds).toEqual(['inbox']);
    setAccountScope('alice');
    await deleteFolder(fa.id);
    expect((await getBookmark('1'))!.folderIds).toEqual(['inbox']); // 最後のフォルダを消したら「未分類」へ (v18)
    setAccountScope('bob');
    expect((await getBookmark('1'))!.folderIds).toEqual(['inbox']); // bob の「未分類」は残る
  });

  it('listAccounts: accounts with saved posts + the last seen one; "unknown" only when it has data', async () => {
    expect(await listAccounts()).toEqual([]);
    await noteAccount({ handle: 'Me' }, 5);
    setAccountScope('me');
    const f = await createFolder({ name: 'f' });
    await setBookmarkFolders('1', [f.id], snap('1'));
    await setBookmarkFolders('2', [f.id], snap('2'));
    setAccountScope('old');
    await addCollected([{ tweetId: '9', snapshot: snap('9') }]);
    setAccountScope(UNKNOWN_ACCOUNT_ID);
    expect((await listAccounts()).map((a) => [a.account.id, a.count])).toEqual([['me', 2], ['old', 1]]);
    await addCollected([{ tweetId: '7', snapshot: snap('7') }]);
    expect((await listAccounts()).map((a) => [a.account.id, a.count])).toEqual([['me', 2], ['old', 1], ['unknown', 1]]);
  });

  it('deleting one account removes only its folders, posts and account entry', async () => {
    await noteAccount({ handle: 'a1' });
    setAccountScope('a1');
    await addCollected([{ tweetId: '1', snapshot: snap() }]);
    setAccountScope('b1');
    await addCollected([{ tweetId: '1', snapshot: snap() }]);
    await deleteAccountData('a1');
    setAccountScope('a1');
    expect(await listBookmarks()).toEqual([]);
    expect((await listFolders()).length).toBe(1);
    setAccountScope('b1');
    expect((await listBookmarks()).length).toBe(1);
    expect(Object.keys(data.accounts)).toEqual([]);
  });
});

describe('E-2: migration of existing data (schema 1 → 2)', () => {
  const legacy = () => {
    data.folders = [
      { id: 'inbox', name: '', icon: 'ti-star', order: 0 },
      { id: 'f_a', name: 'Old', icon: 'ti-code', color: '#378ADD', order: 1 },
    ];
    data.bookmarks = {
      '11': { tweetId: '11', folderIds: ['f_a'], savedAt: 5, snapshot: snap('11') },
      '12': { tweetId: '12', folderIds: ['inbox', 'f_a'], savedAt: 6, snapshot: { ...snap('12'), hasVideo: true } },
    };
  };

  it('moves legacy folders and posts to "unknown" without losing anything, and bumps the schema version', async () => {
    legacy();
    const before = structuredClone(data);
    setAccountScope(UNKNOWN_ACCOUNT_ID);
    const list = await listBookmarks(); // 最初の公開関数の呼び出しで移行される
    expect(data.schemaVersion).toBe(2);
    expect(list.map((b) => b.tweetId).sort()).toEqual(['11', '12']);
    expect(Object.keys(data.bookmarks).sort()).toEqual(['unknown:11', 'unknown:12']);
    for (const id of ['11', '12']) {
      const { accountId, ...rest } = data.bookmarks[`unknown:${id}`];
      expect(accountId).toBe('unknown');
      // 中身はそのまま (hasVideo なども)。ただし「未分類」とフォルダの同時所属は、v18 の修復で「未分類」が外れる
      expect(rest).toEqual(id === '12' ? { ...before.bookmarks[id], folderIds: ['f_a'] } : before.bookmarks[id]);
    }
    expect(data.folders.map((f: any) => [f.id, f.accountId, f.name, f.color])).toEqual([
      ['inbox', 'unknown', '', undefined],
      ['f_a', 'unknown', 'Old', '#378ADD'],
    ]);
    expect((await listFolders()).map((f) => f.id)).toEqual(['all', 'inbox', 'f_a']);
    expect((await listAccounts()).map((a) => [a.account.id, a.count])).toEqual([['unknown', 2]]);
  });

  it('is idempotent: running again changes nothing (and is not even written)', async () => {
    legacy();
    await listBookmarks();
    const once = structuredClone(data);
    const set = vi.spyOn(chrome.storage.local, 'set');
    await listBookmarks();
    await listFolders();
    expect(set).not.toHaveBeenCalled();
    expect(data).toEqual(once);
    // 関数としても冪等
    const again = migrateToV2({ folders: data.folders, bookmarks: data.bookmarks });
    expect(again).toEqual({ folders: once.folders, bookmarks: once.bookmarks });
  });

  it('a fresh install (no data) just gets the schema version', async () => {
    await listFolders();
    expect(data.schemaVersion).toBe(2);
    expect(data.bookmarks).toEqual({});
  });

  it('validates in memory and writes nothing when the check fails (two legacy entries collapsing into one)', async () => {
    data.folders = [{ id: 'f_a', name: 'Old', icon: 'ti-code', order: 0 }];
    data.bookmarks = {
      '1': { tweetId: '1', folderIds: ['f_a'], savedAt: 1, snapshot: snap('1') },
      zzz: { tweetId: '1', folderIds: ['f_a'], savedAt: 2, snapshot: snap('1') },
    };
    const before = structuredClone(data);
    expect(() => migrateToV2({ folders: data.folders, bookmarks: data.bookmarks })).toThrow();
    await expect(listBookmarks()).rejects.toThrow();
    expect(data).toEqual(before); // 何も書き込まれていない
    expect(data.schemaVersion).toBeUndefined();
  });

  it('data that already has accountId is kept as is (a partly migrated store)', () => {
    const out = migrateToV2({
      folders: [{ id: 'f1', name: 'x', icon: 'ti-folder', order: 0, accountId: 'alice' }],
      bookmarks: { 'alice:5': { accountId: 'alice', tweetId: '5', folderIds: ['f1'], savedAt: 1, snapshot: snap('5') } },
    });
    expect(out.folders[0].accountId).toBe('alice');
    expect(Object.keys(out.bookmarks)).toEqual(['alice:5']);
  });
});

describe('E-2: assigning "unknown" data to an account', () => {
  it('moves folders and posts; merges a tweet that already exists at the destination; merges the 未分類 folder', async () => {
    setAccountScope('me');
    const fm = await createFolder({ name: 'Mine' });
    await setBookmarkFolders('1', [fm.id], snap('1'));
    await addCollected([{ tweetId: '3', snapshot: snap('3') }]); // me の「未分類」
    setAccountScope(UNKNOWN_ACCOUNT_ID);
    const fu = await createFolder({ name: 'Unk' });
    await setBookmarkFolders('1', [fu.id], snap('1')); // 同じ tweetId (統合される)
    await setBookmarkFolders('2', [fu.id], snap('2'));
    await addCollected([{ tweetId: '4', snapshot: snap('4') }]); // unknown の「未分類」
    const r = await assignAccount(UNKNOWN_ACCOUNT_ID, 'me');
    expect(r).toEqual({ moved: 2, merged: 1 }); // 2 と 4 は移動、1 は統合
    setAccountScope('me');
    expect((await getBookmark('1'))!.folderIds.sort()).toEqual([fm.id, fu.id].sort());
    expect((await getBookmark('1'))!.savedAt).toBeLessThanOrEqual((await getBookmark('2'))!.savedAt);
    expect((await getBookmark('2'))!.folderIds).toEqual([fu.id]);
    expect((await getBookmark('4'))!.folderIds).toEqual(['inbox']);
    expect((await listBookmarks()).length).toBe(4);
    expect((await listFolders()).map((f) => f.id).filter((id) => id === 'inbox').length).toBe(1); // 「未分類」は 1 つに統合
    expect((await listFolders()).map((f) => f.name)).toContain('Unk');
    setAccountScope(UNKNOWN_ACCOUNT_ID);
    expect(await listBookmarks()).toEqual([]);
    expect((await listFolders()).length).toBe(1);
    expect((await listAccounts()).some((a) => a.account.id === UNKNOWN_ACCOUNT_ID)).toBe(false); // 空になれば一覧から消える
  });

  it('also re-attaches data after a handle change (old handle → new handle) and drops the old account entry', async () => {
    await noteAccount({ handle: 'OldName' }, 1);
    await noteAccount({ handle: 'NewName' }, 2);
    setAccountScope('oldname');
    await addCollected([{ tweetId: '5', snapshot: snap('5') }]);
    await assignAccount('oldname', 'newname');
    setAccountScope('newname');
    expect((await getBookmark('5'))!.accountId).toBe('newname');
    expect(Object.keys(data.accounts)).toEqual(['newname']);
  });

  it('moving to itself is refused', async () => {
    await expect(assignAccount('me', 'me')).rejects.toThrow();
  });
});

describe('E-2: export / import with accounts', () => {
  it('exports version 2 with accounts, and imports it back per account (round trip into an empty store)', async () => {
    await noteAccount({ handle: 'Alice', displayName: 'A' }, 10);
    setAccountScope('alice');
    const fa = await createFolder({ name: 'FA', color: '#E24B4A' });
    await setBookmarkFolders('1', [fa.id], snap('1'));
    setAccountScope('bob');
    await addCollected([{ tweetId: '1', snapshot: snap('1') }]);
    const dump = JSON.parse(JSON.stringify(await exportData()));
    expect(dump).toMatchObject({ app: 'PostShelf', version: 2 });
    expect(dump.accounts.map((a: any) => a.id)).toEqual(['alice']);
    expect(dump.bookmarks.map((b: any) => b.accountId).sort()).toEqual(['alice', 'bob']);

    installChromeMock();
    expect(await importData(dump)).toBe(2);
    setAccountScope('alice');
    expect((await listFolders()).map((f) => f.name)).toEqual(['', 'FA']);
    expect((await getBookmark('1'))!.folderIds).toEqual([fa.id]);
    setAccountScope('bob');
    expect((await getBookmark('1'))!.folderIds).toEqual(['inbox']);
    expect((await listAccounts()).map((a) => a.account.id).sort()).toEqual(['alice', 'bob']);
  });

  it('a legacy (version 1 / no accountId) file goes to "unknown"', async () => {
    const old = {
      app: 'PostShelf', version: 1, exportedAt: 1,
      folders: [{ id: 'f_x', name: 'Old', icon: 'ti-folder', order: 0 }],
      bookmarks: [{ tweetId: '77', folderIds: ['f_x'], savedAt: 3, snapshot: snap('77') }],
    };
    expect(await importData(old)).toBe(1);
    setAccountScope(UNKNOWN_ACCOUNT_ID);
    expect((await getBookmark('77'))!.folderIds).toEqual(['f_x']);
    expect((await listFolders()).map((f) => f.name)).toEqual(['', 'Old']);
    setAccountScope('me');
    expect(await listBookmarks()).toEqual([]);
    // バージョンなし (最初期の形式) も同じ
    const { version: _v, ...noVersion } = old;
    expect(await importData(noVersion)).toBe(1);
  });

  it('a version 1 file that carries accountId fields is still treated as legacy; invalid / future files are rejected', async () => {
    const v1 = { app: 'PostShelf', version: 1, folders: [], bookmarks: [{ accountId: 'zed', tweetId: '5', folderIds: ['x'], savedAt: 1, snapshot: snap('5') }] };
    await importData(v1);
    setAccountScope('zed');
    expect(await getBookmark('5')).toBeUndefined();
    setAccountScope(UNKNOWN_ACCOUNT_ID);
    expect(await getBookmark('5')).toBeDefined();
    await expect(importData({ app: 'PostShelf', version: 3, folders: [], bookmarks: [] })).rejects.toThrow();
    await expect(importData({ foo: 1 })).rejects.toThrow();
  });
});

describe('F-4 storage: delete all data', () => {
  it('removes folders, posts, accounts and lastSeenAccount; counts are reported first', async () => {
    await noteAccount({ handle: 'Me' });
    setAccountScope('me');
    const f = await createFolder({ name: 'x' });
    await setBookmarkFolders('1', [f.id], snap('1'));
    expect(await countAllData()).toEqual({ folders: 1, posts: 1, accounts: 1 });
    await deleteAllData();
    expect(await countAllData()).toEqual({ folders: 0, posts: 0, accounts: 0 });
    expect(await getLastSeenAccount()).toBeNull();
    expect(data.schemaVersion).toBe(2);
  });
});

describe('E-3: x.com side — saving and importing need a detected account', () => {
  beforeEach(() => {
    document.body.innerHTML = tweetFixture;
  });
  const article = () => document.querySelector('article')!;
  const anchor = () => document.querySelector<HTMLElement>('[data-testid=bookmark]')!;

  it('the popover shows "保存先: @handle" with the small avatar', async () => {
    setCurrentAccount({ id: 'me', handle: 'Me', avatar: 'https://pbs.example/me.jpg', lastSeenAt: 0 });
    const pop = (await openPopover(article(), anchor()))!;
    expect(pop.querySelector('.postshelf-account')!.textContent).toBe('保存先: @Me');
    expect(pop.querySelector('.postshelf-account img')!.getAttribute('src')).toBe('https://pbs.example/me.jpg');
  });

  it('with no detected account it warns and offers no way to save', async () => {
    const pop = (await openPopover(article(), anchor()))!;
    expect(pop.querySelector('.postshelf-account')!.textContent).toContain('判定できない');
    expect(pop.querySelector('.postshelf-account')!.getAttribute('role')).toBe('alert');
    expect(pop.querySelector('input')).toBeNull();
    expect(pop.querySelector('form')).toBeNull();
  });

  it('closes the popover when the account switches while it is open, and saves to the account it was opened for only', async () => {
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    const f = await createFolder({ name: 'F' });
    await openPopover(article(), anchor());
    expect(document.querySelector('.postshelf-popover')).toBeTruthy();
    const { installGlobalHandlers } = await import('../src/content/popover');
    installGlobalHandlers();
    setCurrentAccount({ id: 'you', handle: 'you', lastSeenAt: 0 });
    expect(document.querySelector('.postshelf-popover')).toBeNull();
    // 保存は現在のアカウントのデータにだけ入る
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    await setBookmarkFolders('1234567890', [f.id], snap('1234567890'));
    setCurrentAccount({ id: 'you', handle: 'you', lastSeenAt: 0 });
    expect(await getBookmark('1234567890')).toBeUndefined();
  });

  it('no badge / saved state without an account (nothing is attributed to the wrong shelf)', async () => {
    const f = await createFolder({ name: 'F' }); // unknown に保存済みのデータがあっても…
    await setBookmarkFolders('1234567890', [f.id], snap('1234567890'));
    injectButtons();
    await tick();
    expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(false);
  });

  it('the pending count for the manager banner is recorded per account', async () => {
    history.pushState({}, '', '/i/history');
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    ensureCollectButton();
    await tick();
    expect(data.importHint).toEqual({ me: { pending: 1, dismissed: 0 } });
  });

  it('the import button is disabled with a reason when the account is unknown, and does nothing when pressed', async () => {
    history.pushState({}, '', '/i/history');
    ensureCollectButton();
    await tick();
    const btn = document.querySelector<HTMLButtonElement>('.postshelf-collect')!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('判定できないため、取り込めません');
    expect(btn.title).toContain('判定できない');
    btn.click();
    await tick();
    expect(await listBookmarks()).toEqual([]);
    // 判定できたら通常の表示に戻る
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    await refreshCollectButton();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('未取り込み 1 件');
    btn.click();
    await tick();
    expect((await listBookmarks()).length).toBe(1);
    expect((await listBookmarks())[0].accountId).toBe('me');
  });
});
