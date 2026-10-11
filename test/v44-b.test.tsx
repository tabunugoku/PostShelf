import { afterEach, expect, it, vi } from 'vitest';
import { t } from '../src/shared/strings';
import { assignments, box, click, confirm, mount, setup, unmount } from './v44-helpers';

afterEach(unmount);
it.each([
  { kind: 'inbox', before: [[0], [0, 1], []], actions: ['inbox'], key: 'toastMoved', count: 2 },
  { kind: 'add only', before: [[0], [0, 1], [1]], actions: ['Sample A'], key: 'toastAdded', count: 1 },
  { kind: 'remove only', before: [[0, 1], [0, 1], [1]], actions: ['Sample A', 'Sample A'], key: 'toastRemoved', count: 2 },
  { kind: 'add and remove', before: [[0], [0, 1], [0, 2]], actions: ['Sample A', 'Sample B'], key: 'toastMoved', count: 3 },
])('shows one accurate toast for $kind after confirmation', async ({ before, actions, key, count }) => {
  await setup(before); await mount(); const saved = await assignments(); const writes = vi.spyOn(chrome.storage.local, 'set');
  for (const name of actions) await click(box(name === 'inbox' ? t('inboxName') : name));
  expect(await assignments()).toEqual(saved); expect(writes).not.toHaveBeenCalled(); expect(document.querySelector('.toast')).toBeNull();
  await confirm(); expect(document.querySelector('.toast')?.textContent).toContain(t(key, count));
  expect(document.querySelectorAll('.toast')).toHaveLength(1); expect(writes.mock.calls.filter(([items]) => 'bookmarks' in items)).toHaveLength(1);
  if (actions[0] === 'inbox') expect(await assignments()).toEqual([['inbox'], ['inbox'], ['inbox']]);
});
it('makes inbox and user-folder drafts exclusive, including mixed rows', async () => {
  const f = await setup([[0], [0, 1], []]); await mount();
  expect(box(t('inboxName')).indeterminate).toBe(true); await click(box(t('inboxName')));
  for (const name of ['Sample A', 'Sample B', 'Sample C']) { expect(box(name).checked).toBe(false); expect(box(name).indeterminate).toBe(false); }
  expect(box(t('inboxName')).checked).toBe(true);
  await click(box('Sample C')); expect(box(t('inboxName')).checked).toBe(false); expect(box(t('inboxName')).indeterminate).toBe(false);
  expect(box('Sample C').checked).toBe(true); await confirm();
  expect(await assignments()).toEqual([[f[2].id], [f[2].id], [f[2].id]]);
});
it('returns an empty draft to inbox and does not write when already in inbox', async () => {
  await setup([[], []]); await mount(); const writes = vi.spyOn(chrome.storage.local, 'set');
  await click(box(t('inboxName'))); expect(box(t('inboxName')).checked).toBe(true);
  await confirm(); expect(writes).not.toHaveBeenCalled(); expect(document.querySelector('.toast')).toBeNull();
});
it('moves to inbox when all user-folder checks are cleared', async () => {
  await setup(); await mount(); const writes = vi.spyOn(chrome.storage.local, 'set');
  await click(box('Sample A')); expect(box(t('inboxName')).checked).toBe(true);
  await confirm(); expect(await assignments()).toEqual([['inbox'], ['inbox']]); expect(document.querySelector('.toast')?.textContent).toContain(t('toastMoved', 2));
  expect(writes).toHaveBeenCalledOnce(); expect(writes.mock.calls[0][0]).toHaveProperty('folders');
});
it('updates the partial inbox preview without changing untouched mixed memberships', async () => {
  const f = await setup([[0], [0, 1]]); await mount(); await click(box('Sample A'));
  expect(box(t('inboxName')).indeterminate).toBe(true); expect(box('Sample B').indeterminate).toBe(true);
  await confirm(); expect(await assignments()).toEqual([['inbox'], [f[1].id]]); expect(document.querySelector('.toast')?.textContent).toContain(t('toastRemoved', 2));
});
