// 版: v74
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { openPopover } from '../src/content/popover';
import * as storage from '../src/shared/storage';

let naturalHeight: number;
let rect: DOMRect;

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = readFileSync('test/fixtures/save-menu.html', 'utf8');
  naturalHeight = 900;
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(700);
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

afterEach(() => vi.restoreAllMocks());

async function open(top: number, height: number, left = 400) {
  naturalHeight = height;
  rect = { top, bottom: top + 32, left, right: left + 32, width: 32, height: 32 } as DOMRect;
  const article = document.querySelector('article')!;
  const anchor = article.querySelector('button')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => rect);
  return (await openPopover(article, anchor))!;
}

it('下に本来の高さが収まるときは下に出す', async () => {
  const pop = await open(100, 240);
  expect(pop.style.top).toBe('136px');
  expect(pop.style.maxHeight).toBe('556px');
  expect(pop.style.left).toBe('276px');
});

it('下には収まらず上に収まるときは上に出す', async () => {
  const pop = await open(550, 300);
  expect(pop.style.top).toBe('246px');
  expect(pop.style.maxHeight).toBe('538px');
});

it.each([
  { top: 100, expectedTop: '136px', expectedLimit: '556px' },
  { top: 560, expectedTop: '8px', expectedLimit: '548px' },
])('どちらにも収まらなければ広い側を使う ($top)', async ({ top, expectedTop, expectedLimit }) => {
  const pop = await open(top, 900);
  expect(pop.style.top).toBe(expectedTop);
  expect(pop.style.maxHeight).toBe(expectedLimit);
  expect(Number.parseFloat(pop.style.top) + pop.offsetHeight).toBeLessThanOrEqual(692);
});

it('上部と下部と一覧 4 行が両側に入らなければ中央に出す', async () => {
  const pop = await open(334, 900);
  expect(pop.style.top).toBe('8px');
  expect(pop.style.left).toBe('360px');
  expect(pop.style.maxHeight).toBe('684px');
});

it('中央では制限より短いメニューを縦にも中央揃えする', async () => {
  const pop = await open(334, 500);
  expect(pop.style.top).toBe('100px');
  expect(pop.style.left).toBe('360px');
  expect(pop.style.maxHeight).toBe('684px');
});

it.each([
  { left: 0, expected: '8px' },
  { left: 980, expected: '712px' },
])('横は画面の端から 8px 内に収める ($left)', async ({ left, expected }) => {
  const pop = await open(100, 240, left);
  expect(pop.style.left).toBe(expected);
});

it('保存データを読めないメニューも同じ空きの計算を使う', async () => {
  vi.spyOn(storage, 'listFolders').mockRejectedValue(new Error('read failed'));
  const pop = await open(560, 900);
  expect(pop.getAttribute('role')).toBe('alert');
  expect(pop.style.top).toBe('8px');
  expect(pop.style.maxHeight).toBe('548px');
});
