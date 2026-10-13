import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { MIME_POSTS } from '../src/manager/selection';
import * as storage from '../src/shared/storage';

const snap = { text: 'post 1', author: 'A', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const drop = async (el: Element, data: string) => {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(ev, { dataTransfer: { types: [MIME_POSTS], getData: (m: string) => (m === MIME_POSTS ? data : ''), setData() {} } });
  await act(() => void el.dispatchEvent(ev));
  await flush();
};
const rejections: unknown[] = [];
const onRejection = (e: PromiseRejectionEvent) => void rejections.push(e.reason);

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  storage.setAccountScope('unknown');
  rejections.length = 0;
  window.addEventListener('unhandledrejection', onRejection);
  await storage.createFolder({ name: 'Sample A' });
  await storage.setBookmarkFolders('1', [], snap);
  await act(() => void render(<App surface="tab" />, $('#app')));
  await flush();
  await flush();
});
afterEach(() => {
  render(null, $('#app'));
  window.removeEventListener('unhandledrejection', onRejection);
  vi.restoreAllMocks();
});

describe('v66-D: ドロップされた値の検証', () => {
  it.each(['not json', '{"a":1}', '[1,2]', 'null'])('ポスト ID の配列でない値 (%s) は、何もしない', async (raw) => {
    const add = vi.spyOn(storage, 'addToFolders');
    const change = vi.spyOn(storage, 'changeBookmarkFolders');
    const move = vi.spyOn(storage, 'moveToFolder');
    const row = $$('.fr').find((r) => r.textContent?.includes('Sample A'))!;
    await drop(row, raw);
    expect(rejections).toEqual([]);
    expect(add).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });

  it('正しい配列なら、これまでどおり追加する', async () => {
    const row = $$('.fr').find((r) => r.textContent?.includes('Sample A'))!;
    await drop(row, JSON.stringify(['1']));
    expect((await storage.getBookmark('1'))!.folderIds).toHaveLength(1);
  });
});
