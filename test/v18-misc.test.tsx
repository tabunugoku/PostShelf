import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { createFolderPicker } from '../src/shared/folderPicker';
import { FolderEdit } from '../src/manager/FolderEdit';
import { inboxOf } from '../src/shared/folderPicker';
import { createFolder, listFolders, setAccountScope } from '../src/shared/storage';
import type { Folder } from '../src/shared/models';

const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
});

describe('v18-C-1: 「未分類」という名前のフォルダは作れない', () => {
  it('the create menu rejects 未分類 even before the inbox folder is stored', async () => {
    const { el } = createFolderPicker({ folders: [], selected: new Set(), theme, onChange: () => {} });
    document.body.append(el);
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'フォルダを追加')!.click();
    el.querySelector<HTMLInputElement>('form input')!.value = ' 未分類 ';
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(el.textContent).toContain('同名のフォルダがあります');
    expect((await listFolders()).map((f) => f.id)).toEqual(['all']);
  });

  it('renaming a folder in the manager edit popover to 未分類 / another name is rejected', async () => {
    const a = await createFolder({ name: 'A' });
    const b = await createFolder({ name: 'B' });
    document.body.innerHTML = '<div id="app"></div>';
    const all = await listFolders();
    const stored: Folder[] = all.filter((f) => f.id !== 'all' || true);
    const existing = [inboxOf(stored), ...stored];
    await act(() => void render(<FolderEdit folder={a} existing={existing} onSaved={() => {}} onRequestDelete={() => {}} />, document.getElementById('app')!));
    const input = document.querySelector<HTMLInputElement>('.folder-edit input')!;
    for (const name of ['未分類', 'b']) {
      await act(async () => {
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await tick();
      });
      expect(document.body.textContent).toContain('同名のフォルダがあります');
    }
    expect((await listFolders()).find((f) => f.id === a.id)!.name).toBe('A');
    void b;
  });
});
