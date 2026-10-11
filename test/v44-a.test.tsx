import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { assignments, box, button, click, confirm, enter, flush, mount, setup, unmount } from './v44-helpers';

afterEach(unmount);
it.each(['tab', 'sidepanel'] as const)('drafts without writes in the inbox on %s until one confirmation', async surface => {
  const folders = await setup([[], []]); await mount(surface, t('inboxName'));
  const writes = vi.spyOn(chrome.storage.local, 'set');
  await click(box('Sample A')); expect(writes).not.toHaveBeenCalled(); expect(document.querySelector('.menu-bulk')).not.toBeNull();
  expect(await assignments()).toEqual([['inbox'], ['inbox']]);
  await confirm(); expect(writes.mock.calls.filter(([items]) => 'bookmarks' in items)).toHaveLength(1);
  expect(await assignments()).toEqual([[folders[0].id], [folders[0].id]]); expect(document.querySelector('.menu-bulk')).toBeNull();
});
it('keeps the folder view open after clearing every check; Enter saves once', async () => {
  await setup(); await mount('tab', 'Sample A'); const writes = vi.spyOn(chrome.storage.local, 'set');
  await click(box('Sample A')); expect(document.querySelector('.menu-bulk')).not.toBeNull(); expect(writes).not.toHaveBeenCalled();
  await enter(box('Sample A')); expect(writes.mock.calls.filter(([items]) => 'bookmarks' in items)).toHaveLength(1);
  expect(await assignments()).toEqual([['inbox'], ['inbox']]); expect(document.querySelector('.menu-bulk')).toBeNull();
});
it.each(['Escape', 'back', 'outside', 'other'])('discards a draft on %s', async how => {
  await setup(); await mount(); const before = await assignments(); const writes = vi.spyOn(chrome.storage.local, 'set'); await click(box('Sample B'));
  if (how === 'Escape') await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  if (how === 'back') await click(button(t('back')));
  if (how === 'outside') await act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  if (how === 'other') {
    const sort = document.querySelector<HTMLButtonElement>('.sort-btn')!;
    await act(() => void sort.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); await click(sort);
  }
  await flush(); expect(await assignments()).toEqual(before); expect(writes).not.toHaveBeenCalled();
  if (how === 'back') await click(button(t('changeFolder')));
  else { expect(document.querySelector('.menu-bulk')).toBeNull(); await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!); await click(button(t('changeFolder'))); }
  expect(box('Sample B').checked).toBe(false);
});
it('does not write an unchanged or toggled-back draft; preserves untouched partial folders', async () => {
  const f = await setup([[0], [0, 1]]); await mount(); const writes = vi.spyOn(chrome.storage.local, 'set');
  expect(box('Sample B').indeterminate).toBe(true); await confirm(); expect(writes).not.toHaveBeenCalled();
  await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!); await click(button(t('changeFolder')));
  await click(box('Sample C')); await click(box('Sample C')); await confirm(); expect(writes).not.toHaveBeenCalled();
  await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!); await click(button(t('changeFolder'))); await click(box('Sample C')); await confirm();
  expect(await assignments()).toEqual([[f[0].id, f[2].id], [f[0].id, f[1].id, f[2].id]]);
});
it('retains a failed draft for retry and prevents duplicate confirmations', async () => {
  const f = await setup(); await mount(); await click(box('Sample B'));
  const set = vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Sample failure'));
  await confirm(); expect(document.querySelector('.menu-bulk')).not.toBeNull(); expect(box('Sample B').checked).toBe(true);
  expect(document.querySelector('.menu-bulk')?.textContent).toContain(t('errorStorage')); expect(await assignments()).toEqual([[f[0].id], [f[0].id]]);
  set.mockRestore(); let release!: () => void; const gate = new Promise<void>(r => release = r); const original = chrome.storage.local.set;
  const save = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items: Record<string, unknown>) => { await gate; return original(items); });
  const b = button(t('triageConfirm')); await act(() => { b.click(); b.click(); }); await flush(); expect(save).toHaveBeenCalledOnce();
  await act(async () => { release(); await gate; }); await flush(); expect(document.querySelector('.menu-bulk')).toBeNull();
  expect(await assignments()).toEqual([[f[0].id, f[1].id], [f[0].id, f[1].id]]);
});
it('prioritizes Enter on buttons and text inputs over confirming the draft', async () => {
  await setup(); await mount(); await click(box('Sample B')); const writes = vi.spyOn(chrome.storage.local, 'set');
  await enter(button(t('back'))); expect(writes).not.toHaveBeenCalled();
  const link = document.createElement('a'); link.href = 'https://example.test'; document.querySelector('.menu-bulk')!.append(link);
  await enter(link); expect(writes).not.toHaveBeenCalled();
  await click(button(t('addFolder'))); const input = document.querySelector<HTMLInputElement>('.menu-bulk form input')!;
  await enter(input); expect(writes).not.toHaveBeenCalled(); expect(document.querySelector('.menu-bulk')).not.toBeNull();
});
it('applies additions/removals with one bookmark write and one undo', async () => {
  const f = await setup([[0, 1], [0]]); const before = await assignments(); const op = storage.changeBookmarkFolders;
  expect(op).toBeTypeOf('function'); const writes = vi.spyOn(chrome.storage.local, 'set');
  const undo = await op(['1', '2'], [f[2].id], [f[0].id]); expect(writes).toHaveBeenCalledOnce();
  expect(await assignments()).toEqual([[f[1].id, f[2].id], [f[2].id]]); expect(Object.keys(undo)).toHaveLength(2);
  await storage.restoreBookmarks(undo); expect(await assignments()).toEqual(before);
  writes.mockClear(); await op(['1', '2'], [f[0].id], []); expect(writes).not.toHaveBeenCalled();
});
