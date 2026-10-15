// 版: v74
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { installGlobalHandlers, openPopover } from '../src/content/popover';
import * as storage from '../src/shared/storage';

let rect: DOMRect;
let naturalHeight: number;
let viewportHeight: number;
let article: Element;
let anchor: HTMLButtonElement;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
const move = (top: number) => {
  rect = { top, bottom: top + 32, left: 400, right: 432, width: 32, height: 32 } as DOMRect;
};
const frame = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(0));
};
const scroll = () => window.dispatchEvent(new Event('scroll'));

beforeAll(() => installGlobalHandlers());
beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = readFileSync('test/fixtures/save-menu.html', 'utf8');
  article = document.querySelector('article')!;
  anchor = article.querySelector('button')!;
  move(100);
  naturalHeight = 240;
  viewportHeight = 700;
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => rect);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockImplementation(() => viewportHeight);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('postshelf-popover')) {
      const limit = Number.parseFloat(this.style.maxHeight);
      return Number.isFinite(limit) ? Math.min(naturalHeight, limit) : naturalHeight;
    }
    if (this.classList.contains('postshelf-account')) return 40;
    if (this.hasAttribute('data-picker-header')) return 40;
    if (this.hasAttribute('data-popover-footer')) return 100;
    return 0;
  });
});

afterEach(() => {
  document.body.click();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('スクロール後のボタンの位置にメニューが追従する', async () => {
  const pop = (await openPopover(article, anchor))!;
  move(200);
  scroll();
  frame();
  expect(pop.style.top).toBe('236px');
});

it('複数の scroll と resize を 1 フレームにまとめる', async () => {
  const pop = (await openPopover(article, anchor))!;
  vi.mocked(anchor.getBoundingClientRect).mockClear();
  move(150);
  scroll();
  move(200);
  scroll();
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(1);
  frame();
  expect(anchor.getBoundingClientRect).toHaveBeenCalledTimes(1);
  expect(pop.style.top).toBe('236px');
});

it('要素内のスクロールも capture で受け取る', async () => {
  const pop = (await openPopover(article, anchor))!;
  move(200);
  article.dispatchEvent(new Event('scroll'));
  frame();
  expect(pop.style.top).toBe('236px');
});

it('開いたときの表示側を保ち、上の空きに合わせて上限を縮める', async () => {
  naturalHeight = 180;
  move(550);
  const pop = (await openPopover(article, anchor))!;
  expect(pop.style.top).toBe('366px');
  move(200);
  scroll();
  frame();
  expect(pop.style.top).toBe('16px');
  expect(pop.style.maxHeight).toBe('188px');
});

it('中央のメニューはスクロールしても動かない', async () => {
  naturalHeight = 500;
  move(334);
  const pop = (await openPopover(article, anchor))!;
  move(100);
  scroll();
  frame();
  expect(pop.style.top).toBe('100px');
  expect(pop.style.left).toBe('360px');
  expect(pop.isConnected).toBe(true);
});

it('resize だけでもボタンに追従し、下の空きに合わせて高さを縮める', async () => {
  manyFolders();
  const pop = (await openPopover(article, anchor))!;
  viewportHeight = 600;
  window.dispatchEvent(new Event('resize'));
  frame();
  expect(pop.style.top).toBe('136px');
  expect(pop.style.maxHeight).toBe('456px');
  expect(Number.parseFloat(pop.style.top) + pop.offsetHeight).toBe(592);
});

function manyFolders() {
  naturalHeight = 1400;
  vi.spyOn(storage, 'listFolders').mockResolvedValue(Array.from({ length: 40 }, (_, i) => ({
    id: `folder-${i}`, name: `Folder ${i}`, icon: 'ti-folder', order: i,
  })));
}

it('40 個の一覧が下の空きいっぱいでも、ボタンの移動に合わせて高さを縮める', async () => {
  manyFolders();
  const pop = (await openPopover(article, anchor))!;
  expect(pop.querySelectorAll('label')).toHaveLength(41);
  expect(pop.style.maxHeight).toBe('556px');
  move(150);
  scroll();
  frame();
  expect(pop.style.top).toBe('186px');
  expect(pop.style.maxHeight).toBe('506px');
  expect(Number.parseFloat(pop.style.top) + pop.offsetHeight).toBe(692);
});

it('下の空きが上部・下部・一覧 4 行の高さを下回ったら閉じる', async () => {
  manyFolders();
  const pop = (await openPopover(article, anchor))!;
  move(400);
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('下の空きが戻れば初回の上限まで高さを戻し、それ以上には広げない', async () => {
  manyFolders();
  const pop = (await openPopover(article, anchor))!;
  for (const [top, expectedLimit] of [[150, '506px'], [100, '556px'], [50, '556px']] as const) {
    move(top);
    scroll();
    frame();
    expect(pop.style.top).toBe(`${top + 36}px`);
    expect(pop.style.maxHeight).toBe(expectedLimit);
  }
});

it('上の空きいっぱいの一覧も高さを縮め、下端をボタンの 4px 上にそろえる', async () => {
  manyFolders();
  move(560);
  const pop = (await openPopover(article, anchor))!;
  expect(pop.style.maxHeight).toBe('548px');
  move(510);
  scroll();
  frame();
  expect(pop.style.maxHeight).toBe('498px');
  expect(Number.parseFloat(pop.style.top) + pop.offsetHeight).toBe(506);
  move(600);
  scroll();
  frame();
  expect(pop.style.maxHeight).toBe('548px');
  expect(Number.parseFloat(pop.style.top) + pop.offsetHeight).toBe(596);
});

it('上の空きが一覧 4 行を含む高さを下回ったら閉じる', async () => {
  manyFolders();
  move(560);
  const pop = (await openPopover(article, anchor))!;
  move(300);
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('小さな失敗メニューの閉じるしきい値は初回の本来の高さに抑える', async () => {
  naturalHeight = 60;
  vi.spyOn(storage, 'listFolders').mockRejectedValue(new Error('read failed'));
  move(580);
  const pop = (await openPopover(article, anchor))!;
  scroll();
  frame();
  expect(pop.getAttribute('role')).toBe('alert');
  expect(pop.isConnected).toBe(true);
  expect(pop.style.top).toBe('616px');
  move(600);
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('開き直すと古い予約を取り消し、新しいメニューだけを追従させる', async () => {
  const first = (await openPopover(article, anchor))!;
  scroll();
  const pending = [...frames.keys()][0];
  const second = (await openPopover(article, anchor))!;
  expect(first.isConnected).toBe(false);
  expect(cancelAnimationFrame).toHaveBeenCalledWith(pending);
  move(200);
  scroll();
  expect(frames.size).toBe(1);
  frame();
  expect(second.style.top).toBe('236px');
});

it.each([-33, 701])('ボタンが画面外に出たら閉じる (%s)', async top => {
  const pop = (await openPopover(article, anchor))!;
  move(top);
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('中央のメニューもボタンが画面外に出たら閉じる', async () => {
  naturalHeight = 500;
  move(334);
  const pop = (await openPopover(article, anchor))!;
  move(701);
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('ボタンが DOM から外れたら閉じる', async () => {
  const pop = (await openPopover(article, anchor))!;
  anchor.remove();
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('ボタンが元の投稿の外へ移されたら閉じる', async () => {
  const pop = (await openPopover(article, anchor))!;
  document.body.append(anchor);
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it('投稿の要素が別の tweetId に使い回されたら閉じる', async () => {
  const pop = (await openPopover(article, anchor))!;
  article.querySelector('a')!.setAttribute('href', '/sample_two/status/9876543210');
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});

it.each(['outside', 'escape', 'account', 'offscreen'])('%s で閉じるとリスナーと予約フレームを外す', async reason => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const pop = (await openPopover(article, anchor))!;
  scroll();
  const pending = [...frames.keys()][0];
  if (reason === 'outside') document.body.click();
  if (reason === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  if (reason === 'account') setCurrentAccount({ id: 'sample_two', handle: 'sample_two', lastSeenAt: 0 });
  if (reason === 'offscreen') {
    move(701);
    frame();
  }
  expect(pop.isConnected).toBe(false);
  for (const type of ['scroll', 'resize']) {
    const listener = add.mock.calls.find(call => call[0] === type)!;
    expect(listener).toBeDefined();
    expect(remove.mock.calls.some(call => call[0] === type && call[1] === listener[1])).toBe(true);
    if (type === 'scroll') {
      expect(listener[2]).toEqual({ capture: true, passive: true });
      expect(remove.mock.calls.find(call => call[0] === type)?.[2]).toBe(true);
    }
  }
  if (reason !== 'offscreen') expect(cancelAnimationFrame).toHaveBeenCalledWith(pending);
  expect(frames.size).toBe(0);
  expect(() => scroll()).not.toThrow();
  expect(frames.size).toBe(0);
});

it('保存データを読めないメニューも追従し、ボタンが外れたら閉じる', async () => {
  vi.spyOn(storage, 'listFolders').mockRejectedValue(new Error('read failed'));
  const pop = (await openPopover(article, anchor))!;
  move(200);
  scroll();
  frame();
  expect(pop.style.top).toBe('236px');
  anchor.remove();
  scroll();
  frame();
  expect(pop.isConnected).toBe(false);
});
