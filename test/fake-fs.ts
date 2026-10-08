import type { DirHandleLike, FileHandleLike } from '../src/shared/imagecache';

/** File System Access API の偽物 (メモリ上)。使う部分だけ。permission は変更できる */
export class FakeFile implements FileHandleLike {
  readonly kind = 'file' as const;
  data: Blob = new Blob([]);
  modified = Date.now();
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    return new File([this.data], this.name, { type: this.data.type, lastModified: this.modified });
  }
  async createWritable() {
    let buf: Blob | string = '';
    return {
      write: async (d: Blob | string) => void (buf = d),
      close: async () => {
        this.data = typeof buf === 'string' ? new Blob([buf], { type: 'text/plain' }) : buf;
        this.modified = Date.now();
      },
    };
  }
}

export class FakeDir implements DirHandleLike {
  readonly kind = 'directory' as const;
  children = new Map<string, FakeDir | FakeFile>();
  permission: 'granted' | 'prompt' | 'denied' = 'granted';
  constructor(public name = 'root') {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandleLike> {
    const c = this.children.get(name);
    if (c instanceof FakeDir) return c;
    if (c || !o?.create) throw new DOMException('not found', 'NotFoundError');
    const d = new FakeDir(name);
    this.children.set(name, d);
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandleLike> {
    const c = this.children.get(name);
    if (c instanceof FakeFile) return c;
    if (c || !o?.create) throw new DOMException('not found', 'NotFoundError');
    const f = new FakeFile(name);
    this.children.set(name, f);
    return f;
  }
  async removeEntry(name: string, o?: { recursive?: boolean }): Promise<void> {
    const c = this.children.get(name);
    if (!c) throw new DOMException('not found', 'NotFoundError');
    if (c instanceof FakeDir && c.children.size && !o?.recursive) throw new DOMException('not empty', 'InvalidModificationError');
    this.children.delete(name);
  }
  async *entries(): AsyncIterable<[string, DirHandleLike | FileHandleLike]> {
    for (const [n, c] of [...this.children]) yield [n, c];
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    if (this.permission === 'prompt') this.permission = 'granted';
    return this.permission;
  }
  /** テスト用: パスのファイルの中身 */
  read(path: string): Blob {
    let d: FakeDir | FakeFile = this;
    for (const p of path.split('/')) d = (d as FakeDir).children.get(p)!;
    return (d as FakeFile).data;
  }
  /** テスト用: 中身 (相対パスの一覧) */
  paths(prefix = ''): string[] {
    return [...this.children].flatMap(([n, c]) => (c instanceof FakeDir ? c.paths(`${prefix}${n}/`) : [`${prefix}${n}`])).sort();
  }
  /** テスト用: パスのファイルを置く (他のユーザーのファイルを模す) */
  put(path: string, content: string | Blob = 'x'): void {
    const parts = path.split('/');
    let d: FakeDir = this;
    for (const p of parts.slice(0, -1)) {
      let n = d.children.get(p) as FakeDir | undefined;
      if (!n) d.children.set(p, (n = new FakeDir(p)));
      d = n;
    }
    const f = new FakeFile(parts[parts.length - 1]);
    f.data = typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content;
    d.children.set(f.name, f);
  }
}
