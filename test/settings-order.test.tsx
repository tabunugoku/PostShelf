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
  const expected = [
    'X のブックマークと連動する',
    '標準ブックマークボタンの動作',
    'ツールバーアイコンのクリック時の動作',
    '画像のキャッシュ',
    'データ',
    'X の画面構造',
    '設定の初期化',
    '危険な操作',
  ];
  for (const surface of ['tab', 'sidepanel'] as const) {
    it(`${surface}: sections appear in the order of how often they are used`, async () => {
      await act(() => void render(<SettingsPage surface={surface} onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />, document.getElementById('app')!));
      await flush();
      const root = document.querySelector('section')!;
      // 先頭のスイッチ (連動モード) と、以降の fieldset の legend を出現順に並べる
      const heads = [...root.querySelectorAll(':scope > label.setting strong, :scope > fieldset > legend')].map((e) => e.textContent!.trim());
      expect(heads).toEqual(expected);
      expect(root.querySelector(':scope > fieldset:last-of-type')!.classList.contains('danger-zone')).toBe(true);
    });
  }
});
