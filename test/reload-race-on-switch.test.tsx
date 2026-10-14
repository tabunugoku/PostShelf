// 版: v66-a
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';

const snap = (n: number) => ({ text: `post ${n}`, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const rowIds = () => $$('[data-row]').map((r) => r.getAttribute('data-row')).sort();

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
});
afterEach(() => {
  render(null, $('#app'));
  vi.restoreAllMocks();
});

describe('v66-A: 古い読み直しが切替後の一覧を上書きしない', () => {
  it('A の読み直しが B への切替のあとに終わっても、B のポストが表示される', async () => {
    await storage.noteAccount({ handle: 'you' }, 1);
    await storage.noteAccount({ handle: 'me' }, 2);
    storage.setAccountScope('me');
    await storage.setBookmarkFolders('1', [], snap(1));
    storage.setAccountScope('you');
    await storage.setBookmarkFolders('2', [], snap(2));
    await storage.noteAccount({ handle: 'me' }, 99);
    await act(() => void render(<App surface="tab" />, $('#app')));
    await flush();
    await flush();
    expect(rowIds()).toEqual(['1']);

    // 次の 1 回の読み込みだけ、A (me) の内容を持ったまま終わりを遅らせる
    const real = storage.listBookmarksWithAccounts;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(storage, 'listBookmarksWithAccounts').mockImplementationOnce(async () => {
      const result = await real();
      await gate;
      return result;
    });
    // 別タブでの保存を模して、A の読み直しを走らせる
    await storage.setBookmarkFolders('3', [], snap(3));
    await flush();

    await click($('.acct-btn'));
    await click($$('.acct-main').find((x) => x.textContent?.includes('@you'))!);
    expect(rowIds()).toEqual(['2']);

    await act(async () => release());
    await flush();
    expect(rowIds()).toEqual(['2']);
  });
});
