// 版: v77
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FullTextSection } from '../src/manager/FullText';
import * as settings from '../src/shared/settings';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 15)));
const hosts = () => [...document.querySelectorAll<HTMLFormElement>('form')];
const toggle = (host: Element) => host.querySelector<HTMLInputElement>('[role="switch"]')!;
const radio = (host: Element, name: string, value: string) =>
  host.querySelector<HTMLInputElement>('[name="' + name + '"][value="' + value + '"]')!;
const mount = async (reloadKey = 0) => {
  await act(() => {
    for (const host of hosts()) render(<FullTextSection reloadKey={reloadKey} />, host);
  });
  await flush();
};

beforeEach(() => {
  const data = installChromeMock();
  storage.setAccountScope('me');
  Object.assign(data, {
    schemaVersion: 2,
    folderIdsRepaired: true,
    settings: { ...settings.DEFAULT_SETTINGS },
    bookmarks: {
      'me:1': {
        accountId: 'me',
        tweetId: '1',
        folderIds: [],
        savedAt: 1,
        snapshot: {
          text: '全文の設定を確かめる架空の本文',
          author: 'サンプル',
          handle: '@sample_author',
          media: [],
          url: 'https://x.com/sample_author/status/1',
          truncated: true,
        },
      },
    },
  });
  // 別画面に相当するフォームに分け、同名のラジオ同士が DOM 上で干渉しないようにする。
  document.body.innerHTML = '<form id="manager"></form><form id="sidepanel"></form>';
});
afterEach(() => {
  act(() => {
    for (const host of hosts()) render(null, host);
  });
  vi.restoreAllMocks();
});

it.each([0, 1])('片方で全文取得をオフにすると、他方も設定通知だけでオフになる: %i', async (source) => {
  await mount();
  const sections = hosts();
  for (const host of sections) {
    expect(toggle(host).checked).toBe(true);
    expect(host.querySelector('.ft-row button')!.textContent).toContain(t('fullTextRunNow'));
  }
  const truncated = vi.spyOn(storage, 'listTruncated');
  const run = vi.spyOn(settings, 'getFullTextRun');
  const changed = vi.fn();
  const off = storage.onDataChanged(changed);
  try {
    await act(async () => {
      const input = toggle(sections[source]);
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    for (const host of sections) {
      expect(toggle(host).checked).toBe(false);
      expect(host.querySelector('.ft-row')).toBeNull();
      expect(host.querySelector('.ft-speed-setting')).toBeNull();
    }
    expect(changed).not.toHaveBeenCalled();
    expect(truncated).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  } finally {
    off();
  }
});

it.each([0, 1])('速さとタブ数も設定通知だけで両方に反映する: %i', async (source) => {
  await mount();
  const sections = hosts();
  const truncated = vi.spyOn(storage, 'listTruncated');
  const run = vi.spyOn(settings, 'getFullTextRun');
  const changed = vi.fn();
  const off = storage.onDataChanged(changed);
  try {
    await act(() => radio(sections[source], 'ft-speed', 'standard').click());
    await flush();
    for (const host of sections) {
      expect(radio(host, 'ft-speed', 'standard').checked).toBe(true);
      expect(radio(host, 'ft-tabs', '1').checked).toBe(true);
    }
    await act(() => radio(sections[source], 'ft-tabs', '3').click());
    await flush();
    for (const host of sections) expect(radio(host, 'ft-tabs', '3').checked).toBe(true);
    await act(async () => { await settings.updateSettings({ fullTextTabs: 2 }); });
    await flush();
    for (const host of sections) expect(radio(host, 'ft-tabs', '2').checked).toBe(true);
    await act(async () => { await settings.updateSettings({ fullTextSpeed: 'slow' }); });
    await flush();
    for (const host of sections) {
      expect(radio(host, 'ft-speed', 'slow').checked).toBe(true);
      expect(host.querySelector('.ft-tab-setting')).toBeNull();
    }
    expect(changed).not.toHaveBeenCalled();
    expect(truncated).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  } finally {
    off();
  }
});

it('読み直し時と画面を閉じたときに設定の購読を解除する', async () => {
  const subscribe = settings.onSettingsChanged;
  const callbacks = [] as ReturnType<typeof vi.fn>[];
  const offs = [] as ReturnType<typeof vi.fn>[];
  vi.spyOn(settings, 'onSettingsChanged').mockImplementation((cb) => {
    const callback = vi.fn(cb);
    const off = vi.fn(subscribe(callback));
    callbacks.push(callback);
    offs.push(off);
    return off;
  });
  await mount();
  expect(offs).toHaveLength(2);
  await mount(1);
  expect(offs).toHaveLength(4);
  for (const off of offs.slice(0, 2)) expect(off).toHaveBeenCalledTimes(1);
  act(() => {
    for (const host of hosts()) render(null, host);
  });
  for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
  await settings.updateSettings({ fullText: false });
  await flush();
  for (const callback of callbacks) expect(callback).not.toHaveBeenCalled();
});
