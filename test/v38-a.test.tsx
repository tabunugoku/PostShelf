import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SaveCurrent } from '../src/manager/SaveCurrent';
import * as storage from '../src/shared/storage';
import * as active from '../src/shared/activeTab';
import { installChromeMock, installPanelMock } from './chrome-mock';

const snap = (id: string) => ({ text: `sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}` });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));
const click = async (selector: string) => { await act(() => void document.querySelector<HTMLElement>(selector)!.click()); await flush(); };
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let go: (p: active.ActivePost) => void;
let folder: Awaited<ReturnType<typeof storage.createFolder>>;
beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  storage.setAccountScope('unknown');
  folder = await storage.createFolder({ name: 'Sample folder' });
  vi.spyOn(active, 'watchActivePost').mockImplementation((cb) => { go = cb; cb({ tabId: 1, tweetId: '111' }); return () => {}; });
  vi.spyOn(active, 'requestSnapshot').mockImplementation(async (p) => ({ ok: true, tweetId: p.tweetId, snapshot: snap(p.tweetId) }));
  vi.spyOn(active, 'requestNativeSync').mockResolvedValue();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
});
async function mount() {
  await act(() => void render(<SaveCurrent folders={[folder]} onSaved={() => {}} />, document.querySelector('#app')!));
  await flush();
}

it('waits for all queued saves before deleting and does not save the deleted post again', async () => {
  const saving = deferred();
  vi.mocked(active.requestNativeSync).mockImplementation(async (_tab, _id, want) => { if (want) await saving.promise; });
  const remove = vi.spyOn(storage, 'removeBookmark');
  const save = vi.spyOn(storage, 'setBookmarkFolders');
  await mount();
  await click('.ap-chip');
  await click('.ap-chip'); // 保存中の最新の選択は未分類
  await click('.ap-del');
  const waited = remove.mock.calls.length === 0;
  saving.resolve();
  await flush();
  await flush();
  expect(waited).toBe(true);
  expect(await storage.getBookmark('111')).toBeUndefined();
  const writes = save.mock.calls.length;
  await flush();
  expect(save).toHaveBeenCalledTimes(writes);
  expect(document.querySelector('.ap-del')).toBeNull();
  await click('.ap-chip'); // 明示的な再保存はできる
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([folder.id]);
});

it.each(['success', 'failure'])('does not overwrite the new post after deletion %s', async (outcome) => {
  await storage.setBookmarkFolders('111', [folder.id], snap('111'));
  await storage.setBookmarkFolders('222', [folder.id], snap('222'));
  const deleting = deferred();
  const original = storage.removeBookmark;
  vi.spyOn(storage, 'removeBookmark').mockImplementation(async (id) => { await deleting.promise; await original(id); });
  await mount();
  await click('.ap-del');
  await act(() => void go({ tabId: 1, tweetId: '222' }));
  await flush();
  if (outcome === 'success') deleting.resolve();
  else deleting.reject(new Error('storage failed'));
  await flush();
  expect(document.querySelector('.ap-excerpt')?.textContent).toContain('sample post 222');
  expect(document.querySelector('.ap-chip')?.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('.active-post [role=alert]')).toBeNull();
});
