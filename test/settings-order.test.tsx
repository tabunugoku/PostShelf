import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { SettingsPage } from '../src/manager/Settings';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

describe('settings page section order (v13-B)', () => {
  beforeEach(() => {
    installChromeMock();
    (globalThis as any).chrome.tabs = { query: async () => [] };
    document.body.innerHTML = '<div id="app"></div>';
  });
  /** グループの見出し (h3) と、欄の見出し (legend) の出現順 (v25) */
  const expected = [
    '保存',
    'X のブックマークとの連動',
    '標準ブックマークボタンの動作',
    '長いポストの全文',
    '画像のキャッシュ',
    '取り込み',
    'ブックマークの自動取り込み',
    '表示と動作',
    '仕分けモード',
    'ツールバーアイコンのクリック時の動作',
    'データ',
    'データの保存と移行',
    '情報',
    'X の画面構造',
    'PostShelf について',
    '初期化と削除',
    '設定の初期化',
    '危険な操作',
  ];
  for (const surface of ['tab', 'sidepanel'] as const) {
    it(`${surface}: sections appear in the order of how often they are used`, async () => {
      await act(() => void render(<SettingsPage surface={surface} onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />, document.getElementById('app')!));
      await flush();
      const root = document.querySelector('section')!;
      const heads = [...root.querySelectorAll(':scope > h3.set-h, :scope > fieldset > legend')].map((e) => e.textContent!.trim());
      expect(heads).toEqual(expected);
      expect(root.querySelector(':scope > fieldset:last-of-type')!.classList.contains('danger-zone')).toBe(true);
    });
  }
});
