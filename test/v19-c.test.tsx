import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { noteAccount, setAccountScope } from '../src/shared/storage';
import { getSettings } from '../src/shared/settings';

const css = readFileSync('static/manager.css', 'utf8');
const flush = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};

beforeEach(async () => {
  installChromeMock();
  installPanelMock();
  (globalThis as any).chrome.permissions = { contains: async () => true, request: async () => true };
  document.body.innerHTML = '<div id="app"></div>';
  (window as any).innerWidth = 1200;
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
  await act(() => void render(<App />, $('#app')));
  await flush();
  await click($$('.side .fr').find((r) => r.textContent?.includes('設定'))!);
});
afterEach(() => render(null, $('#app')));

describe('v19-4: 設定画面', () => {
  it('on/off settings are real input[type=checkbox][role=switch] at the right end; radios stay radios', () => {
    const sw = $$<HTMLInputElement>('input[role=switch]');
    expect(sw.length).toBeGreaterThanOrEqual(3); // X のブックマークとの連動 / 画像のキャッシュ / 自動取り込み
    for (const i of sw) {
      expect(i.type).toBe('checkbox'); // キーボード (Space) の操作は、本物の checkbox のまま
      expect(i.closest('label.setting')).toBeTruthy();
    }
    expect($$('input[type=radio]').length).toBeGreaterThanOrEqual(4); // どれか 1 つを選ぶ設定は、そのまま
    expect(css).toMatch(/\.setting>input\[role=switch\]\{order:2;margin-left:auto/);
    expect(css).toMatch(/\.setting>input\[role=switch\]::after\{/);
    expect(css).toMatch(/\.setting>input\[role=switch\]:checked\{background:var\(--accent-strong\)/);
  });

  it('the heading has a gap between the gear icon and the text', () => {
    expect($('.bar > i').className).toContain('ti-settings');
    expect(css).toMatch(/\.bar\{display:flex;align-items:center;gap:10px/);
  });

  it('the image cache is collapsed while off (one line + the permission note), and opens when turned on', async () => {
    expect($('.image-cache input[role=switch]').hasAttribute('checked') || ($('.image-cache input[role=switch]') as HTMLInputElement).checked).toBe(false);
    const sec = $('.image-cache');
    expect(sec.querySelectorAll('input[name=cacheBackend]').length).toBe(0);
    expect(sec.querySelectorAll('select').length).toBe(0);
    expect(sec.querySelectorAll('input[name=cacheQuality]').length).toBe(0);
    expect(sec.querySelectorAll('input[name=cacheFull]').length).toBe(0);
    expect(sec.textContent).not.toContain('まとめてキャッシュは');
    expect(sec.textContent).not.toContain('保存した画像は、この PC の中だけに置き');
    expect($('#cache-collapsed').textContent).toBe('オンにすると、保存先・容量・画質を選べます');
    // 「初めてオンにするとき、Chrome が許可を求めます」の補足は、オンにする前に読める位置 (スイッチのすぐ下) に残る
    const note = $('.image-cache .cache-perm-note');
    expect(note.textContent).toContain('初めてオンにするとき');
    const kids = [...sec.children];
    expect(kids.indexOf(note)).toBeGreaterThan(kids.findIndex((k) => k.querySelector?.('input[role=switch]')));
    await click($('.image-cache input[role=switch]'));
    expect((await getSettings()).imageCache.enabled).toBe(true);
    expect($('#cache-collapsed')).toBeNull();
    expect(sec.querySelectorAll('input[name=cacheBackend]').length).toBe(2);
    expect(sec.querySelectorAll('select').length).toBe(1);
    expect(sec.querySelectorAll('input[name=cacheQuality]').length).toBe(2);
    expect(sec.textContent).toContain('保存した画像は、この PC の中だけに置き');
    expect($('.image-cache .cache-perm-note')).toBeTruthy(); // オンのあとも残る
    await click($('.image-cache input[role=switch]'));
    expect($('#cache-collapsed')).toBeTruthy(); // オフに戻すと、また畳まれる
  });
});
