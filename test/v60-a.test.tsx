import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filterSettings, SettingsPage } from '../src/manager/Settings';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, updateSettings } from '../src/shared/settings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
let data: Record<string, unknown>;
const root = () => document.getElementById('app')!;

beforeEach(() => {
  data = installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => render(null, root()));

describe('親フォルダにも表示する設定', () => {
  it('未保存の設定は true が既定になる', async () => {
    expect(DEFAULT_SETTINGS.showInAncestors).toBe(true);
    expect((await getSettings()).showInAncestors).toBe(true);
  });

  it('false を保存して読み戻せる', async () => {
    await updateSettings({ showInAncestors: false });
    expect((await getSettings()).showInAncestors).toBe(false);
  });

  it.each(['false', 0, null, {}, undefined])('不正な保存値 %j は true に戻る', async (raw) => {
    data.settings = { showInAncestors: raw };
    expect((await getSettings()).showInAncestors).toBe(true);
  });

  it('変更通知も検証済みの設定を渡し、解除できる', async () => {
    const values: boolean[] = [];
    const off = onSettingsChanged((settings) => values.push(settings.showInAncestors));
    await updateSettings({ showInAncestors: false });
    await flush();
    await chrome.storage.local.set({ settings: { showInAncestors: 'false' } });
    await flush();
    expect(values).toEqual([false, true]);
    off();
    await updateSettings({ showInAncestors: false });
    await flush();
    expect(values).toEqual([false, true]);
  });

  for (const surface of ['tab', 'sidepanel'] as const) {
    it(surface + ': 表示の設定は見出し直下で仕分けモードの枠の外に置く', async () => {
      await act(() => void render(
        <SettingsPage surface={surface} onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />,
        root(),
      ));
      await flush();
      const label = root().querySelector('input[name="showInAncestors"]')!.closest('label')!;
      expect(label.closest('fieldset')).toBeNull();
      expect(label.previousElementSibling?.id).toBe('set-group-behavior');
      expect(label.nextElementSibling?.matches('fieldset.setting-group')).toBe(true);
      expect(label.nextElementSibling?.querySelector('legend')?.textContent).toBe('仕分けモード');
    });

    it(surface + ': 枠の外に移した表示設定も検索でき、見出しと件数が一致する', async () => {
      await act(() => void render(
        <SettingsPage surface={surface} onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />,
        root(),
      ));
      await flush();
      const page = root().querySelector<HTMLElement>('.settings-page')!;
      const label = page.querySelector<HTMLInputElement>('input[name="showInAncestors"]')!.closest('label')!;
      const heading = page.querySelector<HTMLElement>('#set-group-behavior')!;
      expect(filterSettings(page, '親フォルダにも表示する')).toBe(1);
      expect(label.hidden).toBe(false);
      expect(heading.hidden).toBe(false);
      expect(filterSettings(page, '架空の一致しない検索語')).toBe(0);
      expect(label.hidden).toBe(true);
      expect(heading.hidden).toBe(true);
      filterSettings(page, '');
      expect(label.hidden).toBe(false);
      expect(heading.hidden).toBe(false);
    });

    it(surface + ': チェックボックスから保存でき、別画面の変更も反映する', async () => {
      await act(() => void render(
        <SettingsPage surface={surface} onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />,
        root(),
      ));
      await flush();
      const input = root().querySelector<HTMLInputElement>('input[name="showInAncestors"]')!;
      expect(input).not.toBeNull();
      expect(input.checked).toBe(true);
      const label = input.closest('label')!;
      expect(label.textContent).toContain('親フォルダにも表示する');
      expect(label.querySelector('.setting-desc')!.textContent).toBe(
        'オフにすると、ポストは所属するいちばん下のフォルダだけに表示されます。保存データは変わりません。親と子の両方に直接入れたポストは、子にだけ表示されます。',
      );
      await act(() => {
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();
      expect((await getSettings()).showInAncestors).toBe(false);
      await act(async () => { await updateSettings({ showInAncestors: true }); });
      await flush();
      expect(input.checked).toBe(true);
    });
  }
});
