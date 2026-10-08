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
const iconBtns = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button[data-icon]')];
const swatches = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button[data-color]')].filter((b) => b.type === 'button' && !b.textContent);

describe('v19-1: 「フォルダを作成」メニュー', () => {
  it('icons: 8 buttons in one 8-column grid; each is a square grid-centered box holding one block-level icon; the label sits above the row', () => {
    const { el } = menu();
    const btns = iconBtns(el);
    expect(btns).toHaveLength(8);
    const grid = btns[0].parentElement!;
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(8,\s*1fr\)$/);
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

  it('bottom actions share one shape, in this order: フォルダを追加, サイドパネルで開く, a divider, PostShelf から外す (only when saved, red, with a trash icon)', async () => {
    await createFolder({ name: 'A' });
    injectButtons();
    const article = document.querySelector('article')!;
    const btn = document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
    const pop = (await openPopover(article, btn))!;
    const names = ['フォルダを追加', 'サイドパネルで開く', 'PostShelf から外す'];
    const bs = names.map((n) => [...pop.querySelectorAll('button')].find((b) => b.textContent === n)!);
    expect(bs.every(Boolean)).toBe(true);
    const order = [...pop.querySelectorAll('button')].filter((b) => names.includes(b.textContent!)).map((b) => b.textContent);
    expect(order).toEqual(names);
    for (const b of bs) {
      expect(b.firstElementChild!.tagName).toBe('I'); // アイコン + 文
      expect(b.style.display).not.toBe('block');
      expect(b.style.minHeight).toBe('36px');
    }
    expect(bs[2].style.display).toBe('none'); // 保存済みでないときは出ない
    expect(bs[2].previousElementSibling!.tagName).toBe('DIV'); // 区切り線
    expect((bs[2].previousElementSibling as HTMLElement).style.display).toBe('none');
    expect(bs[2].style.color).toBe('rgb(244, 33, 46)');
    expect(bs[2].firstElementChild!.className).toContain('ti-trash');
    // 保存すると、区切り線と「PostShelf から外す」が出る
    const cb = pop.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await tick();
    expect(await getBookmark('1234567890')).toBeTruthy();
    expect(bs[2].style.display).toBe('flex');
    expect((bs[2].previousElementSibling as HTMLElement).style.display).toBe('block');
  });
});

describe('v19-1: menu width in the manager', () => {
  it('menu-wide is at least 300px (or the screen width)', () => {
    const css = readFileSync('static/manager.css', 'utf8');
    expect(css).toMatch(/\.menu-wide\{min-width:min\(300px,calc\(100vw - 16px\)\)/);
  });
});
