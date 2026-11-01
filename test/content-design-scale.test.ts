// 版: v85
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openPopover, setPopoverMode } from '../src/content/popover';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { AutoCollectPanel, resetCollapsed } from '../src/content/autocollectPanel';
import type { AutoCollector, CollectState } from '../src/content/autocollect';
import { createFolderPicker } from '../src/shared/folderPicker';
import { createFolderMenu } from '../src/shared/folderCreateMenu';
import * as tokens from '../src/shared/tokens';
import * as storage from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

const theme = { fg: '#0f1419', border: '#cfd9de', hover: 'rgba(15,20,25,.06)', accent: '#1d9bf0' };
const folders = Array.from({ length: 8 }, (_, index) => ({
  id: `sample_${index}`, name: `架空の棚 ${index}`, icon: 'ti-folder', order: index,
}));
const state: CollectState = {
  accountId: 'me', status: 'running', speed: 'slow', cap: 30,
  imported: 3, skipped: 2, failed: 1, startedAt: 1, updatedAt: 1,
};
let panel: AutoCollectPanel;

beforeEach(() => {
  installChromeMock();
  resetAccount();
  resetCollapsed();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  history.replaceState(null, '', '/i/history');
  document.body.innerHTML = readFileSync('test/fixtures/save-menu.html', 'utf8');
  document.body.style.backgroundColor = '#fff';
  vi.spyOn(storage, 'listFolders').mockResolvedValue(folders);
  panel = new AutoCollectPanel({} as AutoCollector, () => {});
});

afterEach(() => {
  panel.hide();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  setPopoverMode('separate');
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

function expectScale(root: HTMLElement): void {
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('[style]')]) {
    expect(element.style.cssText).not.toMatch(/(?:^|[:\s])0?\.5px\b/);
    expect(element.style.fontWeight).not.toBe('700');
  }
}

it('尺度の定数を CSS と同じ値にし、アクセントを保つ', () => {
  expect(tokens).toMatchObject({
    SPACE: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
    CONTROL_HEIGHT: 32, ROW_HEIGHT: 36, LIST_HEIGHT: 40,
    RADIUS_CONTROL: 8, RADIUS_CARD: 12, RADIUS_PILL: 999,
    ICON: 18, ICON_SMALL: 16, EASE: 'cubic-bezier(.2,0,0,1)', DURATION_MS: 120,
    ACCENT: '#1d9bf0', ACCENT_FILL: '#0f6fb3',
  });
});

it.each([
  ['#fff', '0 8px 24px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.08)'],
  ['#000', '0 8px 24px rgba(0,0,0,.5)'],
  ['#15202b', '0 8px 24px rgba(0,0,0,.5)'],
])('ポップオーバーの和文フォント・行高・枠と影をそろえる (%s)', async (background, shadow) => {
  document.body.style.backgroundColor = background;
  const article = document.querySelector('article')!;
  const pop = (await openPopover(article, article.querySelector('button')!))!;
  expect(pop.style.fontFamily).toContain('Hiragino Sans');
  expect(pop.style.lineHeight).toBe('1.5');
  expect(pop.style.borderTopWidth).toBe('1px');
  expect(pop.style.boxShadow.replaceAll(' ', '')).toBe(shadow.replaceAll(' ', ''));
  expectScale(pop);
});

it('共通のフォルダ選択と作成メニューにも尺度を使い、チェックを mask にする', () => {
  const picker = createFolderPicker({
    folders, selected: new Set(['sample_0']), theme, onChange: () => {}, bounded: true,
  });
  const menu = createFolderMenu({ theme, existing: () => folders, onClose: () => {} });
  expect(picker.el.style.fontFamily).toContain('Hiragino Sans');
  expect(picker.el.querySelector('label')!.style.minHeight).toBe('32px');
  expect(picker.el.querySelector<HTMLElement>('.ti-check')!.style.mask).toContain('data:image/svg+xml');
  expect(menu.el.style.fontFamily).toContain('Hiragino Sans');
  expectScale(picker.el);
  expectScale(menu.el);
});

it('進捗パネルは角丸 12・余白と右下 16、数字は左寄せで棒を 4 にする', () => {
  panel.update(state);
  const root = document.querySelector<HTMLElement>('.postshelf-autocollect-panel')!;
  expect(root.style.borderRadius).toBe('12px');
  expect(root.style.padding).toBe('16px');
  expect([root.style.right, root.style.bottom]).toEqual(['16px', '16px']);
  expect(root.firstElementChild!.getAttribute('style')).toContain('font-weight: 500');
  for (const value of root.querySelectorAll('b')) {
    expect(value.style.fontWeight).toBe('500');
    expect(value.parentElement!.style.textAlign).toBe('left');
    expect(value.parentElement!.style.borderRadius).toBe('8px');
  }
  const bar = [...root.children].find(element => (element as HTMLElement).style.height === '4px') as HTMLElement;
  expect(bar).toBeDefined();
  expect(bar.style.borderWidth).toBe('0px');
  expect(bar.firstElementChild!.getAttribute('style')).not.toContain('margin-left');
  expectScale(root);
});

it('畳んだバーも和文フォント・行高・太さをそろえ、点の点滅は保つ', () => {
  panel.update(state);
  document.querySelector<HTMLButtonElement>('[data-action=collapse]')!.click();
  const root = document.querySelector<HTMLElement>('.postshelf-autocollect-panel')!;
  expect(root.style.fontFamily).toContain('Hiragino Sans');
  expect(root.style.lineHeight).toBe('1.5');
  expect(root.querySelector<HTMLButtonElement>('[data-action=expand]')!.style.fontWeight).toBe('500');
  expect(root.firstElementChild!.getAttribute('style')).toContain('postshelf-pulse');
  expectScale(root);
});
