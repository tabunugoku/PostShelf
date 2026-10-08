import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { extractTweet } from '../src/content/snapshot';
import { viewerCandidates, withImageSize } from '../src/shared/media';
import { createFolder, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 15)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element, init: MouseEventInit = {}) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })));
  await flush();
};
const key = async (k: string, init: KeyboardEventInit = {}) => {
  await act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));
  await flush();
};
const img = (n: string) => `https://pbs.twimg.com/media/${n}?format=jpg&name=small`;

describe('image URL helpers (pure)', () => {
  it('replaces name= with orig, then large', () => {
    expect(withImageSize(img('A'), 'orig')).toBe('https://pbs.twimg.com/media/A?format=jpg&name=orig');
    expect(viewerCandidates(img('A'))).toEqual(['https://pbs.twimg.com/media/A?format=jpg&name=orig', 'https://pbs.twimg.com/media/A?format=jpg&name=large']);
    expect(withImageSize('https://pbs.twimg.com/media/A?name=small&format=png', 'large')).toBe('https://pbs.twimg.com/media/A?name=large&format=png');
  });
  it('leaves unexpected shapes untouched', () => {
    for (const u of ['https://pbs.twimg.com/media/A.jpg', 'https://example.com/a.jpg?name=small', 'blob:xyz', '', 'https://pbs.twimg.com/media/A?format=jpg']) {
      expect(viewerCandidates(u)).toEqual([u]);
    }
  });
});

describe('videoPoster is saved from <video poster>', () => {
  it('reads the poster URL, and leaves it undefined when there is none or no video', () => {
    document.body.innerHTML = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet-video.html'), 'utf8');
    const ex = extractTweet(document.querySelector('article')!)!;
    expect(ex.snapshot.hasVideo).toBe(true);
    expect(ex.snapshot.videoPoster).toContain('amplify_video_thumb');
    document.querySelector('video')!.removeAttribute('poster');
    const none = extractTweet(document.querySelector('article')!)!;
    expect(none.snapshot.hasVideo).toBe(true);
    expect(none.snapshot.videoPoster).toBeUndefined();
    document.body.innerHTML = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');
    expect(extractTweet(document.querySelector('article')!)!.snapshot.videoPoster).toBeUndefined();
  });
});

describe('manager: image viewer and video guide', () => {
  const snap = (id: number, extra = {}) => ({ text: `post ${id}`, author: 'A', handle: `@u${id}`, media: [] as string[], url: `https://x.com/u${id}/status/${id}`, ...extra });
  beforeEach(async () => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
    (window as any).innerWidth = 1200;
    setAccountScope('unknown');
    const f = await createFolder({ name: 'F' });
    await setBookmarkFolders('1', [f.id], snap(1, { media: [img('A'), img('B'), img('C')] }));
    await setBookmarkFolders('2', [f.id], snap(2, { hasVideo: true, videoPoster: 'https://pbs.twimg.com/amplify_video_thumb/2/img/t.jpg?name=small' }));
    await setBookmarkFolders('3', [f.id], snap(3, { hasVideo: true })); // 古い保存分: poster なし
    await act(() => void render(<App />, $('#app')));
    await flush();
  });
  afterEach(() => render(null, $('#app')));
  const tile = (row: string, i = 0) => $$<HTMLButtonElement>(`[data-row="${row}"] .ph`)[i];

  it('image tiles are buttons with a label, a zoom hint, and the 3 images are all clickable', () => {
    const tiles = $$(`[data-row="1"] .ph`);
    expect(tiles.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['画像 1 / 3 を大きく表示', '画像 2 / 3 を大きく表示', '画像 3 / 3 を大きく表示']);
    expect(tiles[0].querySelector('.hint')!.textContent).toBe('拡大');
  });

  it('opens a dialog with the large image, count, close button focused; links open in a new tab safely', async () => {
    await click(tile('1', 1));
    const dlg = $('[role=dialog].viewer');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect($<HTMLImageElement>('.viewer-img img').src).toBe('https://pbs.twimg.com/media/B?format=jpg&name=orig');
    expect($('.viewer-count').textContent).toBe('2 / 3');
    expect(document.activeElement).toBe($('.viewer-bar button'));
    const orig = $$<HTMLAnchorElement>('.viewer-foot a').find((a) => a.textContent!.includes('元のサイズ'))!;
    expect(orig.href).toContain('name=orig');
    expect(orig.target).toBe('_blank');
    expect(orig.rel).toBe('noopener noreferrer');
    const open = $$<HTMLAnchorElement>('.viewer-foot a').find((a) => a.textContent!.includes('X でポストを開く'))!;
    expect(open.href).toBe('https://x.com/u1/status/1');
    expect(open.rel).toBe('noopener noreferrer');
  });

  it('closes with ✕, Esc and a background click, and returns focus to the tile', async () => {
    for (const how of ['x', 'esc', 'bg'] as const) {
      const t = tile('1', 0);
      t.focus();
      await click(t);
      expect($$('.viewer').length).toBe(1);
      if (how === 'x') await click($('.viewer-bar button'));
      else if (how === 'esc') await key('Escape');
      else await click($('.viewer'));
      expect($$('.viewer').length).toBe(0);
      expect(document.activeElement).toBe(t);
    }
  });

  it('clicking the image itself does not close it', async () => {
    await click(tile('1', 0));
    await click($('.viewer-img img'));
    expect($$('.viewer').length).toBe(1);
  });

  it('← → move between images and wrap around at both ends; buttons do the same', async () => {
    await click(tile('1', 0));
    const count = () => $('.viewer-count').textContent;
    await key('ArrowRight');
    expect(count()).toBe('2 / 3');
    await key('ArrowRight');
    await key('ArrowRight');
    expect(count()).toBe('1 / 3'); // 端で先頭へ
    await key('ArrowLeft');
    expect(count()).toBe('3 / 3'); // 先頭から末尾へ
    expect($<HTMLImageElement>('.viewer-img img').src).toContain('/media/C?');
    await click($('[aria-label="次の画像"]'));
    expect(count()).toBe('1 / 3');
    await click($('[aria-label="前の画像"]'));
    expect(count()).toBe('3 / 3');
  });

  it('Tab cycles inside the dialog', async () => {
    await click(tile('1', 0));
    const items = $$<HTMLElement>('.viewer button, .viewer a[href]');
    items[items.length - 1].focus();
    await key('Tab');
    expect(document.activeElement).toBe(items[0]);
    await key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('a single image has no prev / next buttons', async () => {
    const f = await createFolder({ name: 'G' });
    await setBookmarkFolders('9', [f.id], snap(9, { media: [img('Z')] }));
    await act(() => void render(null, $('#app')));
    await act(() => void render(<App />, $('#app')));
    await flush();
    await click(tile('9', 0));
    expect($$('[aria-label="次の画像"]').length).toBe(0);
    expect($('.viewer-count').textContent).toBe('1 / 1');
  });

  it('falls back orig → large when an image fails, then shows the failure view with the reason and the ways out', async () => {
    await click(tile('1', 0));
    const i = () => $<HTMLImageElement>('.viewer-img img');
    expect(i().src).toContain('name=orig');
    await act(() => void i().dispatchEvent(new Event('error')));
    await flush();
    expect(i().src).toContain('name=large');
    await act(() => void i().dispatchEvent(new Event('error')));
    await flush();
    const dlg = $('.viewer');
    expect($('[role=alert]').textContent).toContain('画像を読み込めませんでした');
    expect(dlg.textContent).toContain('元のポストが削除されたか');
    expect(dlg.textContent).toContain('X でポストを開く');
    expect(dlg.textContent).not.toContain('元のサイズで開く'); // 失敗中は出さない
    await click($$('.viewer-foot button').find((b) => b.textContent === '保存してある小さい画像を表示')!);
    expect($<HTMLImageElement>('.viewer-img img').src).toBe(img('A')); // 保存してある URL
    // それも読めなければ失敗の表示に戻る
    await act(() => void $('.viewer-img img').dispatchEvent(new Event('error')));
    await flush();
    expect($$('[role=alert]').length).toBe(1);
  });

  it('video: thumbnail tile with play mark and badge; click opens the guide with a link to the post', async () => {
    const v = tile('2');
    expect(v.querySelector('.play')).toBeTruthy();
    expect(v.querySelector('.badge')!.textContent).toBe('動画');
    expect(v.querySelector('img')!.getAttribute('src')).toContain('amplify_video_thumb');
    await click(v);
    const dlg = $('[role=dialog].viewer');
    expect(dlg.textContent).toContain('動画は X で再生します');
    const a = $<HTMLAnchorElement>('.viewer-foot a');
    expect(a.textContent).toBe('X で動画を再生 ↗');
    expect(a.href).toBe('https://x.com/u2/status/2');
    expect(a.rel).toBe('noopener noreferrer');
    await key('Escape');
    expect($$('.viewer').length).toBe(0);
  });

  it('older saved videos (no poster) get a frame with the icon only', async () => {
    const v = tile('3');
    expect(v.querySelector('img')).toBeNull();
    expect(v.querySelector('.play')).toBeTruthy();
    await click(v);
    expect($('.viewer').textContent).toContain('動画は X で再生します');
  });

  it('in selection mode a click toggles the selection and the viewer does not open (also for video)', async () => {
    await click($('[data-row="3"] .sel')); // 1 件選択 → 選択モード
    const before = $$('.selected').length;
    await click(tile('1', 0));
    expect($$('.viewer').length).toBe(0);
    expect($$('.selected').length).not.toBe(before);
    await click(tile('2'));
    expect($$('.viewer').length).toBe(0);
  });

  it('other clicks in the card (links, menu buttons) are not affected', async () => {
    const link = $<HTMLAnchorElement>('[data-row="1"] a[title="X で開く"]');
    expect(link).toBeTruthy();
    await click($('[data-row="1"] [aria-label="フォルダを変更"]'));
    expect($$('.viewer').length).toBe(0);
  });

  it('grid view: the cover is a button and opens the viewer', async () => {
    await click($('.seg button[aria-label="グリッド表示"]'));
    expect($$('[data-row="1"] .cover-wrap button.ph').length).toBe(1);
    await click($('[data-row="1"] .cover-wrap button.ph'));
    expect($$('.viewer').length).toBe(1);
  });

  it('works in the side panel layout too', async () => {
    await act(() => void render(null, $('#app')));
    (window as any).innerWidth = 400;
    await act(() => void render(<App surface="sidepanel" />, $('#app')));
    await flush();
    await click(tile('1', 2));
    expect($('.viewer-count').textContent).toBe('3 / 3');
    (window as any).innerWidth = 1200;
  });
});
