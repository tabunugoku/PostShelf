import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SettingsPage } from '../src/manager/Settings';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../src/shared/settings';
import { t } from '../src/shared/strings';
import { installChromeMock, installPanelMock } from './chrome-mock';

let data: Record<string, unknown>;
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
beforeEach(() => {
  data = installChromeMock();
  installPanelMock();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => act(() => void render(null, document.querySelector('#app')!)));

it('defaults to false, including old settings and invalid values', async () => {
  expect(DEFAULT_SETTINGS.triageMulti).toBe(false);
  expect((await getSettings()).triageMulti).toBe(false);
  data.settings = { fullText: false };
  expect((await getSettings()).triageMulti).toBe(false);
  data.settings = { triageMulti: 'true' };
  expect((await getSettings()).triageMulti).toBe(false);
});
it('round trips both values', async () => {
  await updateSettings({ triageMulti: true });
  expect((await getSettings()).triageMulti).toBe(true);
  await updateSettings({ triageMulti: false });
  expect((await getSettings()).triageMulti).toBe(false);
});
it('toggles and saves from settings, with the explanation', async () => {
  await act(() => void render(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />, document.querySelector('#app')!));
  await flush();
  const label = [...document.querySelectorAll('label.setting')].find((el) => el.textContent?.includes(t('triageMultiSwitch')))!;
  expect(label.textContent).toContain(t('triageMultiDesc'));
  const cb = label.querySelector<HTMLInputElement>('input')!;
  expect(cb.checked).toBe(false);
  await act(() => void cb.click());
  await flush();
  expect((await getSettings()).triageMulti).toBe(true);
  expect(cb.checked).toBe(true);
  await act(() => void cb.click());
  await flush();
  expect((await getSettings()).triageMulti).toBe(false);
});
