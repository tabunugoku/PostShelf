// 版: v68-c
import { act } from 'preact/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { createFolder, noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';

const flush = (ms = 60) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const snapshot = { text: '架空の本文', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/1' };

beforeEach(async () => {
  installChromeMock();
  await noteAccount({ handle: 'me' }); // popup は最後に読み取ったアカウントのデータを出す
  setAccountScope('me');
});

it('子に入っているポストの点は、いちばん下のフォルダの 1 つだけになる', async () => {
  const a = await createFolder({ name: 'Sample A', color: '#E24B4A' });
  const c = await createFolder({ name: 'Sample C', parentId: a.id, color: '#378ADD' });
  await setBookmarkFolders('1', [c.id], snapshot);
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await act(async () => void (await import('../src/popup/index')));
  await flush();
  const dots = [...document.querySelectorAll<HTMLElement>('.rec-row .rec-dot')];
  expect(dots.map((d) => d.title)).toEqual(['Sample C']);
  expect(dots[0].getAttribute('style')).toContain('rgb(55, 138, 221)');
});
