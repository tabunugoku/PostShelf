// 版: v69-a
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { applyButtonMode, injectButtons, refreshAll } from '../src/content/buttons';
import { createFolderPicker } from '../src/shared/folderPicker';
import { createFolder, listFolders, setBookmarkFolders } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

const html = readFileSync('test/fixtures/tweet.html', 'utf8');
const snap = { text: '架空の本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };
const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
const button = () => document.querySelector<HTMLElement>('[data-postshelf-btn]')!;
const badge = () => button().querySelector('[data-postshelf-badge]')!;

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  document.body.innerHTML = html;
  applyButtonMode('separate');
});

async function tree() {
  const a = await createFolder({ name: 'Sample A', color: '#E24B4A' });
  const c = await createFolder({ name: 'Sample C', color: '#378ADD', parentId: a.id });
  const b = await createFolder({ name: 'Sample B', color: '#639922' });
  return { a, b, c };
}

describe('v69-A: x.com のボタンとポップオーバーは、いちばん下のフォルダだけ数える', () => {
  it('子フォルダだけに入ったポストは、バッジ 1・title 1 個・色は子の色', async () => {
    const { a, c } = await tree();
    await setBookmarkFolders('1234567890', [a.id, c.id], snap);
    injectButtons();
    await refreshAll();
    expect(badge().textContent).toBe('1');
    expect(button().title).toBe('1 個のフォルダに保存済み');
    expect(button().style.color).toMatch(/55, 138, 221|#378add/i);
  });

  it('子と別の 1 段目に入ったポストは 2', async () => {
    const { a, b, c } = await tree();
    await setBookmarkFolders('1234567890', [a.id, c.id, b.id], snap);
    injectButtons();
    await refreshAll();
    expect(badge().textContent).toBe('2');
    expect(button().title).toBe('2 個のフォルダに保存済み');
  });

  it('ポップオーバーの見出しも 1 個', async () => {
    const { c } = await tree();
    const picker = createFolderPicker({
      folders: await listFolders(),
      selected: new Set([c.id]),
      theme,
      onChange: () => {},
      extras: { recentIds: [] },
    });
    document.body.append(picker.el);
    await tick();
    expect(picker.el.textContent).toContain('✓ 1 個のフォルダに保存済み');
  });
});
