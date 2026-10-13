import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock, sessionDataOf } from './chrome-mock';
import { cleanupAtStartup, defaultDeps } from '../src/background/fulltext';
import { getFullTextTab, setFullTextTab } from '../src/shared/settings';

let data: Record<string, unknown>;
beforeEach(() => { data = installChromeMock(); });

function deps() {
  const closed: number[] = [];
  const d = { ...defaultDeps(), closeTab: async (id: number) => { closed.push(id); } };
  return { d, closed };
}

it('storage.session に残った ID のタブは閉じる', async () => {
  sessionDataOf().fullTextTab = [57];
  const { d, closed } = deps();
  await cleanupAtStartup(d);
  expect(closed).toEqual([57]);
  expect(await getFullTextTab()).toEqual([]);
});

it('storage.local にだけ残った旧い ID は、閉じずに記録を消す', async () => {
  data.fullTextTab = [57];
  const { d, closed } = deps();
  await cleanupAtStartup(d);
  expect(closed).toEqual([]);
  expect('fullTextTab' in data).toBe(false);
});

it('setFullTextTab は storage.local に書かない', async () => {
  const setSpy = vi.spyOn(chrome.storage.local, 'set');
  await setFullTextTab(57);
  expect(setSpy).not.toHaveBeenCalled();
  expect('fullTextTab' in data).toBe(false);
  expect(sessionDataOf().fullTextTab).toEqual([57]);
});
