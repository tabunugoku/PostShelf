import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import {
  DEFAULT_AUTO_COLLECT, DEFAULT_SETTINGS, clearCollectCommand, getCollectRun, getSettings, peekCollectCommand, resetSettings, saveCollectRun, sendCollectCommand,
  setCollectOffer, updateAutoCollect, updateSettings,
} from '../src/shared/settings';

let data: Record<string, any>;
beforeEach(() => {
  data = installChromeMock() as Record<string, any>;
});

describe('v15-B-3: autoCollect settings', () => {
  it('defaults: enabled (but nothing starts by itself), slow, 300 per run, no offers recorded', async () => {
    expect(DEFAULT_AUTO_COLLECT).toEqual({ enabled: true, speed: 'slow', cap: 300, offers: {} });
    expect((await getSettings()).autoCollect).toEqual(DEFAULT_AUTO_COLLECT);
    expect(DEFAULT_SETTINGS.autoCollect).toEqual(DEFAULT_AUTO_COLLECT);
  });
  it('invalid stored values fall back to the defaults', async () => {
    data.settings = { autoCollect: { enabled: 'x', speed: 'fast', cap: 7, offers: { a: 'done', b: 'nope', c: 1 } } };
    expect((await getSettings()).autoCollect).toEqual({ enabled: true, speed: 'slow', cap: 300, offers: { a: 'done' } });
    data.settings = {}; // 古いデータ (v14 以前): autoCollect が無い
    expect((await getSettings()).autoCollect).toEqual(DEFAULT_AUTO_COLLECT);
  });
  it('updateAutoCollect and setCollectOffer change only their part', async () => {
    await updateSettings({ syncNative: true });
    await updateAutoCollect({ enabled: false, speed: 'normal', cap: 0 });
    await setCollectOffer('me', 'dismissed');
    await setCollectOffer('you', 'done');
    await setCollectOffer('you', null);
    const s = await getSettings();
    expect(s.syncNative).toBe(true);
    expect(s.autoCollect).toEqual({ enabled: false, speed: 'normal', cap: 0, offers: { me: 'dismissed' } });
  });
  it('「設定を初期の値に戻す」 resets autoCollect, but not the record of the run (collectRun)', async () => {
    await updateAutoCollect({ enabled: false, offers: { me: 'dismissed' } });
    await saveCollectRun({ status: 'paused', accountId: 'me', startedAt: 1, imported: 5, skipped: 2, failed: 0, speed: 'slow', cap: 300, updatedAt: 2 });
    await resetSettings();
    expect((await getSettings()).autoCollect).toEqual(DEFAULT_AUTO_COLLECT);
    expect(await getCollectRun()).toMatchObject({ status: 'paused', imported: 5, skipped: 2 });
  });
  it('collectRun / collectCommand round trip, with invalid values ignored', async () => {
    expect(await getCollectRun()).toBeNull();
    data.collectRun = { status: 'weird' };
    expect(await getCollectRun()).toBeNull();
    expect(await peekCollectCommand()).toBeNull();
    await sendCollectCommand({ type: 'start', consent: true, speed: 'normal', cap: 100, accountId: 'me' });
    const c = (await peekCollectCommand())!;
    expect(c).toMatchObject({ type: 'start', consent: true, speed: 'normal', cap: 100, accountId: 'me' });
    expect(Date.now() - c.at).toBeLessThan(1000);
    await clearCollectCommand();
    expect(await peekCollectCommand()).toBeNull();
    await sendCollectCommand({ type: 'pause' });
    expect((await peekCollectCommand())!.consent).toBe(false); // 同意の印が無いコマンドは、start として働かない
  });
});
