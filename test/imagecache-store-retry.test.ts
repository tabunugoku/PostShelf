// 版: v68-e
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDir, FakeFile } from './fake-fs';
import { DirStore, IdbIndex, IdbStore, prepareDirectory } from '../src/shared/imagecache';

const blob = (type: string) => new Blob([new Uint8Array(10)], { type });
let factory: IDBFactory;

beforeEach(async () => {
  const fake = await import('fake-indexeddb');
  factory = new fake.IDBFactory();
});

/** 1 回目の open だけ失敗する IDBFactory */
function failingOnce(real: IDBFactory): IDBFactory {
  let calls = 0;
  return {
    open: (name: string, version?: number) => {
      calls += 1;
      if (calls > 1) return real.open(name, version);
      // 開けなかったことを知らせるだけの偽の要求
      const req: { error: DOMException; onerror?: () => void } = { error: new DOMException('boom', 'UnknownError') };
      setTimeout(() => req.onerror?.(), 0);
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe('IndexedDB の開き直し', () => {
  it('IdbStore: 1 回目の open が失敗しても、2 回目の put は成功する', async () => {
    const store = new IdbStore(failingOnce(factory));
    await expect(store.put('1', 'a', blob('image/jpeg'))).rejects.toBeTruthy();
    await store.put('1', 'a', blob('image/jpeg'));
    expect((await store.list()).length).toBe(1);
  });

  it('IdbIndex: 1 回目の open が失敗しても、2 回目は読める', async () => {
    const index = new IdbIndex(failingOnce(factory));
    await expect(index.all()).rejects.toBeTruthy();
    expect(await index.all()).toEqual([]);
  });
});

describe('DirStore.put の書き込みの失敗', () => {
  it('新しいファイルの書き込みに失敗しても、拡張子の違う古いファイルを消さず、一時ファイルを捨てる', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root);
    await store.put('1', 'a', blob('image/jpeg'));
    const post = (await (await root.getDirectoryHandle('images')).getDirectoryHandle('1')) as FakeDir;
    const abort = vi.fn(async () => {});
    const create = FakeDir.prototype.getFileHandle;
    post.getFileHandle = async (name: string, o?: { create?: boolean }) => {
      const handle = (await create.call(post, name, o)) as FakeFile;
      if (name === 'a.png') {
        handle.createWritable = async () => ({
          write: async () => { throw new Error('disk full'); },
          close: async () => {},
          abort,
        });
      }
      return handle;
    };
    await expect(store.put('1', 'a', blob('image/png'))).rejects.toThrow('disk full');
    expect([...post.children.keys()]).toContain('a.jpg');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('書き込みが成功したら、古い拡張子のファイルを消す', async () => {
    const root = new FakeDir('chosen');
    await prepareDirectory(root, 'r', async () => true);
    const store = new DirStore(root);
    await store.put('1', 'a', blob('image/jpeg'));
    await store.put('1', 'a', blob('image/png'));
    const post = (await (await root.getDirectoryHandle('images')).getDirectoryHandle('1')) as FakeDir;
    expect([...post.children.keys()].filter((n) => n.startsWith('a.'))).toEqual(['a.png']);
  });
});
