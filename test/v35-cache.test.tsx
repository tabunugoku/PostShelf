import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { SettingsPage } from '../src/manager/Settings';
import { noteAccount, setAccountScope } from '../src/shared/storage';
import { clearStorageError, useStorageError } from '../src/manager/errorBus';
import { getSettings } from '../src/shared/settings';

const Probe = () => <i id="probe">{useStorageError() ? 'ERR' : 'ok'}</i>;
const flush = (ms = 40) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  vi.restoreAllMocks();
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
});

describe('v35-E: a failed image cache setting write', () => {
  it('shows the storage error, no "saved" message, and puts the value back; no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    clearStorageError();
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<><Probe /><SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} /></>, $('#app')));
    await flush(100);
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    (chrome.storage.local as any).set = async (o: any) => {
      if ('settings' in o) throw new Error('boom');
      return set(o);
    };
    const radio = $$<HTMLInputElement>('input[name=cacheQuality]').find((r) => !r.checked && !r.disabled);
    // 画像のキャッシュがオフのときは画質の選択が無効: 設定をオンにしておく
    if (!radio) {
      (chrome.storage.local as any).set = set;
      const { updateImageCache } = await import('../src/shared/settings');
      await updateImageCache({ enabled: true });
      document.body.innerHTML = '<div id="app"></div>';
      await act(() => void render(<><Probe /><SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} /></>, $('#app')));
      await flush(100);
      (chrome.storage.local as any).set = async (o: any) => {
        if ('settings' in o) throw new Error('boom');
        return set(o);
      };
    }
    const target = $$<HTMLInputElement>('input[name=cacheQuality]').find((r) => !r.checked && !r.disabled)!;
    expect(target).toBeTruthy();
    const before = (await getSettings()).imageCache.quality;
    const idx = () => $$<HTMLInputElement>('input[name=cacheQuality]').findIndex((r) => r.checked);
    const idxBefore = idx();
    await act(() => void target.click());
    await flush(150);
    expect((await getSettings()).imageCache.quality).toBe(before);
    expect(document.body.textContent).not.toContain('変更を保存しました');
    expect(idx()).toBe(idxBefore);
    expect($('#probe').textContent).toBe('ERR');
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
