import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { parsePostUrl } from '../src/shared/activeTab';
import { handleMessage, findArticle } from '../src/content/messages';
import { createFolder, getBookmark } from '../src/shared/storage';
import { updateSettings } from '../src/shared/settings';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const fixture = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');

const snapshot = { text: 'こんにちは 世界', author: '山田 太郎', handle: '@yamada', media: [], url: 'https://x.com/yamada/status/1234567890' };

function installTabs(url: string | undefined, reply: unknown) {
  const sent: unknown[] = [];
  const c = (globalThis as any).chrome;
  c.tabs = {
    query: async () => [{ id: 5, url }],
    sendMessage: vi.fn(async (_id: number, m: unknown) => {
      sent.push(m);
      if (reply instanceof Error) throw reply;
      return (m as any).type === 'getPostSnapshot' ? reply : { ok: true };
    }),
    onActivated: { addListener() {}, removeListener() {} },
    onUpdated: { addListener() {}, removeListener() {} },
    create: async () => ({}),
  };
  return { sent, c };
}

const mount = async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface="sidepanel" />, $('#app')));
  await flush();
  await flush(); // アクティブタブの問い合わせ (非同期) が終わるまで
};

describe('parsePostUrl', () => {
  it('matches x.com / twitter.com status URLs only', () => {
    expect(parsePostUrl('https://x.com/yamada/status/1234567890')).toBe('1234567890');
    expect(parsePostUrl('https://twitter.com/a/status/42?s=20')).toBe('42');
    expect(parsePostUrl('https://x.com/home')).toBeNull();
    expect(parsePostUrl('https://x.com/i/bookmarks')).toBeNull();
    expect(parsePostUrl('https://example.com/a/status/1')).toBeNull();
    expect(parsePostUrl(undefined)).toBeNull();
  });
});

describe('side panel "save the open post" button', () => {
  beforeEach(() => {
    installChromeMock();
    installPanelMock();
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  });

  it('is hidden on non-x.com tabs and on x.com pages that are not a post', async () => {
    installTabs('https://example.com/', { ok: false });
    await mount();
    expect($$('.cta').length).toBe(0);
    await act(() => void render(null, $('#app')));
    installTabs('https://x.com/home', { ok: false });
    await mount();
    expect($$('.cta').length).toBe(0);
  });

  it('is shown on x.com/*/status/*; pressing it asks the tab for a snapshot and opens the folder picker; checking saves it', async () => {
    const f = await createFolder({ name: 'Dev' });
    const { sent } = installTabs('https://x.com/yamada/status/1234567890', { ok: true, tweetId: '1234567890', snapshot });
    await mount();
    expect($('.cta').textContent).toContain('いま開いているポストを保存');
    await act(() => void $('.cta').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(sent[0]).toEqual({ type: 'getPostSnapshot', tweetId: '1234567890' });
    const cb = $$<HTMLLabelElement>('.pfoot label').find((l) => l.textContent?.includes('Dev'))!.querySelector('input')!;
    expect($$('.pfoot label').map((l) => l.textContent)).toContain('未分類'); // 受け皿も選べる
    expect(cb).toBeTruthy();
    await act(() => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });
    await flush();
    expect((await getBookmark('1234567890'))!.folderIds).toEqual([f.id]);
    expect((await getBookmark('1234567890'))!.snapshot.handle).toBe('@yamada');
    expect(sent).toContainEqual({ type: 'syncNative', tweetId: '1234567890', want: true });
  });

  it('shows a short error and saves nothing when the snapshot cannot be read', async () => {
    for (const reply of [{ ok: false }, new Error('Could not establish connection')]) {
      installChromeMock();
      installPanelMock();
      installTabs('https://x.com/yamada/status/1234567890', reply);
      await mount();
      await act(() => void $('.cta').dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await flush();
      expect($('.pfoot [role=alert]').textContent).toContain('読み取れませんでした');
      expect($$('.pfoot input[type=checkbox]').length).toBe(0);
      expect(await getBookmark('1234567890')).toBeUndefined();
      await act(() => void render(null, $('#app')));
    }
  });

  it('is not rendered in the tab surface', async () => {
    installTabs('https://x.com/yamada/status/1234567890', { ok: false });
    document.body.innerHTML = '<div id="app"></div>';
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush();
    expect($$('.cta').length).toBe(0);
  });
});

describe('content script message handler', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = fixture;
  });
  it('returns the snapshot of the matching post only', () => {
    const reply = vi.fn();
    handleMessage({ type: 'getPostSnapshot', tweetId: '1234567890' }, reply);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true, tweetId: '1234567890', snapshot: expect.objectContaining({ handle: '@yamada' }) }));
    const none = vi.fn();
    handleMessage({ type: 'getPostSnapshot', tweetId: '999' }, none);
    expect(none).toHaveBeenCalledWith({ ok: false });
    expect(findArticle('1234567890')).not.toBeNull();
  });
  it('syncNative clicks the native button once only when the setting is on', async () => {
    const native = document.querySelector<HTMLElement>('[data-testid=bookmark]')!;
    const spy = vi.fn();
    native.addEventListener('click', spy);
    const done = vi.fn();
    handleMessage({ type: 'syncNative', tweetId: '1234567890', want: true }, done);
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled(); // 連動オフ
    await updateSettings({ syncNative: true });
    handleMessage({ type: 'syncNative', tweetId: '1234567890', want: true }, done);
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('ignores unknown messages', () => {
    const reply = vi.fn();
    expect(handleMessage({ type: 'x' }, reply)).toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('permissions', () => {
  it('does not add the "tabs" permission (x.com host permission is enough to read the active tab URL)', () => {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8'));
    expect(m.permissions).not.toContain('tabs');
    expect(m.permissions).not.toContain('activeTab');
    expect(m.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*']);
  });
});
