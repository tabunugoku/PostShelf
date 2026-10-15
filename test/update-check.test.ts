// 版: v73
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { RELEASES_API_URL } from '../src/shared/links';
import {
  DEFAULT_SETTINGS, getSettings, getUpdateCheckState, resetSettings, updateSettings,
} from '../src/shared/settings';
import {
  UPDATE_CHECK_INTERVAL_MS, checkForUpdate, isNewerVersion, parseVersion, type UpdateCheckDeps,
} from '../src/shared/updateCheck';

let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock() as Record<string, any>;
});

const HOUR = 60 * 60 * 1000;

/** GitHub の応答の代わり。tag を渡すと 200、数を渡すとその状態、Error を渡すと通信の失敗 */
function deps(reply: string | number | Error, now = 1_000 * HOUR, current = '1.1.7') {
  const fetchMock = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'number') return new Response('{}', { status: reply });
    return new Response(JSON.stringify({ tag_name: reply, name: 'ignored' }), { status: 200 });
  });
  const d: UpdateCheckDeps = { fetch: fetchMock as unknown as typeof fetch, now: () => now, current: () => current };
  return { d, fetchMock };
}

describe('version comparison', () => {
  it('reads tags with or without a leading v', () => {
    expect(parseVersion('v1.1.8')).toEqual([1, 1, 8]);
    expect(parseVersion('1.2')).toEqual([1, 2]);
    expect(parseVersion('v1.2.0-beta')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });
  it('compares each number, not the text', () => {
    expect(isNewerVersion('v1.1.10', '1.1.9')).toBe(true);
    expect(isNewerVersion('v1.2', '1.1.9')).toBe(true);
    expect(isNewerVersion('v1.1.7', '1.1.7')).toBe(false);
    expect(isNewerVersion('v1.1.7.0', '1.1.7')).toBe(false);
    expect(isNewerVersion('v1.1.6', '1.1.7')).toBe(false);
  });
  it('does not announce a version it cannot read', () => {
    expect(isNewerVersion('v2.0.0-rc1', '1.1.7')).toBe(false);
  });
});

describe('the setting', () => {
  it('is off by default and after resetting the settings', async () => {
    expect(DEFAULT_SETTINGS.updateCheck).toBe(false);
    expect((await getSettings()).updateCheck).toBe(false);
    data.settings = { updateCheck: 'yes' };
    expect((await getSettings()).updateCheck).toBe(false);
    await updateSettings({ updateCheck: true });
    expect((await getSettings()).updateCheck).toBe(true);
    await resetSettings();
    expect((await getSettings()).updateCheck).toBe(false);
  });
  it('makes no request while it is off', async () => {
    const { d, fetchMock } = deps('v9.0.0');
    expect(await checkForUpdate(d)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(data.updateCheckState).toBeUndefined();
  });
});

describe('checking for a new version', () => {
  beforeEach(async () => {
    await updateSettings({ updateCheck: true });
  });

  it('reads only the fixed URL, without cookies or extra headers', async () => {
    const { d, fetchMock } = deps('v1.1.8');
    expect(await checkForUpdate(d)).toBe('v1.1.8');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(RELEASES_API_URL, { credentials: 'omit', cache: 'no-store' });
    expect(await getUpdateCheckState()).toEqual({ checkedAt: 1_000 * HOUR, latest: 'v1.1.8' });
  });

  it('returns nothing when the latest release is the running version or older', async () => {
    expect(await checkForUpdate(deps('v1.1.7').d)).toBeNull();
    delete data.updateCheckState;
    expect(await checkForUpdate(deps('v1.1.6').d)).toBeNull();
  });

  it('asks again only after 24 hours, and keeps showing the last result meanwhile', async () => {
    await checkForUpdate(deps('v1.1.8', 1_000 * HOUR).d);
    const soon = deps('v1.1.9', 1_000 * HOUR + UPDATE_CHECK_INTERVAL_MS - 1);
    expect(await checkForUpdate(soon.d)).toBe('v1.1.8');
    expect(soon.fetchMock).not.toHaveBeenCalled();
    const later = deps('v1.1.9', 1_000 * HOUR + UPDATE_CHECK_INTERVAL_MS);
    expect(await checkForUpdate(later.d)).toBe('v1.1.9');
    expect(later.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops announcing once the new version is installed', async () => {
    await checkForUpdate(deps('v1.1.8').d);
    expect(await checkForUpdate(deps('v1.1.8', 1_001 * HOUR, '1.1.8').d)).toBeNull();
  });

  it.each([
    ['a network error', new Error('offline')],
    ['the rate limit (403)', 403],
    ['no release yet (404)', 404],
  ])('stays quiet on %s and does not ask again within 24 hours', async (_label, reply) => {
    const failed = deps(reply);
    expect(await checkForUpdate(failed.d)).toBeNull();
    expect(await getUpdateCheckState()).toEqual({ checkedAt: 1_000 * HOUR });
    const retry = deps('v1.1.8', 1_001 * HOUR);
    expect(await checkForUpdate(retry.d)).toBeNull();
    expect(retry.fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the last result when a later check fails', async () => {
    await checkForUpdate(deps('v1.1.8').d);
    expect(await checkForUpdate(deps(500, 1_000 * HOUR + UPDATE_CHECK_INTERVAL_MS).d)).toBe('v1.1.8');
  });

  it('ignores a response without a readable tag', async () => {
    const { d } = deps('unused');
    const noTag = vi.fn(async () => new Response(JSON.stringify({ message: 'x' }), { status: 200 }));
    expect(await checkForUpdate({ ...d, fetch: noTag as unknown as typeof fetch })).toBeNull();
    expect(await getUpdateCheckState()).toEqual({ checkedAt: 1_000 * HOUR });
  });

  it('checks again when the stored time is in the future (the clock went back)', async () => {
    data.updateCheckState = { checkedAt: 5_000 * HOUR, latest: 'v1.1.7' };
    const { d, fetchMock } = deps('v1.1.8', 1_000 * HOUR);
    expect(await checkForUpdate(d)).toBe('v1.1.8');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
