import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { openXTab, watchStart } from '../src/manager/AutoCollect';
import { peekCollectCommand, sendCollectCommand } from '../src/shared/settings';

let tabs: { create: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
beforeEach(() => {
  installChromeMock();
  tabs = { create: vi.fn(async () => ({})), query: vi.fn(async () => []), update: vi.fn(async () => ({})) };
  (globalThis as any).chrome.tabs = { ...tabs, sendMessage: vi.fn(async () => ({ ok: true })), reload: vi.fn(async () => {}) };
});
afterEach(() => vi.useRealTimers());

describe('v26-E: openXTab reuses only a bookmarks-list tab', () => {
  it('/i/history/likes is not reused: /i/history is opened', async () => {
    tabs.query.mockResolvedValue([{ id: 5, windowId: 1, url: 'https://x.com/i/history/likes' }]);
    await openXTab();
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://x.com/i/history' });
  });

  it.each(['https://x.com/i/history', 'https://x.com/i/bookmarks', 'https://x.com/i/history/?x=1', 'https://twitter.com/i/bookmarks'])('%s is reused', async (url) => {
    tabs.query.mockResolvedValue([{ id: 7, windowId: 2, url }]);
    await openXTab();
    expect(tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('picks the bookmarks tab even if a likes tab comes first; a tab without a readable url is not reused', async () => {
    tabs.query.mockResolvedValue([{ id: 1, url: 'https://x.com/i/history/likes' }, { id: 2 }, { id: 3, url: 'https://x.com/i/bookmarks' }]);
    await openXTab();
    expect(tabs.update).toHaveBeenCalledWith(3, { active: true });
  });
});

describe('v26-E: a start command nobody picked up is reported', () => {
  const base = { type: 'start' as const, consent: true as const, speed: 'slow' as const, cap: 300 as const, accountId: 'me' };

  it('still pending after the wait: withdrawn and reported', async () => {
    vi.useFakeTimers();
    const id = await sendCollectCommand(base);
    const missed = vi.fn();
    watchStart(id, missed, 1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(missed).toHaveBeenCalledTimes(1);
    expect(await peekCollectCommand()).toBeNull();
  });

  it('already taken (cleared) by x.com: nothing is reported', async () => {
    vi.useFakeTimers();
    const id = await sendCollectCommand(base);
    const missed = vi.fn();
    watchStart(id, missed, 1000);
    await chrome.storage.local.remove('collectCommand');
    await vi.advanceTimersByTimeAsync(1100);
    expect(missed).not.toHaveBeenCalled();
  });

  it('a newer command is left alone', async () => {
    vi.useFakeTimers();
    const id = await sendCollectCommand(base);
    const missed = vi.fn();
    watchStart(id, missed, 1000);
    await sendCollectCommand({ ...base, type: 'start' });
    await vi.advanceTimersByTimeAsync(1100);
    expect(missed).not.toHaveBeenCalled();
    expect(await peekCollectCommand()).not.toBeNull();
  });
});
