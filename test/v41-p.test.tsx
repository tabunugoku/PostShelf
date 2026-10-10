import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Triage } from '../src/manager/Triage';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 20)));
beforeEach(async () => {
  installChromeMock(); storage.setAccountScope('unknown');
  const folder = await storage.createFolder({ name: 'Sample folder' });
  for (const id of ['111', '222']) await storage.setBookmarkFolders(id, [], {
    text: `Sample post ${id}`, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${id}`,
  });
  const queue = (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId));
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<Triage multi queue={queue} live={new Set(['111', '222'])} folders={[folder]} pickerFolders={[folder]} onChanged={() => {}} onClose={() => {}} />, document.querySelector('#app')!));
  await flush();
});
afterEach(async () => { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); });

it('shows only the existing Confirm text, retaining the invisible Enter shortcut', () => {
  const button = document.querySelector('.triage-confirm')!;
  expect(button.querySelector('kbd')).toBeNull();
  expect(button.textContent).toBe(t('triageConfirm'));
  expect(button.getAttribute('aria-keyshortcuts')).toBe('Enter');
});
it('still confirms number-key marks with Enter once and advances', async () => {
  const save = vi.spyOn(storage, 'setBookmarkFolders');
  const root = document.querySelector('.triage')!;
  await act(() => void root.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true })));
  await flush();
  expect(save).not.toHaveBeenCalled();
  await act(() => void root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await flush();
  expect(save).toHaveBeenCalledOnce();
  expect((await storage.getBookmark('111'))?.folderIds).toEqual([(await storage.listFolders()).find(f => f.name === 'Sample folder')!.id]);
  expect(document.querySelector('.triage-progress')?.textContent).toBe(t('triageProgress', 2, 2));
});
