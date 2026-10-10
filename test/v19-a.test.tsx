import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons } from '../src/content/buttons';
import { openPopover } from '../src/content/popover';
import { createFolderMenu } from '../src/shared/folderCreateMenu';
import { createFolderPicker } from '../src/shared/folderPicker';
import { createFolder, getBookmark, setAccountScope } from '../src/shared/storage';
import { COLORS } from '../src/shared/models';

const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const html = readFileSync('test/fixtures/tweet.html', 'utf8');

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  setAccountScope('me');
  document.body.innerHTML = html;
});

const menu = () => {
  const m = createFolderMenu({ theme, existing: () => [], onCreated: () => {}, onClose: () => {} });
  document.body.append(m.el);
  return m;
};
const iconBtns = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[data-main-icons] > button[data-icon]')];
const swatches = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button[data-color]')].filter((b) => b.type === 'button' && !b.textContent);

describe('v19-1: 「フォルダを作成」メニュー', () => {
  it('icons: 8 buttons plus More in one 9-column grid; each is a square grid-centered box holding one block-level icon; the label sits above the row', () => {
    const { el } = menu();
    const btns = iconBtns(el);
    expect(btns).toHaveLength(8);
    const grid = btns[0].parentElement!;
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(9,\s*1fr\)$/);
    expect(btns.every((b) => b.parentElement === grid)).toBe(true);
    for (const b of btns) {
      expect(b.style.display).toBe('grid');
      expect(b.style.placeItems).toBe('center');
      expect(b.style.aspectRatio).toBe('1');
      expect(b.style.padding).toMatch(/^0(px)?$/);
      expect(b.children).toHaveLength(1);
      const i = b.firstElementChild as HTMLElement;
      expect(i.style.display).toBe('block');
      expect(i.style.lineHeight).toBe('1');
      expect(i.style.position).toBe('static');
    }
    // ラベル (アイコン) は、グリッドの上 (同じ組の先頭)。列の左ではない
    const group = grid.parentElement!;
    expect(group.firstElementChild!.textContent).toBe('アイコン');
    expect(group.firstElementChild!.nextElementSibling).toBe(grid);
  });

  it('colors: 9 swatches (none + 8) in one 9-column grid, 20–24px wide circles; the label sits above', () => {
    const { el } = menu();
    const sw = swatches(el);
    expect(sw).toHaveLength(1 + COLORS.length);
    const grid = sw[0].parentElement!;
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(9,\s*1fr\)$/);
    expect(sw.every((b) => b.parentElement === grid)).toBe(true);
    expect(sw[1].style.width.replace(/\s/g, '')).toBe('clamp(20px,100%,24px)');
    expect(grid.parentElement!.firstElementChild!.textContent).toBe('色');
  });

  it('every part sets box-sizing / margin / font explicitly (so x.com CSS cannot leak in)', () => {
    const { el } = menu();
    for (const b of [...iconBtns(el), ...swatches(el), el.querySelector('input')!, ...el.querySelectorAll('button')]) {
      const st = (b as HTMLElement).style;
      expect(st.boxSizing).toBe('border-box');
      expect(st.margin).toMatch(/^0(px)?$/);
      expect(st.font).toBeTruthy();
    }
  });

  it('selection: the chosen icon gets a border + background, the chosen color a ring; the preview follows name, icon and color', () => {
    const m = menu();
    const el = m.el;
    const prev = () => el.querySelector<HTMLElement>('[aria-hidden=true]')!;
    expect(prev().textContent).toBe('フォルダ名'); // 空のときは、薄くして「フォルダ名」
    expect((prev().lastElementChild as HTMLElement).style.opacity).toBe('0.5');
    const book = el.querySelector<HTMLButtonElement>('button[data-icon="ti-book"]')!;
    book.click();
    expect(book.getAttribute('aria-pressed')).toBe('true');
    expect(book.style.borderColor).toBe('rgb(0, 102, 204)');
    expect(prev().firstElementChild!.className).toContain('ti-book');
    const blue = el.querySelector<HTMLButtonElement>('button[data-color="#378ADD"]')!;
    blue.click();
    expect(blue.style.outline).toContain('2px solid');
    expect((prev().firstElementChild as HTMLElement).style.color).toBe('rgb(55, 138, 221)');
    const input = el.querySelector('input')!;
    input.value = '読書';
    input.dispatchEvent(new Event('input'));
    expect(prev().textContent).toBe('読書');
    expect((prev().lastElementChild as HTMLElement).style.opacity).toBe('1');
    // 「作成」は、名前が空のときだけ押せない
    const create = [...el.querySelectorAll('button')].find((b) => b.textContent === '作成')!;
    expect(create.disabled).toBe(false);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(create.disabled).toBe(true);
  });
});

describe('v19-2: フォルダ一覧と下部の操作', () => {
  it('rows keep a real input[type=checkbox] (appearance:none) and mark the chosen rows', async () => {
    const f = await createFolder({ name: 'A' });
    const selected = new Set<string>([f.id]);
    const { el } = createFolderPicker({ folders: [f], selected, theme, onChange: () => {} });
    const rows = [...el.querySelectorAll('label')];
    expect(rows).toHaveLength(2);
    const cbs = rows.map((r) => r.querySelector('input')!);
    for (const cb of cbs) {
      expect(cb.type).toBe('checkbox');
      expect(cb.style.appearance === 'none' || cb.style.webkitAppearance === 'none' || cb.getAttribute('style')!.includes('appearance:none')).toBe(true);
    }
    expect(rows.map((r) => r.getAttribute('data-checked'))).toEqual(['false', 'true']);
    expect(rows[1].style.background).not.toBe('');
    expect(rows[0].style.background).toBe('');
    // 切り替えると、印と背景が追従する
    cbs[0].checked = true;
    cbs[0].dispatchEvent(new Event('change'));
    expect(rows.map((r) => r.getAttribute('data-checked'))).toEqual(['true', 'false']);
    expect(rows[0].style.background).not.toBe('');
    expect(rows[1].style.background).toBe('');
  });

  it('bottom: フォルダを追加 (icon + text), then a divider, then one row with two icon-only buttons: side panel (left) and delete (right, red, only when saved)', async () => {
    await createFolder({ name: 'A' });
    injectButtons();
    const article = document.querySelector('article')!;
    const btn = document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
    const pop = (await openPopover(article, btn))!;
    const add = [...pop.querySelectorAll('button')].find((b) => b.textContent === 'フォルダを追加')!;
    expect(add.firstElementChild!.tagName).toBe('I');
    const side = pop.querySelector<HTMLButtonElement>('button[aria-label="サイドパネルで開く"]')!;
    const del = pop.querySelector<HTMLButtonElement>('button[aria-label="PostShelf の保存を削除"]')!;
    for (const b of [side, del]) {
      expect(b.title).toBe(b.getAttribute('aria-label'));
      expect(b.textContent).toBe(''); // アイコンだけ
      expect(b.style.width).toBe('44px');
      expect(b.style.height).toBe('44px');
    }
    expect(side.firstElementChild!.className).toContain('ti-layout-sidebar-right');
    expect(del.firstElementChild!.className).toContain('ti-trash');
    expect(del.style.color).toBe('rgb(244, 33, 46)');
    expect(side.parentElement).toBe(del.parentElement);
    expect(side.parentElement!.style.justifyContent).toBe('space-between');
    expect(side.parentElement!.firstElementChild).toBe(side);
    expect(side.parentElement!.previousElementSibling!.tagName).toBe('DIV'); // 区切り線
    expect(del.style.display).toBe('none'); // 保存済みでないときは出ない
    const order = [...pop.querySelectorAll('button')];
    expect(order.indexOf(add)).toBeLessThan(order.indexOf(side));
    // 保存すると、削除のボタンが出る
    const cb = pop.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await tick();
    expect(await getBookmark('1234567890')).toBeTruthy();
    expect(del.style.display).toBe('flex');
  });
});

describe('v19-1: menu width in the manager', () => {
  it('menu-wide is at least 300px (or the screen width)', () => {
    const css = readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/\.menu-wide\{min-width:min\(300px,calc\(100vw - 16px\)\)/);
  });
});
