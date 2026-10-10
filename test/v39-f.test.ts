import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import * as account from '../src/content/account';
import { AutoCollector, COMMAND_TTL_MS, defaultDeps, handleCollectCommand, installAutoCollect, type CollectDeps } from '../src/content/autocollect';
import { pathListeners } from '../src/content/collect';
import { handleMessage } from '../src/content/messages';
import { openXTab } from '../src/manager/AutoCollect';
import { peekCollectCommand, sendCollectCommand, updateAutoCollect } from '../src/shared/settings';

const consent = { consent: true as const, accountId: 'me', speed: 'slow' as const, cap: 300 as const };
let hidden: boolean;
const collectors: AutoCollector[] = [];
const detect = (id = 'me') => account.setCurrentAccount({ id, handle: id, lastSeenAt: Date.now() });
function deps(): CollectDeps {
  return { ...defaultDeps(), scrollBy: vi.fn(), scrollToTop: vi.fn(), visible: () => [], hasUnseen: () => false,
    isLoading: () => false, hasLimit: () => false, savedIds: async () => new Set(), addCollected: async () => 0 };
}
function collector(d = deps()) {
  const c = new AutoCollector(d);
  collectors.push(c);
  return c;
}
beforeEach(() => {
  vi.useFakeTimers();
  installChromeMock();
  installPanelMock();
  account.resetAccount();
  hidden = false;
  history.replaceState(null, '', '/i/history');
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  vi.spyOn(document, 'addEventListener');
  collectors.length = 0;
});
afterEach(async () => {
  for (const c of collectors) await c.stop();
  for (const [type, listener, options] of vi.mocked(document.addEventListener).mock.calls) {
    if (type === 'visibilitychange') document.removeEventListener(type, listener, options);
  }
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  account.resetAccount();
  history.replaceState(null, '', '/');
});

describe('waiting for account detection', () => {
  it('starts after account detection at two seconds, with an account subscription and no refusal', async () => {
    const subscribe = vi.spyOn(account, 'subscribeAccount');
    const d = deps();
    const c = collector(d);
    const start = c.start(consent);
    expect(c.state?.reason).not.toBe('refused-unknown');
    expect(subscribe).toHaveBeenCalledTimes(1);
    setTimeout(() => detect(), 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.state?.status).toBe('countdown');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await start).toBe(true);
    expect(d.scrollToTop).toHaveBeenCalledTimes(1);
  });
  it('waits fifteen seconds, never polls the account, then refuses unknown accounts', async () => {
    const d = deps();
    const reads = vi.fn(d.accountId);
    d.accountId = reads;
    const c = collector(d);
    let settled = false;
    const start = c.start(consent).then((ok) => { settled = true; return ok; });
    await vi.advanceTimersByTimeAsync(14999);
    expect(settled).toBe(false);
    expect(reads.mock.calls.length).toBeLessThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(await start).toBe(false);
    expect(c.state).toMatchObject({ status: 'stopped', reason: 'refused-unknown' });
    expect(d.scrollToTop).not.toHaveBeenCalled();
  });
  it.each(['stop', 'stop-command', 'page', 'hidden', 'pagehide'])('cancels permanently when %s occurs during the wait', async (reason) => {
    const d = deps();
    const c = collector(d);
    const pathsBefore = pathListeners.size;
    const start = c.start(consent);
    expect(c.state?.reason).not.toBe('refused-unknown');
    await vi.advanceTimersByTimeAsync(1000);
    if (reason === 'stop') await c.stop();
    if (reason === 'stop-command') {
      await sendCollectCommand({ type: 'stop' });
      await handleCollectCommand(c, d);
      expect(await peekCollectCommand()).toBeNull();
    }
    if (reason === 'page') {
      history.replaceState(null, '', '/home');
      pathListeners.forEach((cb) => cb());
      history.replaceState(null, '', '/i/history');
    }
    if (reason === 'hidden') {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    }
    if (reason === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    detect();
    await vi.advanceTimersByTimeAsync(20000);
    expect(await start).toBe(false);
    expect(d.scrollToTop).not.toHaveBeenCalled();
    expect(pathListeners.size).toBe(pathsBefore);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('still refuses a different detected account', async () => {
    const c = collector();
    const start = c.start(consent);
    expect(c.state?.reason).not.toBe('refused-unknown');
    detect('sample_other');
    expect(await start).toBe(false);
    expect(c.state?.reason).toBe('refused-account');
  });
});

describe('commands received while hidden', () => {
  it.each(['valid', 'expired', 'unconsented', 'disabled'])('rechecks a %s pending command on becoming visible', async (kind) => {
    detect();
    hidden = true;
    if (kind === 'disabled') await updateAutoCollect({ enabled: false });
    await sendCollectCommand({ type: 'start', ...consent, consent: kind !== 'unconsented' });
    if (kind === 'expired') await vi.advanceTimersByTimeAsync(COMMAND_TTL_MS + 1);
    const c = installAutoCollect(() => {}, deps());
    collectors.push(c);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.state).toBeNull();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    if (kind === 'valid') expect(c.state?.status).toBe('running');
    else expect(c.state).toBeNull();
    expect(await peekCollectCommand()).toBeNull();
  });
});

it('responds to ping synchronously', () => {
  const reply = vi.fn();
  expect(handleMessage({ type: 'ping' }, reply)).toBe(false);
  expect(reply).toHaveBeenCalledWith({ ok: true });
});

it.each(['ok', 'empty', 'rejected'])('checks ping before activating an existing tab (%s response)', async (kind) => {
  const tabs = {
    query: vi.fn(async () => [{ id: 7, windowId: 2, url: 'https://x.com/i/history' }]),
    sendMessage: vi.fn(async () => { if (kind === 'rejected') throw new Error('no receiver'); return kind === 'ok' ? { ok: true } : undefined; }),
    reload: vi.fn(async () => {}), update: vi.fn(async () => ({})), create: vi.fn(),
  };
  (globalThis as any).chrome.tabs = tabs;
  await openXTab();
  expect(tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'ping' });
  expect(tabs.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(tabs.update.mock.invocationCallOrder[0]);
  if (kind === 'ok') expect(tabs.reload).not.toHaveBeenCalled();
  else {
    expect(tabs.reload).toHaveBeenCalledWith(7);
    expect(tabs.reload.mock.invocationCallOrder[0]).toBeLessThan(tabs.update.mock.invocationCallOrder[0]);
  }
  expect(tabs.update).toHaveBeenCalledWith(7, { active: true });
  expect(tabs.create).not.toHaveBeenCalled();
});
