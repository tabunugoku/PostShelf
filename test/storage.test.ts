import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { ALL_FOLDER_ID, COLORS } from '../src/shared/models';
import { createFolder, deleteFolder, listFolders, updateFolder } from '../src/shared/storage';

let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
});

describe('folders', () => {
  it('starts with only the built-in "すべて" folder', async () => {
    const f = await listFolders();
    expect(f.map((x) => x.id)).toEqual([ALL_FOLDER_ID]);
    expect(f[0].name).toBe('すべて');
  });

  it('creates folders in order with default folder icon', async () => {
    const a = await createFolder({ name: ' 開発 ' });
    const b = await createFolder({ name: '本', icon: 'ti-book' });
    expect(a.name).toBe('開発');
    expect(a.icon).toBe('ti-folder');
    expect(b.order).toBeGreaterThan(a.order);
    expect((await listFolders()).map((x) => x.name)).toEqual(['すべて', '開発', '本']);
  });

  it('rejects empty names and unknown icons', async () => {
    await expect(createFolder({ name: '  ' })).rejects.toThrow();
    await expect(createFolder({ name: 'x', icon: 'ti-nope' })).rejects.toThrow();
  });

  it('renames and changes icon', async () => {
    const f = await createFolder({ name: 'a' });
    const u = await updateFolder(f.id, { name: 'b', icon: 'ti-star' });
    expect(u).toMatchObject({ name: 'b', icon: 'ti-star' });
  });

  it('allows color only for the folder icon', async () => {
    const f = await createFolder({ name: 'a', color: COLORS[0] });
    expect(f.color).toBe(COLORS[0]);
    const star = await updateFolder(f.id, { icon: 'ti-star' });
    expect(star.color).toBeUndefined();
    const star2 = await createFolder({ name: 'b', icon: 'ti-star', color: COLORS[1] });
    expect(star2.color).toBeUndefined();
    const back = await updateFolder(star.id, { icon: 'ti-folder', color: COLORS[2] });
    expect(back.color).toBe(COLORS[2]);
    expect((await updateFolder(back.id, { color: null })).color).toBeUndefined();
    await expect(updateFolder(back.id, { color: '#000000' })).rejects.toThrow();
  });

  it('protects the built-in folder', async () => {
    await expect(updateFolder(ALL_FOLDER_ID, { name: 'x' })).rejects.toThrow();
    await expect(deleteFolder(ALL_FOLDER_ID)).rejects.toThrow();
  });

  it('delete removes the folder id from bookmarks but keeps the bookmark', async () => {
    const f = await createFolder({ name: 'a' });
    data.bookmarks = { '1': { tweetId: '1', folderIds: [f.id, 'other'], savedAt: 0, snapshot: {} } };
    await deleteFolder(f.id);
    expect((await listFolders()).length).toBe(1);
    expect((data.bookmarks as any)['1'].folderIds).toEqual(['other']);
    await expect(deleteFolder(f.id)).rejects.toThrow();
  });
});
