// 版: v67-c
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons } from '../src/content/buttons';
import { installGlobalHandlers, openPopover } from '../src/content/popover';
import * as storage from '../src/shared/storage';

const html = readFileSync('test/fixtures/tweet.html', 'utf8');
const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
const article = () => document.querySelector('article')!;
const anchor = () => document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
const errorText = () => chrome.i18n.getMessage('errorStorage');

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = html;
  injectButtons();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('フォルダ一覧を読めないとき、errorStorage の role="alert" を出す', async () => {
  vi.spyOn(storage, 'listFolders').mockRejectedValue(new Error('read failed'));
  const pop = await openPopover(article(), anchor());
  expect(pop?.getAttribute('role')).toBe('alert');
  expect(document.querySelector('.postshelf-popover[role="alert"]')?.textContent).toBe(errorText());
});

it('失敗の表示は、外側のクリックと Esc で閉じる', async () => {
  vi.spyOn(storage, 'listFolders').mockRejectedValue(new Error('read failed'));
  installGlobalHandlers();
  await openPopover(article(), anchor());
  document.body.click();
  expect(document.querySelector('.postshelf-popover')).toBeNull();
  await openPopover(article(), anchor());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.querySelector('.postshelf-popover')).toBeNull();
});

it('フォルダの作成が普通の Error で失敗しても、フォームに errorStorage を出し、未処理の reject にしない', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  const pop = (await openPopover(article(), anchor()))!;
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('write failed'));
  [...pop.querySelectorAll('button')].find((b) => b.textContent === 'フォルダを追加')!.click();
  const form = pop.querySelector<HTMLFormElement>('form')!;
  form.querySelector('input')!.value = 'Sample X';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  process.off('unhandledRejection', unhandled);
  expect(form.textContent).toContain(errorText());
  expect(unhandled).not.toHaveBeenCalled();
});
