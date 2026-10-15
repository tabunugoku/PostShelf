// 版: v74
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { openPopover } from '../src/content/popover';
import { createFolderPicker } from '../src/shared/folderPicker';
import * as storage from '../src/shared/storage';

const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const folders = Array.from({ length: 40 }, (_, i) => ({
  id: `f${i}`, name: `Folder ${i}`, icon: 'ti-folder', order: i,
  parentId: i === 1 ? 'f0' : undefined,
}));

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = readFileSync('test/fixtures/save-menu.html', 'utf8');
  vi.spyOn(storage, 'listFolders').mockResolvedValue(folders);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(700);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280);
});

afterEach(() => vi.restoreAllMocks());

async function open() {
  const article = document.querySelector('article')!;
  const anchor = article.querySelector('button')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    top: 80, bottom: 112, left: 400, right: 432, width: 32, height: 32,
  } as DOMRect);
  return (await openPopover(article, anchor))!;
}

it('40 個の一覧だけをスクロールさせ、追加ボタンを下部に置く', async () => {
  const pop = await open();
  const list = pop.querySelector<HTMLElement>('[data-picker-list]')!;
  expect(pop.style.display).toBe('flex');
  expect(pop.style.maxHeight).not.toBe('');
  expect(list?.style.overflowY).toBe('auto');
  expect(list.style.minHeight).toBe('0');
  expect(list.style.overscrollBehavior).toBe('contain');
  expect(list.querySelectorAll('label')).toHaveLength(41);
  const add = [...pop.querySelectorAll('button')].find(b => b.textContent === 'フォルダを追加')!;
  expect(list.contains(add)).toBe(false);
  expect(add.closest('[data-popover-footer]')).not.toBeNull();
});

it('作成フォームの入力だけをスクロールさせ、確定行を固定する', async () => {
  const pop = await open();
  [...pop.querySelectorAll('button')].find(b => b.textContent === 'フォルダを追加')!.click();
  const form = pop.querySelector('form')!;
  const body = form.querySelector<HTMLElement>('[data-folder-fields]')!;
  const actions = form.querySelector<HTMLElement>('[data-folder-actions]')!;
  expect(body?.style.overflowY).toBe('auto');
  expect(actions.style.flexShrink).toBe('0');
  expect(actions.parentElement).toBe(form);
  expect(body.contains(actions)).toBe(false);
  expect(actions.querySelector('button[type=submit]')?.textContent).toBe('作成');
  form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(pop.isConnected).toBe(true);
  expect(form.hidden).toBe(true);
});

it('管理画面用は追加ボタンが一覧の末尾にあり、作成のレイアウトも変えない', () => {
  const picker = createFolderPicker({ folders, selected: new Set(), theme, onChange: () => {} });
  document.body.append(picker.el);
  const list = picker.el.children[1] as HTMLElement;
  const add = list.lastElementChild as HTMLButtonElement;
  expect(add.textContent).toBe('フォルダを追加');
  expect(list.style.overflowY).toBe('');
  add.click();
  expect(picker.el.querySelector('form')!.style.display).toBe('grid');
  expect(picker.el.querySelector('[data-folder-fields]')).toBeNull();
});
