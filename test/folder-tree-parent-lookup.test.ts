// 版: v62-f
import { expect, it, vi } from 'vitest';
import { ancestors, descendantsMap } from '../src/shared/folderTree';
import { ALL_FOLDER_ID, INBOX_ID, type Folder } from '../src/shared/models';

const folder = (id: string, parentId?: string, accountId: string | undefined = 'sample_me'): Folder => ({
  id, parentId, accountId, name: 'Sample ' + id, icon: 'ti-folder', order: 0,
});

function previousMap(folders: readonly Folder[]): Map<string, Set<string>> {
  const children = new Map(folders.map((f) => [f.id, new Set<string>()]));
  for (const f of folders) {
    for (const parent of ancestors(folders, f.id)) children.get(parent.id)!.add(f.id);
  }
  return children;
}

const cases: [string, Folder[]][] = [
  ['3 段と別の枝', [folder('G', 'C'), folder('P'), folder('Q'), folder('C', 'P')]],
  ['別アカウントの親参照', [folder('P'), folder('C', 'P', 'sample_other'), folder('G', 'C', 'sample_other')]],
  ['組み込みフォルダ', [
    folder(ALL_FOLDER_ID), folder(INBOX_ID), folder('C', INBOX_ID), folder('G', 'C'), folder('P', ALL_FOLDER_ID),
  ]],
  ['壊れた親の参照', [folder('P', 'missing'), folder('C', 'P'), folder('orphan', 'missing')]],
  ['循環と自己参照', [
    folder('A', 'B'), folder('B', 'C'), folder('C', 'A'), folder('D', 'B'), folder('self', 'self'),
  ]],
  ['アカウントの省略', [
    { ...folder('P'), accountId: undefined }, { ...folder('C', 'P'), accountId: undefined }, folder('other', 'P'),
  ]],
];

it.each(cases)('%s の子孫表は ancestors から作った従来の表と一致する', (_, folders) => {
  expect(descendantsMap(folders)).toEqual(previousMap(folders));
});

it('各フォルダの親を探すたびに全フォルダを find しない', () => {
  const folders = [folder('P'), ...Array.from({ length: 300 }, (_, index) => folder('C' + index, 'P'))];
  const find = vi.spyOn(folders, 'find');
  try {
    const table = descendantsMap(folders);
    expect(table.get('P')?.size).toBe(300);
    expect(find).not.toHaveBeenCalled();
  } finally {
    find.mockRestore();
  }
});
