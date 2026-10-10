import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import { createFolder, setAccountScope } from '../src/shared/storage';
import { installChromeMock, installPanelMock, loadMessages } from './chrome-mock';

afterEach(async () => {
  const host = document.querySelector('#app');
  if (host) await act(() => void render(null, host));
  vi.restoreAllMocks();
});

it('offers folder editing without move-up or move-down actions', async () => {
  installChromeMock();
  installPanelMock();
  setAccountScope('unknown');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await createFolder({ name: 'Sample A' });
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<App />, document.querySelector('#app')!));
  await act(() => new Promise<void>((r) => setTimeout(r, 40)));
  const row = [...document.querySelectorAll('.fr')].find(r => r.querySelector('.fr-name')?.textContent === 'Sample A')!;
  await act(() => void row.querySelector<HTMLButtonElement>('.more-btn')!.click());
  expect(document.querySelector('.folder-editor-host')).not.toBeNull();
  expect(document.querySelector('.folder-reorder')).toBeNull();
  expect(document.querySelector('[data-action^="folder-move-"]')).toBeNull();
});

it.each(['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr'])('removes the retired move labels from %s', (lang) => {
  const messages = loadMessages(lang);
  expect(messages).not.toHaveProperty('folderMoveUp');
  expect(messages).not.toHaveProperty('folderMoveDown');
});
