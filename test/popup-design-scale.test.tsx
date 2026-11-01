// 版: v85
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { INBOX_ID } from '../src/shared/models';
import { noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

const css = readFileSync('static/popup.css', 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector}{`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start + selector.length + 2).split('}')[0];
};

afterEach(() => {
  const host = document.querySelector('#app');
  if (host) render(null, host);
});

it('タイルを左寄せ・角丸 12、数字を 24px・500・等幅にする', () => {
  expect(css).not.toMatch(/font-weight:\s*700/);
  expect(rule('.tile')).toContain('text-align:left');
  expect(rule('.tile')).toContain('border-radius:var(--r-card)');
  expect(rule('.tile b')).toContain('font-size:24px');
  expect(rule('.tile b')).toContain('font-weight:500');
  expect(rule('.tile b')).toContain('font-variant-numeric:tabular-nums');
});

it('検索は丸い 36、主ボタンと副ボタンは両方 36・角丸 8 にする', () => {
  const buttons = rule('.main-btn,.sub-btn');
  expect(buttons).toContain('min-height:var(--h-row)');
  expect(buttons).toContain('border-radius:var(--r-control)');
  expect(buttons).toContain('width:100%');
  expect(rule('.sub-btn')).toContain('margin-top:var(--sp-2)');
  expect(rule('.popup-search')).toContain('border-radius:var(--r-pill)');
  expect(rule('.popup-search')).toContain('min-height:var(--h-row)');
});

it('最近の保存は点の列を固定幅にし、ハンドルと本文の省略を保つ', () => {
  expect(rule('.rec-dots')).toContain('width:32px');
  expect(rule('.rec-dot')).toContain('width:8px;height:8px');
  expect(rule('.rec-handle')).toContain('text-overflow:ellipsis');
  expect(rule('.rec-row')).toContain('white-space:nowrap');
  expect(rule('.rec-row')).toContain('text-overflow:ellipsis');
  expect(rule('.foot-row .pr.small')).toContain('min-height:var(--h-control)');
});

it.each([true, false])('未分類の矢印は押せるタイルだけに出す (件数あり: %s)', async (hasInbox) => {
  installChromeMock();
  await noteAccount({ handle: 'me' }, 1);
  setAccountScope('me');
  if (hasInbox) {
    await setBookmarkFolders('111', [INBOX_ID], {
      text: '架空の保存ポスト', author: '架空の投稿者', handle: '@sample_author', media: [],
      url: 'https://x.com/sample_author/status/111',
    });
  }
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await act(async () => void (await import('../src/popup/index')));
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 40)));
  const tile = document.querySelector(hasInbox ? '.tile-inbox' : '.tile-quiet')!;
  expect(tile).not.toBeNull();
  expect(!!tile.querySelector('.ti-arrow-right')).toBe(hasInbox);
  if (hasInbox) expect(tile.textContent).toContain(chrome.i18n.getMessage('popupInbox'));
});
