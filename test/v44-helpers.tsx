import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, vi } from 'vitest';
import { App } from '../src/manager/App';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import type { Folder } from '../src/shared/models';
import { installChromeMock, installPanelMock } from './chrome-mock';

export const flush = () => act(() => new Promise<void>(r => setTimeout(r, 40)));
export async function setup(assignments: number[][] = [[0], [0]]) {
  installChromeMock(); installPanelMock(); storage.setAccountScope('unknown'); history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const folders: Folder[] = [];
  for (const name of ['Sample A', 'Sample B', 'Sample C']) folders.push(await storage.createFolder({ name }));
  for (let i = 0; i < assignments.length; i++) await storage.setBookmarkFolders(String(i + 1), assignments[i].map(n => folders[n].id), {
    text: 'Sample post', author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${i + 1}`,
  });
  document.body.innerHTML = '<div id="app"></div>';
  return folders;
}
export const click = async (el: HTMLElement) => { expect(el).not.toBeNull(); await act(() => void el.click()); await flush(); };
export const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.menu-bulk button')].find(b => b.textContent?.trim().replace(/^← /, '') === text.replace(/^← /, ''))!;
export const box = (name: string) => [...document.querySelectorAll('.menu-bulk label')].find(el => el.textContent === name)!.querySelector<HTMLInputElement>('input')!;
export const assignments = async () => (await storage.listBookmarks()).sort((a, b) => a.tweetId.localeCompare(b.tweetId)).map(b => b.folderIds);
export async function mount(surface: 'tab' | 'sidepanel' = 'tab', view?: string) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(surface === 'tab' ? 1280 : 390);
  await act(() => void render(<App surface={surface} />, document.querySelector('#app')!)); await flush();
  if (view) {
    if (surface === 'sidepanel') await click(document.querySelector<HTMLButtonElement>('.folder-btn')!);
    await click([...document.querySelectorAll<HTMLButtonElement>(surface === 'sidepanel' ? '.menu-item' : '.fr')].find(b => b.textContent?.includes(view))!);
  }
  await act(() => void document.querySelector('.rows')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))); await flush();
  await click(document.querySelector<HTMLButtonElement>('.bulk-btn')!);
  await click(button(t('changeFolder')));
}
export async function unmount() { await act(() => void render(null, document.querySelector('#app')!)); vi.restoreAllMocks(); }
export const confirm = () => click(button(t('triageConfirm')));
export async function enter(el: HTMLElement) { await act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))); await flush(); }
