import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import { ALL_FOLDER_ID, INBOX_ID, type Bookmark } from '../src/shared/models';
import { countFolder, inView, queryBookmarks, RECENT_ID, RECENT_MS } from '../src/shared/query';
import { updateSettings } from '../src/shared/settings';
import { createFolder, listBookmarks, setAccountScope, setBookmarkFolders, updateFolder } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';

const NOW = 1000000000;
const snapshot = {
  text: '架空の本文', author: 'Sample', handle: '@sample_folder', media: [],
  url: 'https://x.com/sample_folder/status/1',
};
const bookmark = (tweetId: string, folderIds: string[]): Bookmark => ({
  accountId: 'unknown', tweetId, folderIds, savedAt: NOW, snapshot,
});
const descendantsOf: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['P', new Set(['C', 'G'])], ['C', new Set(['G'])], ['G', new Set<string>()],
]);
const posts = [bookmark('grandchild', ['P', 'C', 'G']), bookmark('child', ['P', 'C']), bookmark('parent', ['P'])];
const query = (folderId: string, exact = false, all = posts) => queryBookmarks(all, {
  folderId, search: '', sort: 'savedAsc', now: NOW, descendantsOf: exact ? descendantsOf : undefined,
});

describe('いちばん下の所属だけの一覧と件数', () => {
  it('省略時は孫のポストが親・子・孫に出る', () => {
    for (const id of ['P', 'C', 'G']) expect(inView(posts[0], id, NOW)).toBe(true);
  });

  it('オフでは孫のポストが孫にだけ出る', () => {
    expect(['P', 'C', 'G'].filter((id) => inView(posts[0], id, NOW, descendantsOf))).toEqual(['G']);
  });

  it('オフでは子のポストが子に出て親には出ない', () => {
    expect(query('C', true).map((b) => b.tweetId)).toEqual(['child']);
    expect(query('P', true).map((b) => b.tweetId)).toEqual(['parent']);
  });

  it('親だけの所属はオフでも親に出る', () => {
    expect(inView(posts[2], 'P', NOW, descendantsOf)).toBe(true);
  });

  it('オン・オフとも件数が一覧と一致し、すべての件数は変わらない', () => {
    for (const exact of [false, true]) {
      for (const id of ['P', 'C', 'G', ALL_FOLDER_ID]) {
        expect(countFolder(posts, id, NOW, exact ? descendantsOf : undefined)).toBe(query(id, exact).length);
      }
    }
    expect(countFolder(posts, ALL_FOLDER_ID, NOW, descendantsOf)).toBe(3);
  });

  it('最近と未分類の判定は子孫表があっても変わらない', () => {
    const all = [...posts, bookmark('inbox', [INBOX_ID]), { ...bookmark('old', ['P']), savedAt: NOW - RECENT_MS - 1 }];
    for (const id of [ALL_FOLDER_ID, RECENT_ID, INBOX_ID]) {
      expect(query(id, true, all)).toEqual(query(id, false, all));
      expect(countFolder(all, id, NOW, descendantsOf)).toBe(countFolder(all, id, NOW));
    }
  });

  it('別の枝の所属は、どちらのいちばん下にも出る', () => {
    const multiple = bookmark('multiple', ['P', 'C', 'G', 'Q']);
    expect(inView(multiple, 'P', NOW, descendantsOf)).toBe(false);
    expect(inView(multiple, 'G', NOW, descendantsOf)).toBe(true);
    expect(inView(multiple, 'Q', NOW, descendantsOf)).toBe(true);
  });

  it('検索とフィルターは所属の判定に加えて適用される', () => {
    const image = {
      ...bookmark('image', ['P']),
      snapshot: { ...snapshot, text: 'Sample image', media: ['sample.png'] },
    };
    const all = [...posts, image];
    expect(queryBookmarks(all, {
      folderId: 'P', search: 'image', sort: 'savedAsc', filters: { image: true }, descendantsOf,
    }).map((b) => b.tweetId)).toEqual(['image']);
  });

  it('24000 件も子孫の対応表を使って同じ件数に絞り込む', () => {
    const all = Array.from({ length: 24000 }, (_, index) => ({ ...posts[index % 3], tweetId: String(index) }));
    const children = new Set(['C', 'G', ...Array.from({ length: 1000 }, (_, index) => 'sample-child-' + index)]);
    const largeTree = new Map([['P', children]]);
    expect(queryBookmarks(all, {
      folderId: 'P', search: '', sort: 'savedAsc', descendantsOf: largeTree,
    })).toHaveLength(8000);
    expect(countFolder(all, 'P', NOW, largeTree)).toBe(8000);
  });
});

const root = () => document.getElementById('app')!;
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const row = (id: string) => root().querySelector<HTMLElement>('[data-folder-id="' + id + '"]')!;
const rows = () => [...root().querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row'));
const count = (id: string) => row(id).querySelector('.n')!.textContent;
const click = async (el: HTMLElement) => {
  await act(() => void el.click());
  await flush();
};

beforeEach(() => {
  installChromeMock();
  setAccountScope('unknown');
  vi.stubGlobal('innerWidth', 1280);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  history.replaceState(null, '', '/');
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  render(null, root());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const surface of ['tab', 'sidepanel'] as const) {
  it(surface + ': 同じ画面で設定を切り替えると一覧と件数がすぐ変わる', async () => {
    const parent = await createFolder({ name: 'Sample P' });
    const child = await createFolder({ name: 'Sample C', parentId: parent.id });
    const grandchild = await createFolder({ name: 'Sample G', parentId: child.id });
    await setBookmarkFolders('grandchild', [grandchild.id], snapshot);
    await setBookmarkFolders('child', [child.id], snapshot);
    await setBookmarkFolders('parent', [parent.id], snapshot);
    await updateSettings({ lastFolderId: parent.id });
    const before = await listBookmarks();
    await act(() => void render(<App surface={surface} />, root()));
    await flush();
    expect(rows().sort()).toEqual(['child', 'grandchild', 'parent']);
    expect(count(parent.id)).toBe('3');
    expect(count(child.id)).toBe('2');
    await act(async () => { await updateSettings({ showInAncestors: false }); });
    await flush();
    expect(rows()).toEqual(['parent']);
    expect(count(parent.id)).toBe('1');
    expect(count(child.id)).toBe('1');
    expect(count(grandchild.id)).toBe('1');
    expect(count(ALL_FOLDER_ID)).toBe('3');
    await click(row(child.id));
    expect(rows()).toEqual(['child']);
    await act(async () => { await updateSettings({ showInAncestors: true }); });
    await flush();
    expect(rows().sort()).toEqual(['child', 'grandchild']);
    expect(count(child.id)).toBe('2');
    expect(await listBookmarks()).toEqual(before);
  });
}

it('保存されたオフ設定を読み、フォルダの付け替え後も子孫表を作り直す', async () => {
  const parent = await createFolder({ name: 'Sample P' });
  const child = await createFolder({ name: 'Sample C', parentId: parent.id });
  await setBookmarkFolders('child', [child.id], snapshot);
  await updateSettings({ lastFolderId: parent.id, showInAncestors: false });
  await act(() => void render(<App />, root()));
  await flush();
  expect(rows()).toEqual([]);
  expect(count(parent.id)).toBe('0');
  await act(async () => { await updateFolder(child.id, { parentId: null }); });
  await flush();
  expect(rows()).toEqual(['child']);
  expect(count(parent.id)).toBe('1');
});
