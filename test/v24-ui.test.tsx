import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextSection } from '../src/manager/FullText';
import { getSettings, saveFullTextRun } from '../src/shared/settings';
import { setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 25)));
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends Element>(s: string) => [...document.querySelectorAll<T>(s)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  installChromeMock();
  send = vi.fn(async () => undefined);
  (globalThis as any).chrome.runtime.sendMessage = send;
  document.body.innerHTML = '<div id="app"></div>';
  setAccountScope('me');
  for (let i = 1; i <= 3; i++) await setBookmarkFolders(String(i), [], { text: 't', author: 'A', handle: '@a', media: [], url: 'u', truncated: true });
  await setBookmarkFolders('9', [], { text: 'full', author: 'A', handle: '@a', media: [], url: 'u' });
  await act(() => void render(<FullTextSection />, $('#app')));
  await flush();
});
afterEach(() => render(null, $('#app')));

describe('v24-B: 設定「長いポストの全文」', () => {
  it('the switch is on by default (even when the setting was never saved), explains the terms note, and can be turned off', async () => {
    const sw = $<HTMLInputElement>('input[role=switch]');
    expect(sw.checked).toBe(true);
    expect($('.full-text').textContent).toContain('自動化されたアクセス');
    await act(async () => {
      sw.checked = false;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect((await getSettings()).fullText).toBe(false);
    expect($$('.ft-row')).toHaveLength(0); // オフのときは、件数と取得のボタンを出さない
  });

  it('shows the number of posts without full text; 「いま取得する」 asks once (count, takes time, background tab, terms), then asks the background', async () => {
    expect($('.ft-pending').textContent).toBe('全文を取得していないポスト: 3 件');
    await click($$('.ft-row button').find((b) => b.textContent?.includes('いま取得する'))!);
    const msg = $('[role=alertdialog] p').textContent!;
    expect(msg).toContain('3 件');
    expect(msg).toContain('取得には時間がかかり');
    expect(msg).toContain('裏のタブ');
    expect(msg).toContain('規約');
    expect(send).not.toHaveBeenCalled();
    await click($$('.dialog-actions button').find((b) => b.textContent === '取得を始める')!);
    expect(send).toHaveBeenCalledWith({ type: 'fetchFullText', kind: 'manual', accountId: 'me' });
  });

  it('cancelling the confirmation asks for nothing', async () => {
    await click($$('.ft-row button')[0]);
    await click($$('.dialog-actions button').find((b) => b.textContent === 'キャンセル')!);
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the progress and 「止める」 while running, and the stop reason afterwards', async () => {
    await saveFullTextRun({ running: true, kind: 'manual', total: 3, done: 1, failed: 0, updatedAt: 1 });
    await flush();
    expect($('.ft-progress').textContent).toBe('取得しています: 1 / 3 件');
    expect($$('.ft-row button').map((b) => b.textContent)).toEqual(['止める']);
    await click($('.ft-row button'));
    expect(send).toHaveBeenCalledWith({ type: 'stopFullText' });
    for (const [reason, text] of [['limit', '制限や警告'], ['failures', '続けて 3 件'], ['user', '取得を止めました']] as const) {
      await saveFullTextRun({ running: false, kind: 'manual', total: 3, done: 1, failed: 3, stopReason: reason, updatedAt: 2 });
      await flush();
      expect($('.full-text [role=status]').textContent).toContain(text);
    }
  });
});
