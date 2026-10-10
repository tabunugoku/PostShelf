import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import { getSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import type { Bookmark, Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 30)));
let folders: Folder[], queue: Bookmark[];
let changed: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown');
  folders = [];
  for (let i = 1; i <= 3; i++) folders.push(await storage.createFolder({ name: `Sample folder ${i}` }));
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], {
    text: `Sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [],
    url: `https://x.com/sample_user/status/${id}`,
  });
  queue = (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  changed = vi.fn(); document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
const mount = async (multi = true) => {
  await act(() => void render(<Triage multi={multi} queue={queue} live={new Set(queue.map(b => b.tweetId))}
    folders={folders} pickerFolders={folders} onChanged={changed} onClose={() => {}} />, document.querySelector('#app')!));
  await flush();
};
const root = () => document.querySelector<HTMLElement>('.triage')!;
const key = async (key: string) => {
  await act(() => void root().dispatchEvent(new KeyboardEvent('keydown', {
    key, code: /^[1-9]$/.test(key) ? `Digit${key}` : key, bubbles: true, cancelable: true,
  })));
  await flush();
};
const progress = (n: number) => expect(document.querySelector('.triage-progress')?.textContent).toBe(t('triageProgress', n, 2));
const prepare = async () => {
  await key('n');
  const input = document.querySelector<HTMLInputElement>('.triage-new input')!;
  await act(() => { input.value = 'Sample created'; input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const submit = async () => {
  await act(() => void document.querySelector('.triage-new form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await flush();
};
const created = async () => (await storage.listFolders()).find(f => f.name === 'Sample created')!;
const pressed = (n: number) => document.querySelectorAll('.triage-folder')[n - 1].getAttribute('aria-pressed');

it('saves two draft marks plus the N-created folder once, then advances with focus', async () => {
  await mount(); await key('1'); await key('2'); await prepare();
  const save = vi.spyOn(storage, 'setBookmarkFolders'); const add = vi.spyOn(storage, 'addToFolders');
  await submit(); const f = await created(); const ids = [folders[0].id, folders[1].id, f.id];
  expect(save).toHaveBeenCalledExactlyOnceWith('111', ids, queue[0].snapshot);
  expect(add).not.toHaveBeenCalled();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(ids);
  expect((await getSettings()).recentFolderIds).toEqual(ids);
  expect(changed).toHaveBeenCalledOnce(); progress(2);
  expect(document.querySelector('.triage-post')?.textContent).toContain('Sample post 222');
  expect(document.querySelector('.triage-new')).toBeNull();
  expect(root().contains(document.activeElement)).toBe(true);
});

it('saves only the new folder when no marks are present', async () => {
  await mount(); await prepare(); const save = vi.spyOn(storage, 'setBookmarkFolders');
  await submit(); const f = await created();
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [f.id], queue[0].snapshot);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([f.id]); progress(2);
});

it('keeps saved assignments and records only newly added folders as recent', async () => {
  queue[0].folderIds = [folders[0].id];
  await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(); await prepare(); const save = vi.spyOn(storage, 'setBookmarkFolders');
  await submit(); const f = await created();
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[0].id, f.id], queue[0].snapshot);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, f.id]);
  expect((await getSettings()).recentFolderIds).toEqual([f.id]); progress(2);
});

it('uses the current marks instead of restoring a saved folder whose mark was removed', async () => {
  queue[0].folderIds = [folders[0].id];
  await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(); await key('1'); await key('2'); await prepare();
  const save = vi.spyOn(storage, 'setBookmarkFolders'); await submit(); const f = await created();
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[1].id, f.id], queue[0].snapshot);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[1].id, f.id]); progress(2);
});

it('keeps marks and the create dialog on failure, then retries without creating a duplicate', async () => {
  await mount(); await key('1'); await key('2'); await prepare();
  const create = vi.spyOn(storage, 'createFolder');
  const save = vi.spyOn(storage, 'setBookmarkFolders').mockRejectedValueOnce(new Error('Sample failure'));
  await submit(); const f = await created();
  progress(1); expect(root().querySelector('.error')?.textContent).toBe(t('errorStorage'));
  expect(pressed(1)).toBe('true'); expect(pressed(2)).toBe('true');
  expect(document.querySelector<HTMLInputElement>('.triage-new input')?.value).toBe('Sample created');
  expect(document.querySelector<HTMLInputElement>('.triage-new input')?.readOnly).toBe(true);
  expect([...document.querySelectorAll<HTMLButtonElement>('.triage-new [data-icon],.triage-new [data-color]')].every(b => b.disabled)).toBe(true);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual(['inbox']);
  expect(changed).not.toHaveBeenCalled();
  expect((await getSettings()).recentFolderIds).toEqual([]);
  // 管理画面側が作成済みフォルダを再読み込みしても、同名の再作成には進まない。
  folders = [...folders, f]; await mount();
  await submit(); progress(2); expect(save).toHaveBeenCalledTimes(2); expect(create).toHaveBeenCalledOnce();
  expect((await storage.listFolders()).filter(f => f.name === 'Sample created')).toHaveLength(1);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, folders[1].id, f.id]);
  expect(changed).toHaveBeenCalledOnce(); expect(root().querySelector('.error')).toBeNull();
});

it('prevents confirmation or repeated creation from saving twice while assignment is pending', async () => {
  await mount(); await key('1'); await prepare(); const original = storage.setBookmarkFolders;
  let finish!: () => void; const gate = new Promise<void>(r => finish = r);
  const save = vi.spyOn(storage, 'setBookmarkFolders').mockImplementation(async (...args) => { await gate; return original(...args); });
  await submit(); await act(() => void document.querySelector<HTMLButtonElement>('.triage-confirm')!.click());
  await submit(); expect(save).toHaveBeenCalledOnce(); progress(1);
  await act(async () => { finish(); await gate; }); await flush();
  progress(2); expect(changed).toHaveBeenCalledOnce();
});

it('keeps N creation as an additive save without advancing when multi mode is off', async () => {
  queue[0].folderIds = [folders[0].id];
  await storage.setBookmarkFolders('111', queue[0].folderIds, queue[0].snapshot);
  await mount(false); await prepare();
  const add = vi.spyOn(storage, 'addToFolders'); const save = vi.spyOn(storage, 'setBookmarkFolders');
  await submit(); const f = await created();
  expect(add).toHaveBeenCalledExactlyOnceWith(['111'], [f.id]); expect(save).not.toHaveBeenCalled();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, f.id]);
  progress(1); expect(document.querySelector('.triage-new')).toBeNull(); expect(changed).toHaveBeenCalledOnce();
});

it('preserves marked folders when creating through other folders, as before', async () => {
  for (let i = 4; i <= 10; i++) folders.push(await storage.createFolder({ name: `Sample folder ${i}` }));
  await mount(); await key('1'); await key('2');
  await act(() => void document.querySelector<HTMLButtonElement>('.triage-folder[aria-haspopup]')!.click()); await flush();
  const add = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find(b => b.textContent === t('addFolder'))!;
  await act(() => void add.click()); await flush();
  const input = document.querySelector<HTMLInputElement>('.menu form input')!;
  await act(() => { input.value = 'Sample created'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const save = vi.spyOn(storage, 'setBookmarkFolders');
  await act(() => void document.querySelector('.menu form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await flush();
  const f = await created();
  expect(save).toHaveBeenCalledExactlyOnceWith('111', [folders[0].id, folders[1].id, f.id], queue[0].snapshot);
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folders[0].id, folders[1].id, f.id]);
  progress(2); expect(document.querySelector('.menu')).toBeNull();
});
