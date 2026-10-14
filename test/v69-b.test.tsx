import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../src/manager/Settings';
import { clearStorageError, useStorageError } from '../src/manager/errorBus';
import { noteAccount, setAccountScope } from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const app = () => document.querySelector('#app')!;
const band = () => document.querySelector('[role="alert"]');
const btn = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!;
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};

function Screen() {
  const error = useStorageError();
  return (
    <>
      <SettingsPage onChanged={() => {}} onApplied={applied} onNotice={() => {}} />
      {error && <p role="alert">{t('errorStorage')}</p>}
    </>
  );
}
const applied = vi.fn();
const createObjectURL = vi.fn(() => 'blob:sample');
const anchorClick = vi.fn();

beforeEach(async () => {
  installChromeMock();
  clearStorageError();
  applied.mockClear();
  createObjectURL.mockClear();
  anchorClick.mockClear();
  HTMLAnchorElement.prototype.click = anchorClick;
  (URL as any).createObjectURL = createObjectURL;
  (URL as any).revokeObjectURL = () => {};
  document.body.innerHTML = '<div id="app"></div>';
  await noteAccount({ handle: 'me', displayName: 'Me' }, 5);
  setAccountScope('me');
  await act(() => void render(<Screen />, app()));
  await flush();
});
afterEach(() => {
  act(() => void render(null, app()));
  vi.restoreAllMocks();
  clearStorageError();
});

describe('v69-B: 設定画面の初期化・全削除・書き出しの失敗が画面に出る', () => {
  it('全削除が失敗すると保存のエラーが出て、画面は作り直される', async () => {
    await click(btn(t('deleteAllBtn')));
    const input = document.querySelector<HTMLInputElement>('[role=alertdialog] input')!;
    await act(() => {
      input.value = t('deleteAllWord');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(Error('storage'));
    await click(document.querySelector<HTMLButtonElement>('.danger-solid')!);
    expect(band()!.textContent).toBe(t('errorStorage'));
    expect(applied).toHaveBeenCalled();
  });

  it('書き出しが失敗すると保存のエラーが出て、ダウンロードは始まらない', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(Error('storage'));
    await click(btn(t('exportBtn')));
    expect(band()!.textContent).toBe(t('errorStorage'));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('書き出しが成功するとファイルを保存する', async () => {
    await click(btn(t('exportBtn')));
    expect(band()).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('初期化が失敗すると保存のエラーが出る', async () => {
    await click(btn(t('settingsResetBtn')));
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(Error('storage'));
    await click(document.querySelector<HTMLButtonElement>('[role=alertdialog] .danger-solid, [role=alertdialog] button:last-child')!);
    expect(band()!.textContent).toBe(t('errorStorage'));
    expect(applied).not.toHaveBeenCalled();
  });
});
