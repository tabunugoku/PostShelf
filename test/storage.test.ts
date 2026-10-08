import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { ALL_FOLDER_ID, COLORS, displayName } from '../src/shared/models';
import { createFolder, deleteFolder, listFolders, updateFolder } from '../src/shared/storage';

let data: Record<string, unknown>;
beforeEach(() => {
  data = installChromeMock();
});

describe('folders', () => {
  it('starts with only the built-in "すべて" folder', async () => {
    const f = await listFolders();
    expect(f.map((x) => x.id)).toEqual([ALL_FOLDER_ID]);
    expect(displayName(f[0])).toBe('すべて');
  });

  it('creates folders in order with default folder icon', async () => {
    const a = await createFolder({ name: ' 開発 ' });
    const b = await createFolder({ name: '本', icon: 'ti-book' });
    expect(a.name).toBe('開発');
    expect(a.icon).toBe('ti-folder');
    expect(b.order).toBeGreaterThan(a.order);
    expect((await listFolders()).map(displayName)).toEqual(['すべて', '開発', '本']);
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

  it('allows a color for any icon and keeps it when the icon changes', async () => {
    const star = await createFolder({ name: 'b', icon: 'ti-star', color: COLORS[1] });
    expect(star.color).toBe(COLORS[1]);
    const code = await updateFolder(star.id, { icon: 'ti-code' });
    expect(code.color).toBe(COLORS[1]); // アイコンを変えても色は消えない
    const recolored = await updateFolder(star.id, { color: COLORS[2] });
    expect(recolored).toMatchObject({ icon: 'ti-code', color: COLORS[2] });
    const back = await updateFolder(star.id, { icon: 'ti-folder' });
    expect(back.color).toBe(COLORS[2]);
  });

  it('can go back to "no color" and rejects colors outside the allow-list', async () => {
    const f = await createFolder({ name: 'a', icon: 'ti-heart', color: COLORS[0] });
    expect((await updateFolder(f.id, { color: null })).color).toBeUndefined();
    await expect(updateFolder(f.id, { color: '#000000' })).rejects.toThrow();
    await expect(createFolder({ name: 'x', color: 'red' })).rejects.toThrow();
  });

  it('reads legacy data (non-folder icon without color, or no color at all)', async () => {
    data.folders = [
      { id: 'o1', name: 'old', icon: 'ti-star', order: 0 },
      { id: 'o2', name: 'old2', icon: 'ti-folder', order: 1 },
    ];
    const f = await listFolders();
    expect(f.slice(1).map((x) => x.color)).toEqual([undefined, undefined]);
    expect((await updateFolder('o1', { color: COLORS[3] })).color).toBe(COLORS[3]);
  });

  it('protects the built-in folder', async () => {
    await expect(updateFolder(ALL_FOLDER_ID, { name: 'x' })).rejects.toThrow();
    await expect(deleteFolder(ALL_FOLDER_ID)).rejects.toThrow();
  });

  it('delete removes the folder id from bookmarks but keeps the bookmark', async () => {
    const f = await createFolder({ name: 'a' });
    data.bookmarks = { 'unknown:1': { accountId: 'unknown', tweetId: '1', folderIds: [f.id, 'other'], savedAt: 0, snapshot: {} } };
    await deleteFolder(f.id);
    expect((await listFolders()).length).toBe(1);
    expect((data.bookmarks as any)['unknown:1'].folderIds).toEqual(['other']);
    await expect(deleteFolder(f.id)).rejects.toThrow();
  });
});
