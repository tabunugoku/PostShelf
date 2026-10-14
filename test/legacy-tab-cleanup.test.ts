import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { cleanupLegacyTabs, type LegacyTabs } from '../src/background/fulltext';

let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
});

/** タブの一覧から作る、差し替え用のタブの読み書き。失敗するタブ ID は get が例外を投げる */
function fakeTabs(tabs: Record<number, { url?: string; active?: boolean }>) {
  const closed: number[] = [];
  const api: LegacyTabs = {
    get: async (id) => {
      if (!(id in tabs)) throw new Error('No tab');
      return tabs[id];
    },
    close: async (id) => void closed.push(id),
  };
  return { api, closed };
}

it('closes only background post pages that are not active, then clears the record', async () => {
  data.fullTextTab = [1, 2, 3, 4, 5];
  const { api, closed } = fakeTabs({
    1: { url: 'https://x.com/sample_a/status/100', active: false },
    2: { url: 'https://twitter.com/sample_b/status/200?s=20', active: false },
    3: { url: 'https://x.com/sample_a/status/100', active: true },
    4: { url: 'https://x.com/home', active: false },
    5: { active: false },
  });
  await cleanupLegacyTabs(api);
  expect(closed).toEqual([1, 2]);
  expect('fullTextTab' in data).toBe(false);
});

it('keeps going when tabs.get fails', async () => {
  data.fullTextTab = [9, 1];
  const { api, closed } = fakeTabs({ 1: { url: 'https://x.com/sample_a/status/100', active: false } });
  await cleanupLegacyTabs(api);
  expect(closed).toEqual([1]);
  expect('fullTextTab' in data).toBe(false);
});

it('reads a single number left by versions before v1.1.6', async () => {
  data.fullTextTab = 7;
  const { api, closed } = fakeTabs({ 7: { url: 'https://x.com/sample_a/status/100', active: false } });
  await cleanupLegacyTabs(api);
  expect(closed).toEqual([7]);
  expect('fullTextTab' in data).toBe(false);
});

it.each([null, 'abc', { id: 1 }, -1, 1.5])('closes nothing and clears the record for %j', async (value) => {
  data.fullTextTab = value;
  const { api, closed } = fakeTabs({ 1: { url: 'https://x.com/sample_a/status/100', active: false } });
  await cleanupLegacyTabs(api);
  expect(closed).toEqual([]);
  expect('fullTextTab' in data).toBe(false);
});

/** background/index.ts を読み込み、onInstalled の登録を取り出す */
async function loadBackground() {
  vi.resetModules();
  const calls = installPanelMock();
  const handlers: Array<(d: { reason: string }) => void> = [];
  (globalThis as any).chrome.runtime.onInstalled = { addListener: (h: any) => handlers.push(h) };
  const get = vi.fn(async () => ({ url: 'https://x.com/sample_a/status/100', active: false }));
  const remove = vi.fn(async () => {});
  (globalThis as any).chrome.tabs = { get, remove };
  await import('../src/background/index');
  return { calls, handlers, remove };
}
const flush = () => new Promise((r) => setTimeout(r, 20));

it('cleans the legacy record only on an update', async () => {
  data.fullTextTab = [1];
  const { handlers, remove } = await loadBackground();
  for (const h of handlers) h({ reason: 'install' });
  await flush();
  expect(remove).not.toHaveBeenCalled();
  expect(data.fullTextTab).toEqual([1]);
  for (const h of handlers) h({ reason: 'update' });
  await flush();
  expect(remove).toHaveBeenCalledWith(1);
  expect('fullTextTab' in data).toBe(false);
});

it('does not touch storage.local when the service worker just starts', async () => {
  data.fullTextTab = [1];
  const { remove } = await loadBackground();
  await flush();
  expect(remove).not.toHaveBeenCalled();
  expect(data.fullTextTab).toEqual([1]);
});
