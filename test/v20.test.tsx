import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { mediaKindOf } from '../src/manager/Cards';
import { noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { updateSettings } from '../src/shared/settings';

const css = readFileSync('static/manager.css', 'utf8');
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const key = async (k: string) => {
  await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
  await flush();
};
const img = (n: string) => `https://pbs.twimg.com/media/${n}`;
const snap = (id: string, extra: object = {}) => ({ text: `post ${id}`, author: 'A', handle: `@u${id}`, media: [] as string[], url: `https://x.com/u${id}/status/${id}`, ...extra });
/** v: 動画 (サムネイルあり) / w: 動画 (サムネイルなし) / i3: 画像 3 枚 / i1: 画像 1 枚 / n: メディアなし / old: 動画かもしれないが、hasVideo が無い / vt: 動画で、media に動画のサムネイルが入っている */
const posts: Record<string, object> = {
  v: { hasVideo: true, videoPoster: img('poster.jpg') },
  w: { hasVideo: true },
  i3: { media: [img('a'), img('b'), img('c')] },
  i1: { media: [img('a')] },
  n: {},
  old: {},
  vt: { hasVideo: true, media: [img('thumb1'), img('thumb2')], videoPoster: img('poster.jpg') },
};

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  await noteAccount({ handle: 'me' }, 1);
  setAccountScope('me');
  for (const [id, extra] of Object.entries(posts)) await setBookmarkFolders(id, [], snap(id, extra));
  const data = (await chrome.storage.local.get('bookmarks')).bookmarks as Record<string, any>;
  Object.values(data).forEach((b, i) => (b.savedAt = 100 - i));
  await chrome.storage.local.set({ bookmarks: data });
});
afterEach(() => render(null, $('#app')));

const mount = async (surface: 'tab' | 'sidepanel', width: number, view?: 'post' | 'list' | 'grid') => {
  if (view) await updateSettings({ viewMode: view });
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  await act(() => void render(<App surface={surface} />, $('#app')));
  await flush();
  await flush();
};
const row = (id: string) => $(`[data-row="${id}"]`);

describe('v20-9: 動画と画像の札 (判定)', () => {
  it('mediaKindOf: video by hasVideo only; images only when 2 or more and not a video; unknown stays unmarked', () => {
    expect(mediaKindOf(snap('x', posts.v) as never)).toEqual({ kind: 'video' });
    expect(mediaKindOf(snap('x', posts.vt) as never)).toEqual({ kind: 'video' }); // 動画のサムネイルは、枚数に数えない
    expect(mediaKindOf(snap('x', posts.i3) as never)).toEqual({ kind: 'images', count: 3 });
    expect(mediaKindOf(snap('x', posts.i1) as never)).toBeNull();
    expect(mediaKindOf(snap('x') as never)).toBeNull();
    expect(mediaKindOf(snap('x', { hasVideo: false, media: [] }) as never)).toBeNull();
  });
});

describe.each([
  ['tab', 1000],
  ['sidepanel', 400],
] as const)('v20-9: 札の表示 (%s)', (surface, width) => {
  it('grid: 動画の札 + 再生ボタン / 画像 2 枚以上だけ枚数の札 / 動画のサムネイルなしは暗い面 / 未判定には付かない', async () => {
    await mount(surface, width, 'grid');
    for (const id of ['v', 'w', 'vt']) {
      const tile = row(id).querySelector('.ph.v')!;
      expect(tile.querySelector('.play')).toBeTruthy();
      const badge = tile.querySelector('.badge')!;
      expect(badge.getAttribute('aria-label')).toBe('動画');
      expect(badge.textContent?.trim()).toBe('動画');
      expect(badge.querySelector('.ti-video')).toBeTruthy();
      expect(tile.querySelector('.cnt')).toBeNull(); // 動画のポストには枚数の札を付けない
    }
    expect(row('v').querySelector('.ph.v img')).toBeTruthy();
    expect(row('w').querySelector('.ph.v img')).toBeNull(); // サムネイルなし: 暗い面 (.ph.v の背景) に再生ボタンと札だけ
    expect(css).toMatch(/\.ph\.v\{[^}]*background:linear-gradient\(135deg,#14171a,#3b4a57\)/);
    const cnt = row('i3').querySelector('.ph .cnt')!;
    expect(cnt.getAttribute('aria-label')).toBe('画像 3 枚');
    expect(cnt.textContent?.trim()).toBe('3');
    for (const id of ['i1', 'n', 'old']) {
      expect(row(id).querySelector('.ph .cnt, .ph .badge, .mk')).toBeNull();
      expect(row(id).querySelector('.play')).toBeNull();
    }
  });

  it('list: 行の右端に、動画は青い塗りの「動画」、画像は枠だけの「アイコン + 枚数」。1 枚・メディアなし・未判定には付かない', async () => {
    await mount(surface, width, 'list');
    for (const id of ['v', 'w', 'vt']) {
      const mk = row(id).querySelector('.mk')!;
      expect(mk.classList.contains('v')).toBe(true);
      expect(mk.getAttribute('aria-label')).toBe('動画');
      expect(mk.querySelector('.ti-video')).toBeTruthy();
      expect(row(id).querySelectorAll('.mk')).toHaveLength(1);
    }
    const mk = row('i3').querySelector('.mk')!;
    expect(mk.classList.contains('v')).toBe(false);
    expect(mk.getAttribute('aria-label')).toBe('画像 3 枚');
    expect(mk.textContent?.trim()).toBe('3');
    expect(mk.querySelector('.ti-photo')).toBeTruthy();
    for (const id of ['i1', 'n', 'old']) expect(row(id).querySelector('.mk')).toBeNull();
    expect(row('v').querySelector('.t')!.nextElementSibling!.classList.contains('mk')).toBe(true); // 本文のあと、操作ボタンの前
  });

  it('post view: 動画のポストは再生ボタンと札 (クリックの動作はこれまでどおり)。未判定には付かない', async () => {
    await mount(surface, width, 'post');
    for (const id of ['v', 'w', 'vt']) {
      expect(row(id).querySelector('.ph.v .play')).toBeTruthy();
      expect(row(id).querySelector('.ph.v .badge')!.getAttribute('aria-label')).toBe('動画');
      expect(row(id).querySelectorAll('.media .ph')).toHaveLength(1); // 動画のサムネイルを、画像として並べない
    }
    expect(row('old').querySelector('.badge, .play')).toBeNull();
    await click(row('v').querySelector('.ph.v')!);
    expect($('[role=dialog].viewer').textContent).toContain('動画は X で再生します');
  });
});

describe('v20-10: サイドパネルの複数選択', () => {
  it('selecting shows 「N 件選択中 ⌄」 in the sort row (no tall button column), opens four actions, and the list does not move', async () => {
    await mount('sidepanel', 400, 'list');
    expect($$('.bulk-btn')).toHaveLength(0);
    const head = $('.phead');
    const shape = () => [...head.children].map((c) => c.className);
    const before = shape();
    const mainBefore = [...$('.pbody').children].map((c) => c.className);
    await click(row('v').querySelector('.sel') ?? (await (async () => { await act(() => void row('v').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))); return row('v'); })()));
    // 長押し / チェックで選択できなければ、「選択」メニューから始める
    if (!$$('.bulk-btn').length) {
      await click(row('v').querySelector('[aria-label="その他の操作"]')!);
      await click($$('.menu-card .menu-item').find((i) => i.textContent?.includes('選択'))!);
    }
    expect($('.tools .bulk-btn').textContent).toContain('1 件選択中');
    expect($$('.bulk')).toHaveLength(0);
    expect(shape()).toEqual(before); // 上部の段の数は変わらない
    expect([...$('.pbody').children].map((c) => c.className)).toEqual(mainBefore); // 一覧の前に、新しい段が入らない
    await click($('.bulk-btn'));
    expect($$('.menu-bulk .menu-item').map((i) => i.textContent!.trim())).toEqual(['フォルダを変更', '削除', 'すべて選択', '選択解除']);
    await click($$('.menu-bulk .menu-item').find((i) => i.textContent?.includes('選択解除'))!);
    expect($$('.bulk-btn')).toHaveLength(0);
  });
});

describe('v20-A: メニューが切れない', () => {
  it('the card 「…」 menu and the folder picker are rendered under body (outside the card), fixed, and inside the screen; Esc / outside click close them', async () => {
    await mount('sidepanel', 340, 'grid');
    const card = row('i3');
    await click(card.querySelector('[aria-label="その他の操作"]')!);
    const menu = $<HTMLElement>('.menu-card');
    expect(menu.parentElement!.parentElement).toBe(document.body); // 入れ物の直下 → body
    expect(card.contains(menu)).toBe(false); // カードの overflow に隠れない
    expect(menu.classList.contains('fixed')).toBe(true);
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(menu.textContent).toContain('フォルダを変更');
    await key('Escape');
    expect($$('.menu-card')).toHaveLength(0);

    await click(card.querySelector('[aria-label="その他の操作"]')!);
    await act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await flush();
    expect($$('.menu-card')).toHaveLength(0); // 外側のクリック

    await click(card.querySelector('[aria-label="その他の操作"]')!);
    await click($$('.menu-card .menu-item').find((i) => i.textContent?.includes('フォルダを変更'))!);
    const picker = $('.menu-wide');
    expect(card.contains(picker)).toBe(false);
    expect(picker.parentElement!.parentElement).toBe(document.body);
    expect(picker.querySelector('.picker-host')).toBeTruthy();
    await key('Escape');
    expect($$('.menu-wide')).toHaveLength(0);
  });

  it('the tab grid: the folder-change picker is also outside the card; scrolling closes it', async () => {
    await mount('tab', 1000, 'grid');
    await click(row('i3').querySelector('[aria-label="フォルダを変更"]')!);
    const picker = $('.menu-wide');
    expect(row('i3').contains(picker)).toBe(false);
    await act(() => void document.dispatchEvent(new Event('scroll')));
    await flush();
    expect($$('.menu-wide')).toHaveLength(0);
    expect(css).not.toMatch(/\.gc\{[^}]*overflow:hidden/);
  });
});

describe('v20-B: 削除の確認', () => {
  it('the confirmation is wide enough for two lines and balances them (no one-character last line)', () => {
    expect(css).toMatch(/\.dialog p\{[^}]*text-wrap:balance/);
    const m = css.match(/\.dialog\[role=alertdialog\]\{width:min\((\d+)px/);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(520);
  });
  it('the same component serves the other confirmations (reset / delete all / account / folder / posts)', async () => {
    await mount('tab', 1000, 'list');
    await click(row('v').querySelector('[aria-label="ポストを削除"], [aria-label="PostShelf から削除"]')!);
    expect($('[role=alertdialog]')).toBeTruthy();
    expect($('[role=alertdialog] p').textContent).toContain('X のブックマークは変更されません');
  });
});
