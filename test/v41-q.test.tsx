import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import { getSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import { ALL_FOLDER_ID, INBOX_ID, type Bookmark, type Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
let folders: Folder[], queue: Bookmark[], multi: boolean;
let changed: ReturnType<typeof vi.fn>, closed: ReturnType<typeof vi.fn>;
const renderCurrent = () => render(<Triage multi={multi} queue={queue} live={new Set(queue.map(b => b.tweetId))}
  folders={folders} pickerFolders={folders} onChanged={changed} onClose={closed} />, document.querySelector('#app')!);
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown');
  folders = [];
  for (let i = 1; i <= 3; i++) folders.push(await storage.createFolder({ name: 'Sample folder ' + i }));
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], {
    text: 'Sample post ' + id, author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/' + id,
  });
  queue = (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  // App と同じく作成後にフォルダ一覧を読み直す。未確定の印は Triage 内に保持される。
  changed = vi.fn(async () => { folders = (await storage.listFolders()).filter(f => f.id !== INBOX_ID && f.id !== ALL_FOLDER_ID); renderCurrent(); });
  closed = vi.fn(); document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });
const mount = async (mode = true) => { multi = mode; await act(() => void renderCurrent()); await flush(); };
const root = () => document.querySelector<HTMLElement>('.triage')!;
const key = async (key: string, target: Element = root()) => {
  await act(() => void target.dispatchEvent(new KeyboardEvent('keydown', {
    key, code: /^[1-9]$/.test(key) ? 'Digit' + key : key, bubbles: true, cancelable: true,
  }))); await flush();
};
const click = async (el: HTMLElement) => { await act(() => void el.click()); await flush(); };
const progress = (n: number) => expect(document.querySelector('.triage-progress')?.textContent).toBe(t('triageProgress', n, queue.length));
const inputName = async (selector = '.triage-new') => {
  const input = document.querySelector<HTMLInputElement>(selector + ' input:not([type=checkbox])')!;
  await act(() => { input.value = 'Sample created'; input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const prepare = async () => { await key('n'); await inputName(); };
const submit = async (selector = '.triage-new') => {
  await act(() => void document.querySelector(selector + ' form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush();
};
const created = async () => (await storage.listFolders()).find(f => f.name === 'Sample created')!;
const pressed = (n: number) => document.querySelectorAll('.triage-folder')[n - 1].getAttribute('aria-pressed');
const confirm = async (method: 'Enter' | 'button' = 'button') => {
  const button = document.querySelector<HTMLButtonElement>('.triage-confirm')!;
  if (method === 'Enter') {
    expect(document.activeElement).toBe(button);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(() => void button.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    // jsdom は Enter のデフォルトのクリックを生成しない。ブラウザの押下を1回だけ補う。
  }
  await click(button);
};

it.each(['Enter', 'button'] as const)('stages two marks and the N-created folder until explicit %s confirmation', async method => {
  await mount(); await key('1'); await key('2'); await prepare();
  const save = vi.spyOn(storage, 'setBookmarkFolders'); const add = vi.spyOn(storage, 'addToFolders');
  await submit(); const f = await created(); const ids = [folders[0].id, folders[1].id, f.id];
  expect(save).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); progress(1);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([INBOX_ID]);
  expect((await getSettings()).recentFolderIds).toEqual([]);
  expect(pressed(1)).toBe('true'); expect(pressed(2)).toBe('true'); expect(pressed(4)).toBe('true');
  expect(document.querySelector('.triage-new')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('.triage-confirm'));
  expect(document.activeElement).not.toBe(document.querySelector('[aria-keyshortcuts=N]'));
  await confirm(method);
  expect(save).toHaveBeenCalledExactlyOnceWith('111', ids, queue[0].snapshot);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(ids);
  expect((await getSettings()).recentFolderIds).toEqual(ids);
  expect(changed).toHaveBeenCalledTimes(2); progress(2);
  expect(document.querySelector('.triage-post')?.textContent).toContain('Sample post 222');
});

it('confirms only the new folder when no marks were present', async () => {
  await mount(); await prepare(); const save = vi.spyOn(storage, 'setBookmarkFolders');
  await submit(); const f = await created(); expect(save).not.toHaveBeenCalled(); progress(1);
  await confirm(); expect(save).toHaveBeenCalledExactlyOnceWith('111', [f.id], queue[0].snapshot); progress(2);
});

it('retains saved assignments and records only newly confirmed folders as recent', async () => {
  queue[0].folderIds = [folders[0].id]; await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(); await prepare(); const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit(); const f = await created();
  expect(save).not.toHaveBeenCalled(); expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id]);
  await confirm(); expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[0].id, f.id], queue[0].snapshot);
  expect((await getSettings()).recentFolderIds).toEqual([f.id]); progress(2);
});

it('uses current marks without restoring a saved assignment whose mark was removed', async () => {
  queue[0].folderIds = [folders[0].id]; await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(); await key('1'); await key('2'); await prepare();
  const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit(); const f = await created(); expect(save).not.toHaveBeenCalled();
  await confirm(); expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[1].id, f.id], queue[0].snapshot); progress(2);
});

it('keeps the created folder and marks after confirmation failure, then retries without another creation', async () => {
  await mount(); await key('1'); await key('2'); await prepare(); const create = vi.spyOn(storage, 'createFolder');
  const save = vi.spyOn(storage, 'setBookmarkFolders').mockRejectedValueOnce(new Error('Sample failure'));
  await submit(); const f = await created(); expect(save).not.toHaveBeenCalled();
  await confirm(); progress(1); expect(root().querySelector('.error')?.textContent).toBe(t('errorStorage'));
  expect(pressed(1)).toBe('true'); expect(pressed(2)).toBe('true'); expect(pressed(4)).toBe('true');
  expect(document.querySelector('.triage-new')).toBeNull();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([INBOX_ID]); expect((await getSettings()).recentFolderIds).toEqual([]);
  await confirm(); progress(2); expect(save).toHaveBeenCalledTimes(2); expect(create).toHaveBeenCalledOnce();
  expect((await storage.listFolders()).filter(f => f.name === 'Sample created')).toHaveLength(1);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, folders[1].id, f.id]);
  expect(root().querySelector('.error')).toBeNull();
});

it('guards repeated confirmation while assignment is pending after creation', async () => {
  await mount(); await key('1'); await prepare(); await submit(); const original = storage.setBookmarkFolders;
  let finish!: () => void; const gate = new Promise<void>(r => finish = r);
  const save = vi.spyOn(storage, 'setBookmarkFolders').mockImplementation(async (...args) => { await gate; return original(...args); });
  await confirm(); await confirm(); await key('Enter'); expect(save).toHaveBeenCalledOnce(); progress(1);
  await act(async () => { finish(); await gate; }); await flush(); progress(2); expect(changed).toHaveBeenCalledTimes(2);
});

it.each(['skip', 'close'] as const)('leaves the created folder but no assignment when leaving via %s before confirmation', async action => {
  await mount(); await key('1'); await prepare(); const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit();
  const f = await created();
  if (action === 'skip') { await key('ArrowRight'); await key('ArrowLeft'); expect(pressed(1)).toBe('false'); expect(pressed(4)).toBe('false'); }
  else await key('Escape');
  expect(save).not.toHaveBeenCalled(); expect((await storage.getBookmark('111'))?.folderIds).toEqual([INBOX_ID]);
  expect((await storage.listFolders()).some(folder => folder.id === f.id)).toBe(true);
  expect((await getSettings()).recentFolderIds).toEqual([]);
});

it('keeps N creation as an additive save without advancing when multi mode is off', async () => {
  queue[0].folderIds = [folders[0].id]; await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(false); await prepare(); const add = vi.spyOn(storage, 'addToFolders'); const save = vi.spyOn(storage, 'setBookmarkFolders');
  await submit(); const f = await created();
  expect(add).toHaveBeenCalledExactlyOnceWith(['111'], [f.id]); expect(save).not.toHaveBeenCalled();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, f.id]);
  progress(1); expect(document.querySelector('.triage-new')).toBeNull(); expect(changed).toHaveBeenCalledOnce();
});

it('stages creation through other folders and removes the inbox mark without confirming', async () => {
  for (let i = 4; i <= 10; i++) folders.push(await storage.createFolder({ name: 'Sample folder ' + i }));
  await mount(); await key('1'); await key('2');
  await click(document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!);
  const inbox = document.querySelector<HTMLInputElement>('.menu input[type=checkbox]')!;
  await click(inbox); expect(inbox.checked).toBe(true);
  // 「未分類」の印を付けた状態で作成。作成後はユーザーフォルダだけを選ぶ。
  await click([...document.querySelectorAll<HTMLButtonElement>('.menu button')].find(b => b.textContent === t('addFolder'))!);
  await inputName('.menu'); const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit('.menu'); const f = await created();
  expect(save).not.toHaveBeenCalled(); progress(1); expect(document.querySelector('.menu')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('.triage-confirm'));
  await click(document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!);
  const labels = [...document.querySelectorAll('.menu label')];
  expect(labels[0].querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  expect(labels.find(el => el.textContent === f.name)?.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
  await key('Escape', document.querySelector('.menu')!); await click(document.querySelector<HTMLButtonElement>('.triage-confirm')!);
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [f.id], queue[0].snapshot); progress(2);
});

it('preserves both draft marks when creating through other folders until confirmation', async () => {
  for (let i = 4; i <= 10; i++) folders.push(await storage.createFolder({ name: 'Sample folder ' + i }));
  await mount(); await key('1'); await key('2'); await click(document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!);
  await click([...document.querySelectorAll<HTMLButtonElement>('.menu button')].find(b => b.textContent === t('addFolder'))!);
  await inputName('.menu'); const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit('.menu'); const f = await created();
  expect(save).not.toHaveBeenCalled(); progress(1); await confirm();
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[0].id, folders[1].id, f.id], queue[0].snapshot); progress(2);
});

it('replaces the inbox mark when N creates a user folder', async () => {
  for (let i = 4; i <= 10; i++) folders.push(await storage.createFolder({ name: 'Sample folder ' + i }));
  await mount(); await key('1'); await click(document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!);
  const inbox = document.querySelector<HTMLInputElement>('.menu input[type=checkbox]')!;
  await click(inbox); expect(inbox.checked).toBe(true); await key('Escape', inbox);
  await prepare(); const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit(); const f = await created();
  expect(save).not.toHaveBeenCalled(); progress(1); await confirm();
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [f.id], queue[0].snapshot); progress(2);
});
