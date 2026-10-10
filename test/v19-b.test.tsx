import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { recordPending } from '../src/shared/settings';

const css = readFileSync('static/manager.css', 'utf8');
const snap = (n: number, extra: object = {}) => ({ text: `post ${n}`, author: 'A', handle: `@u${n}`, media: [], url: `https://x.com/u${n}/status/${n}`, ...extra });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const byText = (sel: string, text: string) => $$(sel).find((e) => e.textContent?.includes(text))!;

async function mount(surface: 'tab' | 'sidepanel', width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush();
}

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  await noteAccount({ handle: 'me' }, 1);
  setAccountScope('me');
  const f = await createFolder({ name: 'Alpha' });
  for (let i = 1; i <= 4; i++) await setBookmarkFolders(String(i), [f.id], snap(i, i === 1 ? { media: ['https://x/a.jpg'] } : {}));
});
afterEach(() => render(null, $('#app')));

describe('v19-3: サイドパネルの上部', () => {
  it('has no folder chip row; the filter chips are folded into a 「絞り込み」 button with a count badge', async () => {
    await mount('sidepanel', 400);
    expect($$('.scroll').length).toBe(0);
    expect($$('.chip.filter').filter((c) => !c.classList.contains('fbtn'))).toHaveLength(0); // 4 つの条件は畳まれている
    const btn = $('.fbtn');
    expect(btn.textContent).toContain('絞り込み');
    expect(btn.querySelector('.count-badge')).toBeNull();
    await click(btn);
    const names = $$('.menu-filter .chip.filter').map((c) => c.textContent!.trim());
    expect(names).toEqual(['画像あり', '動画あり', 'リンクあり', '投稿者で絞り込み']);
    await click(byText('.menu-filter .chip.filter', '画像あり'));
    expect($('.fbtn .count-badge').textContent).toBe('1');
    expect($$('[data-row]').length).toBe(1); // 絞り込みの動作は変わらない
    await click(byText('.menu-filter .chip.filter', 'リンクあり'));
    expect($('.fbtn .count-badge').textContent).toBe('2');
  });

  it('the header is two rows: [folder][search][open in tab] and [sort][filter]…[view switch]', async () => {
    await mount('sidepanel', 400);
    const head = $('.phead');
    const rows = [...head.children].filter((c) => !c.classList.contains('acct'));
    expect(rows.map((r) => r.className)).toEqual(['row', 'tools']);
    expect(rows[0].querySelector('.folder-btn')).toBeTruthy();
    expect(rows[0].querySelector('[aria-label="タブで開く"]')).toBeTruthy();
    expect(rows[1].querySelector('.sortbox')).toBeTruthy();
    expect(rows[1].querySelector('.fbtn')).toBeTruthy();
    expect(rows[1].querySelector('.seg')).toBeTruthy();
    // フォルダの切り替えは、ドロップダウンだけ (「すべて」「未分類」「最近の 7 日」を含む)
    await click($('.folder-btn'));
    const items = $$('.menu .menu-item').map((i) => i.textContent);
    expect(items.slice(0, 3).join('|')).toMatch(/すべて.*未分類.*最近の 7 日/);
  });

  it('the tab layout keeps the always-visible filter chips', async () => {
    await mount('tab', 1000);
    expect($$('.chips .chip.filter').length).toBeGreaterThanOrEqual(4);
    expect($$('.fbtn').length).toBe(0);
  });
});

describe('v19-5: グリッドのカード', () => {
  it('the check is a corner badge; the actions sit in the bottom row with the folder chips, never over the author name', async () => {
    await mount('tab', 1000);
    await click($('.seg button[aria-label="グリッド表示"]'));
    const card = $('.gc[data-row="2"]');
    const head = card.querySelector('.gc-head')!;
    const foot = card.querySelector('.gc-foot')!;
    const actions = card.querySelector('.row-actions')!;
    expect(foot.contains(actions)).toBe(true);
    expect(foot.querySelector('.act')).toBeTruthy(); // フォルダのチップと同じ行
    expect(head.contains(actions)).toBe(false);
    expect([...card.children].indexOf(head)).toBeLessThan([...card.children].indexOf(foot));
    expect(card.querySelector(':scope > .sel')).toBeTruthy(); // カードの角に置く (行の中ではない)
    // CSS: 操作ボタンはカードの上に重ねない / チェックは角の丸いバッジ / hover とフォーカスで出る
    expect(css).not.toMatch(/\.gc \.row-actions\{[^}]*position:absolute/);
    expect(css).toMatch(/\.gc \.sel\{[^}]*position:absolute;top:-12px;left:-12px/);
    expect(css).toMatch(/\.gc \.sel::before\{[^}]*border-radius:50%/);
    expect(css).toMatch(/\.layout-wide :is\(\.post,\.mini,\.gc\):focus-within \.row-actions\{visibility:visible/);
    expect(css).toMatch(/\.layout-wide \.gc:hover \.sel/);
    expect(css).not.toMatch(/\.gc\{[^}]*overflow:hidden/);
  });
});

describe('v19-6: 管理画面の上部', () => {
  const twoNotices = async () => {
    setAccountScope('unknown');
    await setBookmarkFolders('90', [], snap(90)); // 旧データ (アカウント未設定)
    setAccountScope('me');
    await recordPending('me', 12);
  };

  it('with two notices, one band is shown; 「他に 1 件」 switches to the next (account assignment first, then the import hint)', async () => {
    await twoNotices();
    await mount('tab', 1000);
    const bands = () => $$('.banner[role=region]');
    expect(bands()).toHaveLength(1);
    expect(bands()[0].textContent).toContain('アカウント未設定');
    expect(bands()[0].textContent).toContain('割り当て');
    const more = $('.banner-more');
    expect(more.textContent).toContain('他に 1 件');
    await click(more);
    expect(bands()).toHaveLength(1);
    expect(bands()[0].textContent).toContain('12 件');
    expect(bands()[0].querySelector('[aria-label=閉じる]')).toBeTruthy(); // 閉じる (×) の動作は、いまのまま
    await click(bands()[0].querySelector('[aria-label=閉じる]')!);
    expect(bands()).toHaveLength(1); // 閉じると、残りの帯に戻る
    expect(bands()[0].textContent).toContain('アカウント未設定');
    expect($$('.banner-more')).toHaveLength(0);
  });

  it('a single notice has no 「他に N 件」', async () => {
    await recordPending('me', 3);
    await mount('tab', 1000);
    expect($$('.banner[role=region]')).toHaveLength(1);
    expect($$('.banner-more')).toHaveLength(0);
  });

  it('the result band: 「閉じる」 sits in the same row as the sentence, at its right end', async () => {
    await chrome.storage.local.set({ collectRun: { status: 'done', accountId: 'me', startedAt: 1, imported: 5, skipped: 2, failed: 0, speed: 'slow', cap: 300, updatedAt: Date.now() } });
    await mount('tab', 1000);
    const head = $('.ac-progress .ac-head');
    expect(head.classList.contains('single')).toBe(true);
    expect([...head.children].map((c) => c.className.split(' ')[0])).toEqual(['ac-title', 'ac-row']);
    expect([...head.querySelectorAll('.ac-row button')].at(-1)!.textContent).toBe('閉じる'); // 取り込めた分があれば、その前に「仕分ける」
    expect(css).toMatch(/\.ac-head\.single\{flex-wrap:nowrap\}/);
    expect(css).toMatch(/\.ac-head \.ac-actions\{margin-left:auto/);
    await click([...head.querySelectorAll('.ac-row button')].at(-1)!);
    expect($$('.ac-progress')).toHaveLength(0); // 押すと画面から消える
    expect((await chrome.storage.local.get('collectRun')).collectRun).toBeUndefined(); // v22: 閉じると、結果の記録も消える
  });

  it('while running, the buttons are in the same flex row as the sentence (they wrap below only when they do not fit)', async () => {
    await chrome.storage.local.set({ collectRun: { status: 'running', accountId: 'me', startedAt: 1, imported: 5, skipped: 2, failed: 0, speed: 'slow', cap: 300, updatedAt: 9 } });
    await mount('tab', 1000);
    const head = $('.ac-progress .ac-head');
    expect(head.classList.contains('single')).toBe(false);
    expect(head.querySelectorAll('.ac-row button').length).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/\.ac-head\{display:flex;flex-wrap:wrap/);
  });

  it('the bulk bar became a 「N 件選択中 ⌄」 button at the right end of the filter row: hidden with no selection, three actions inside, the list does not move', async () => {
    await mount('tab', 1000);
    const row = $('.chips');
    expect($$('.bulk-btn')).toHaveLength(0);
    expect($$('.bulk')).toHaveLength(0);
    const rowsTop = () => $('.rows').getBoundingClientRect().top + [...$('.main').children].indexOf($('.rows'));
    const before = [...$('.main').children].map((c) => c.className);
    await click($$('.sel')[0]);
    expect(row.lastElementChild!.classList.contains('bulk-anchor')).toBe(true);
    expect($('.bulk-btn').textContent).toContain('1 件選択中');
    // 一覧の前にある部品の並びは、選択の前後で変わらない (= 一覧は下にずれない)
    expect([...$('.main').children].map((c) => c.className)).toEqual(before);
    void rowsTop;
    await click($('.bulk-btn'));
    const items = $$('.menu-bulk .menu-item').map((i) => i.textContent!.trim());
    expect(items).toEqual(['フォルダを変更', '削除', '選択解除']);
    expect($('.menu-bulk .danger-text').textContent).toContain('削除');
    // フォルダを変更 → 一覧が切り替わる
    await click(byText('.menu-bulk .menu-item', 'フォルダを変更'));
    expect($$('.menu-bulk label').map((i) => i.textContent!.trim())).toContain('Alpha');
  });
});
