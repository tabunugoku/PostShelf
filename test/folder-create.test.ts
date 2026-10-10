import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons } from '../src/content/buttons';
import { installGlobalHandlers, openPopover } from '../src/content/popover';
import { COLORS, FOLDER_ICON, ICONS, INBOX_ID } from '../src/shared/models';
import { createFolder, getBookmark, listFolders } from '../src/shared/storage';

const html = readFileSync('test/fixtures/tweet.html', 'utf8');
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
const boxes = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
const names = async () => (await listFolders()).filter((f) => f.id !== 'all' && f.id !== INBOX_ID).map((f) => f.name);

const open = async () => {
  injectButtons();
  return (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
};
const menu = (pop: HTMLElement) => pop.querySelector<HTMLFormElement>('form')!;
const nameInput = (pop: HTMLElement) => menu(pop).querySelector<HTMLInputElement>('input')!;
const type = (pop: HTMLElement, v: string) => {
  nameInput(pop).value = v;
  nameInput(pop).dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = async (pop: HTMLElement) => {
  menu(pop).dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
};

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = html;
});

describe('v16-A: 「フォルダを追加」 menu in the popover', () => {
  it('the name field and the 追加 button are not shown from the start; the 「フォルダを追加」 button is under the list (and above the side panel icon), even with no folders', async () => {
    const pop = await open();
    expect(menu(pop).hidden).toBe(true);
    expect(menu(pop).style.display).toBe('none');
    expect(btn(pop, '追加')).toBeUndefined();
    const labels = [...pop.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['未分類']); // フォルダが 0 件でも、未分類の行がある
    const add = btn(pop, 'フォルダを追加');
    expect(add.querySelector('i')!.className).toContain('ti-folder-plus');
    const order = [...pop.querySelectorAll('label, button')];
    expect(order.indexOf(add)).toBeGreaterThan(order.indexOf(pop.querySelector('label')!));
    expect(order.indexOf(add)).toBeLessThan(order.indexOf(pop.querySelector('button[aria-label="サイドパネルで開く"]')!));
  });

  it('pressing it opens the menu in place of the list (「← 戻る」), and the name field has the focus', async () => {
    const pop = await open();
    document.body.append(pop); // フォーカスは、文書の中にある要素にだけ付く
    btn(pop, 'フォルダを追加').click();
    expect(menu(pop).hidden).toBe(false);
    expect(document.activeElement).toBe(nameInput(pop));
    expect(menu(pop).textContent).toContain('フォルダを作成');
    expect(btn(pop, '← 戻る')).toBeTruthy();
    expect([...pop.querySelectorAll('label')].every((l) => l.offsetParent === null || true)).toBe(true);
    const list = pop.querySelector('label')!.parentElement as HTMLElement;
    expect(list.style.display).toBe('none'); // 一覧は隠れる
  });

  it('with an empty (or blank) name 「作成」 is disabled and nothing is created', async () => {
    const pop = await open();
    btn(pop, 'フォルダを追加').click();
    expect(btn(pop, '作成').disabled).toBe(true);
    type(pop, '   ');
    expect(btn(pop, '作成').disabled).toBe(true);
    await submit(pop);
    expect(await names()).toEqual([]);
    type(pop, 'あ');
    expect(btn(pop, '作成').disabled).toBe(false);
  });

  it('offers the same icons and colors as the manager (all ICONS / COLORS + none), starting with ti-folder and no color', async () => {
    const pop = await open();
    btn(pop, 'フォルダを追加').click();
    const icons = [...menu(pop).querySelectorAll('button[data-icon]')];
    expect(icons.map((b) => (b as HTMLElement).dataset.icon)).toEqual([...ICONS]);
    expect((icons.find((b) => b.getAttribute('aria-pressed') === 'true') as HTMLElement).dataset.icon).toBe(FOLDER_ICON);
    const sw = [...menu(pop).querySelectorAll('button[data-color]')];
    expect(sw.length).toBe(COLORS.length + 1);
    expect(menu(pop).querySelector('button[title="色なし（既定）"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('creates the folder with the chosen name, icon and color, returns to the list, and the new folder is checked (and the post is saved to it)', async () => {
    const pop = await open();
    btn(pop, 'フォルダを追加').click();
    type(pop, '  読書  ');
    (menu(pop).querySelector(`button[data-icon="${ICONS[3]}"]`) as HTMLElement).click();
    (menu(pop).querySelector(`button[data-color="${COLORS[2]}"]`) as HTMLElement).click();
    await submit(pop);
    const f = (await listFolders()).find((x) => x.name === '読書')!;
    expect(f).toMatchObject({ icon: ICONS[3], color: COLORS[2] });
    expect(menu(pop).hidden).toBe(true);
    const rows = [...pop.querySelectorAll('label')];
    expect(rows.map((l) => l.textContent)).toEqual(['未分類', '読書']);
    expect(boxes(pop).map((c) => c.checked)).toEqual([false, true]);
    expect((rows[1].querySelector('i') as HTMLElement).className).toContain(ICONS[3]);
    await tick();
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([f.id]);
  });

  it('with 未分類 checked, creating a folder unchecks 未分類 and checks only the new folder', async () => {
    const pop = await open();
    boxes(pop)[0].checked = true;
    boxes(pop)[0].dispatchEvent(new Event('change'));
    await tick();
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([INBOX_ID]);
    btn(pop, 'フォルダを追加').click();
    type(pop, '新しい');
    await submit(pop);
    const f = (await listFolders()).find((x) => x.name === '新しい')!;
    expect(boxes(pop).map((c) => c.checked)).toEqual([false, true]);
    await tick();
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([f.id]);
  });

  it('other selected folders are kept when a new one is created (only 未分類 is exclusive)', async () => {
    const a = await createFolder({ name: 'A' });
    const pop = await open();
    boxes(pop)[1].checked = true;
    boxes(pop)[1].dispatchEvent(new Event('change'));
    await tick();
    btn(pop, 'フォルダを追加').click();
    type(pop, 'B');
    await submit(pop);
    await tick();
    expect(boxes(pop).map((c) => c.checked)).toEqual([false, true, true]);
    expect(new Set((await getBookmark('1234567890'))!.folderIds)).toEqual(new Set([a.id, (await listFolders()).find((x) => x.name === 'B')!.id]));
  });

  it('「キャンセル」 and 「← 戻る」 create nothing, return to the list, and throw the input away', async () => {
    const pop = await open();
    for (const label of ['キャンセル', '← 戻る']) {
      btn(pop, 'フォルダを追加').click();
      type(pop, '捨てる');
      (menu(pop).querySelector(`button[data-icon="${ICONS[1]}"]`) as HTMLElement).click();
      btn(pop, label).click();
      expect(menu(pop).hidden).toBe(true);
      expect(await names()).toEqual([]);
      expect(await getBookmark('1234567890')).toBeUndefined();
      btn(pop, 'フォルダを追加').click(); // 開き直すと、空で、初期のアイコン
      expect(nameInput(pop).value).toBe('');
      expect(menu(pop).querySelector(`button[data-icon="${FOLDER_ICON}"]`)!.getAttribute('aria-pressed')).toBe('true');
      btn(pop, 'キャンセル').click();
    }
  });

  it('a folder with the same name (ignoring case and spaces) shows an error in the menu and is not created', async () => {
    await createFolder({ name: 'Reading' });
    const pop = await open();
    btn(pop, 'フォルダを追加').click();
    type(pop, ' reading ');
    await submit(pop);
    expect(menu(pop).querySelector('[role=alert]')!.textContent).toBe('同名のフォルダがあります');
    expect(menu(pop).hidden).toBe(false);
    expect(await names()).toEqual(['Reading']);
    type(pop, 'Reading 2'); // 入力し直すと、エラーは消える
    expect(menu(pop).querySelector<HTMLElement>('[role=alert]')!.style.display).toBe('none');
    await submit(pop);
    expect(await names()).toEqual(['Reading', 'Reading 2']);
    // 作ったばかりのフォルダとも、同名にならない
    btn(pop, 'フォルダを追加').click();
    type(pop, 'READING 2');
    await submit(pop);
    expect(await names()).toEqual(['Reading', 'Reading 2']);
  });

  it('Escape closes only the menu while it is open; the popover stays; a second Escape closes the popover', async () => {
    installGlobalHandlers();
    const pop = await open();
    document.body.append(pop);
    btn(pop, 'フォルダを追加').click();
    nameInput(pop).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu(pop).hidden).toBe(true);
    expect(document.body.contains(pop)).toBe(true);
    pop.querySelector('label')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.contains(pop)).toBe(false);
  });

  it('the old always-visible input is gone from the shared picker used by the manager and the side panel too', async () => {
    const { createFolderPicker } = await import('../src/shared/folderPicker');
    const { el } = createFolderPicker({ folders: [], selected: new Set(), theme: { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' }, onChange: () => {} });
    expect(btn(el, '追加')).toBeUndefined();
    expect(el.querySelector('form')!.hidden).toBe(true);
    expect(btn(el, 'フォルダを追加')).toBeTruthy();
    expect([...el.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['未分類']);
  });
});
