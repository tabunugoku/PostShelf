import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { injectButtons } from '../src/content/buttons';
import { openPopover } from '../src/content/popover';
import { createFolderPicker } from '../src/shared/folderPicker';
import { INBOX_ID } from '../src/shared/models';
import { createFolder, getBookmark, listBookmarks, listFolders, removeBookmark, setBookmarkFolders } from '../src/shared/storage';
import { FolderPickerHost } from '../src/manager/ui';
import { App } from '../src/manager/App';

const html = readFileSync('test/fixtures/tweet.html', 'utf8');
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const snap = { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1234567890' };
const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const boxes = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
const flip = async (cb: HTMLInputElement, v: boolean) => {
  cb.checked = v;
  cb.dispatchEvent(new Event('change'));
  await tick();
};

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = html;
});

describe('v15-A: save as 未分類', () => {
  it('with no folders at all, the popover has a 未分類 row (unchecked) and no "no folders" message; checking it saves the post', async () => {
    injectButtons();
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
    const rows = [...pop.querySelectorAll('label')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('未分類');
    expect(rows[0].querySelector('i')!.className).toContain('ti-inbox');
    expect(boxes(pop)[0].checked).toBe(false);
    expect(pop.textContent).not.toContain('フォルダを作ると');
    expect(await getBookmark('1234567890')).toBeUndefined();
    await flip(boxes(pop)[0], true);
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([INBOX_ID]);
    expect((await listFolders()).some((f) => f.id === INBOX_ID)).toBe(true); // 受け皿のフォルダも用意される
    // 保存済みであることがボタンに反映される
    const { refreshAll } = await import('../src/content/buttons');
    await refreshAll();
    expect(document.querySelector('[data-postshelf-btn]')!.hasAttribute('data-saved')).toBe(true);
  });

  it('未分類 and other folders are mutually exclusive (from either side) and the last folder falls back to 未分類', () => {
    const selected = new Set<string>();
    const changes: string[][] = [];
    const folders = [
      { id: 'a', name: 'A', icon: 'ti-code', order: 0 },
      { id: 'b', name: 'B', icon: 'ti-code', order: 1 },
    ];
    const { el } = createFolderPicker({ folders, selected, theme, onChange: (s) => void changes.push([...s]) });
    const [inbox, a, b] = boxes(el);
    const states = () => [inbox.checked, a.checked, b.checked];
    a.checked = true; a.dispatchEvent(new Event('change'));
    b.checked = true; b.dispatchEvent(new Event('change'));
    expect(states()).toEqual([false, true, true]);
    inbox.checked = true; inbox.dispatchEvent(new Event('change')); // 未分類 → 他は外れる
    expect(states()).toEqual([true, false, false]);
    expect([...selected]).toEqual([INBOX_ID]);
    a.checked = true; a.dispatchEvent(new Event('change')); // 他 → 未分類は外れる
    expect(states()).toEqual([false, true, false]);
    a.checked = false; a.dispatchEvent(new Event('change')); // 最後を外す → 未分類
    expect(states()).toEqual([true, false, false]);
    expect(changes.at(-1)).toEqual([INBOX_ID]);
  });

  it('the stored inbox folder is not listed twice (the picker draws its own 未分類 row first)', () => {
    const { el } = createFolderPicker({
      folders: [{ id: INBOX_ID, name: '', icon: 'ti-star', order: 5 }, { id: 'a', name: 'A', icon: 'ti-code', order: 0 }],
      selected: new Set(),
      theme,
      onChange: () => {},
    });
    expect([...el.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['未分類', 'A']);
  });

  it('setBookmarkFolders: [INBOX_ID] and [] both save as 未分類 (never delete); only removeBookmark deletes', async () => {
    expect((await setBookmarkFolders('1', [INBOX_ID], snap)).folderIds).toEqual([INBOX_ID]);
    expect((await setBookmarkFolders('2', [], snap)).folderIds).toEqual([INBOX_ID]);
    const f = await createFolder({ name: 'A' });
    expect((await setBookmarkFolders('3', [INBOX_ID, f.id], snap)).folderIds).toEqual([f.id]);
    expect((await listBookmarks()).length).toBe(3);
    await removeBookmark('1');
    expect((await getBookmark('1'))).toBeUndefined();
    expect((await listBookmarks()).length).toBe(2);
  });

  it('a saved post: unchecking the last folder makes it 未分類; "PostShelf の保存を削除" (shown only when saved) deletes it', async () => {
    const f = await createFolder({ name: 'A' });
    injectButtons();
    const article = document.querySelector('article')!;
    const btn = document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
    let pop = (await openPopover(article, btn))!;
    const unsave = () => pop.querySelector<HTMLElement>('button[aria-label="PostShelf の保存を削除"]')!;
    expect(unsave().style.display).toBe('none'); // 未保存のときは出ない
    await flip(boxes(pop)[1], true);
    expect(unsave().style.display).toBe('flex');
    await flip(boxes(pop)[1], false);
    expect(boxes(pop).map((c) => c.checked)).toEqual([true, false]);
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([INBOX_ID]);
    pop.remove();
    pop = (await openPopover(article, btn))!; // 開き直しても、保存済みなので出る
    expect(unsave().style.display).toBe('flex');
    unsave().click();
    await tick();
    expect(await getBookmark('1234567890')).toBeUndefined();
    expect(boxes(pop).some((c) => c.checked)).toBe(false);
    expect(unsave().style.display).toBe('none');
    void f;
  });

  it('opening and cancelling the 「フォルダを追加」 menu does not decide whether the post is saved', async () => {
    injectButtons();
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
    [...pop.querySelectorAll('button')].find((b) => b.textContent === 'フォルダを追加')!.click();
    pop.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); // 名前が空のまま
    await tick();
    expect(await getBookmark('1234567890')).toBeUndefined();
    [...pop.querySelectorAll('button')].find((b) => b.textContent === 'キャンセル')!.click();
    await flip(boxes(pop)[0], true);
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([INBOX_ID]);
  });
});

describe('v15-A: the same row in the manager and the side panel', () => {
  it('FolderPickerHost (used by 「フォルダを変更」 and 「いま開いているポストを保存」) shows 未分類 first, even with no folders', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const seen: string[][] = [];
    await act(() => void render(<FolderPickerHost folders={[]} selected={[]} onChange={(s) => void seen.push([...s])} />, document.getElementById('app')!));
    const rows = [...document.querySelectorAll('.picker-host label')];
    expect(rows.map((r) => r.textContent)).toEqual(['未分類']);
    await flip(boxes(document)[0], true);
    expect(seen.at(-1)).toEqual([INBOX_ID]);
  });

  it('manager: 「フォルダを変更」 moves a 未分類 post to a folder and back to 未分類 when the folder is unchecked', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const f = await createFolder({ name: 'Alpha' });
    await setBookmarkFolders('7', [INBOX_ID], { ...snap, url: 'https://x.com/a/status/7' });
    await act(() => void render(<App />, document.getElementById('app')!));
    await act(() => tick(30));
    const row = document.querySelector<HTMLElement>('[data-row="7"]')!;
    await act(() => void row.querySelector<HTMLElement>('[aria-label="フォルダを変更"]')!.click());
    await act(() => tick(30));
    let cbs = boxes(document.querySelector('.picker-host')!);
    expect(cbs.map((c) => c.checked)).toEqual([true, false]);
    await act(async () => { await flip(cbs[1], true); });
    expect((await getBookmark('7'))?.folderIds).toEqual([f.id]);
    cbs = boxes(document.querySelector('.picker-host')!);
    expect(cbs.map((c) => c.checked)).toEqual([false, true]);
    await act(async () => { await flip(cbs[1], false); });
    expect((await getBookmark('7'))?.folderIds).toEqual([INBOX_ID]);
  });
});
