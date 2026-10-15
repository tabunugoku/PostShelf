// 版: v73
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../src/manager/Settings';
import { UpdateAvailable } from '../src/manager/UpdateAvailable';
import { RELEASES_URL } from '../src/shared/links';
import { getSettings, updateSettings } from '../src/shared/settings';
import { installChromeMock } from './chrome-mock';

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
let data: Record<string, unknown>;
const root = () => document.getElementById('app')!;
// chrome-mock の manifest の version は 9.9.9。それより新しいリリースを返す
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v10.0.0' }), { status: 200 }));

beforeEach(() => {
  data = installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  render(null, root());
  vi.unstubAllGlobals();
});

describe('the settings switch', () => {
  it('sits in "About PostShelf", off by default, and saves the choice', async () => {
    await act(() => void render(
      <SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />,
      root(),
    ));
    await flush();
    const input = root().querySelector<HTMLInputElement>('input[name="updateCheck"]')!;
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);
    expect(input.closest('fieldset')?.querySelector('legend')?.textContent).toBe('PostShelf について');
    expect(input.closest('label')?.textContent).toContain('IP アドレス');
    await act(() => input.click());
    await flush();
    expect((await getSettings()).updateCheck).toBe(true);
  });
});

describe('the notice', () => {
  it('shows nothing and asks nothing while the setting is off', async () => {
    await act(() => void render(<UpdateAvailable ask />, root()));
    await flush();
    expect(root().textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks GitHub and shows the new version with a link to the release page', async () => {
    await updateSettings({ updateCheck: true });
    await act(() => void render(<UpdateAvailable ask />, root()));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(root().textContent).toContain('新しいバージョン 10.0.0 が出ています');
    const link = root().querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe(RELEASES_URL);
    expect(link.target).toBe('_blank');
    expect(link.getAttribute('aria-label')).toBe('リリースのページを開く（新しいタブで開きます）');
  });

  it('checks right away when the setting is turned on while the screen is open', async () => {
    await act(() => void render(<UpdateAvailable ask />, root()));
    await flush();
    expect(root().textContent).toBe('');
    await updateSettings({ updateCheck: true });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(root().textContent).toContain('10.0.0');
  });

  it('in the popup, only shows the last result and never asks', async () => {
    await updateSettings({ updateCheck: true });
    await act(() => void render(<UpdateAvailable ask={false} />, root()));
    await flush();
    expect(root().textContent).toBe('');
    data.updateCheckState = { checkedAt: Date.now(), latest: 'v10.0.0' };
    render(null, root());
    await act(() => void render(<UpdateAvailable ask={false} />, root()));
    await flush();
    expect(root().textContent).toContain('10.0.0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows nothing when the latest release is not newer', async () => {
    await updateSettings({ updateCheck: true });
    data.updateCheckState = { checkedAt: Date.now(), latest: 'v9.9.9' };
    await act(() => void render(<UpdateAvailable ask />, root()));
    await flush();
    expect(root().textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
