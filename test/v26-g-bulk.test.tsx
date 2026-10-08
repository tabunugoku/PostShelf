import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { createFolder, listBookmarks, setBookmarkFolders } from '../src/shared/storage';

const snap = (n: number) => ({ text: `post ${n}`, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}` });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  const a = (await createFolder({ name: 'Alpha' })).id;
  for (let i = 1; i <= 3; i++) await setBookmarkFolders(String(i), [a], snap(i));
  await act(() => void render(<App />, $('#app')));
  await flush();
});
afterEach(() => render(null, $('#app')));

describe('v26-G: a failed bulk operation is reported', () => {
  it('shows the storage error as a notice, and the list is reloaded (no stale view, no unhandled rejection)', async () => {
    await click($$('.sel')[0]);
    await click($$('.sel')[1]);
    await click($('.bulk-btn'));
    await click($$('.menu-bulk .menu-item').find((x) => x.textContent?.includes('削除'))!);
    const real = chrome.storage.local.set;
    chrome.storage.local.set = async () => {
      throw new Error('QUOTA_BYTES quota exceeded');
    };
    await click($$('.dialog-actions button')[1]);
    chrome.storage.local.set = real;
    expect($('.toast').textContent).toContain('保存または読み込みに失敗しました');
    expect((await listBookmarks()).length).toBe(3);
    expect($$('[data-row]').length).toBe(3);
  });
});
