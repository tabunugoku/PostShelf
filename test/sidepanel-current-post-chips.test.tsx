// 版: v68-b
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { createFolder, getBookmark, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const chip = (name: string) => $$<HTMLElement>('.ap-chip').find((c) => c.textContent === name)!;

const snapshot = { text: '架空の本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/777' };

function installTabs() {
  const c = (globalThis as any).chrome;
  c.tabs = {
    query: async () => [{ id: 5, url: snapshot.url }],
    sendMessage: vi.fn(async (_id: number, m: unknown) =>
      (m as any).type === 'getPostSnapshot' ? { ok: true, tweetId: '777', snapshot } : { ok: true }),
    onActivated: { addListener() {}, removeListener() {} },
    onUpdated: { addListener() {}, removeListener() {} },
    create: async () => ({}),
  };
}

const mount = async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App surface="sidepanel" />, $('#app')));
  await flush();
  await flush();
  await flush();
};

describe('サイドパネルの「いま開いているポスト」のチップと親子', () => {
  let a: { id: string };
  let c: { id: string };
  beforeEach(async () => {
    installChromeMock();
    installPanelMock();
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    await noteAccount({ handle: 'me' });
    setAccountScope('me');
    a = await createFolder({ name: 'Sample A' });
    c = await createFolder({ name: 'Sample C', parentId: a.id });
    installTabs();
  });

  it('子に入っているポストで親のチップを外すと、親も子も外れて未分類になる', async () => {
    await setBookmarkFolders('777', [c.id], snapshot);
    await mount();
    expect(chip('Sample A').getAttribute('aria-pressed')).toBe('true');
    await act(() => void chip('Sample A').click());
    await flush();
    expect((await getBookmark('777'))!.folderIds).toEqual(['inbox']);
    expect(chip('Sample C').getAttribute('aria-pressed')).toBe('false');
  });

  it('子のチップをつけると、親も選択に入る', async () => {
    await mount();
    await act(() => void chip('Sample C').click());
    await flush();
    expect(chip('Sample A').getAttribute('aria-pressed')).toBe('true');
    expect(new Set((await getBookmark('777'))!.folderIds)).toEqual(new Set([a.id, c.id]));
  });

  it('保存の文言に、親のフォルダ名は出ない', async () => {
    await createFolder({ name: 'Sample E' });
    await setBookmarkFolders('777', [c.id], snapshot);
    await mount();
    await act(() => void chip('Sample E').click());
    await flush();
    const text = $('.active-post [role=status]').textContent!;
    expect(text).toContain('Sample C');
    expect(text).toContain('Sample E');
    expect(text).not.toContain('Sample A');
  });
});
