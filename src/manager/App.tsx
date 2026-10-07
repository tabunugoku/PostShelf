import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import {
  ALL_FOLDER_ID,
  COLORS,
  ICONS,
  isBuiltinFolder,
  supportsColor,
  type Bookmark,
  type Folder,
} from '../shared/models';
import { countFolder, queryBookmarks, type SortKey } from '../shared/query';
import { MGR } from '../shared/strings';
import { createFolder, deleteFolder, exportData, importData, listBookmarks, listFolders, updateFolder } from '../shared/storage';
import { IO } from '../shared/strings';

const SORTS: [SortKey, string][] = [
  ['savedDesc', MGR.sortSavedDesc],
  ['savedAsc', MGR.sortSavedAsc],
  ['postedDesc', MGR.sortPostedDesc],
  ['postedAsc', MGR.sortPostedAsc],
];

export function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [current, setCurrent] = useState(ALL_FOLDER_ID);
  const [view, setView] = useState<'post' | 'list'>('post');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('savedDesc');
  const [editing, setEditing] = useState(false);

  const reload = async () => {
    setFolders(await listFolders());
    setBookmarks(await listBookmarks());
  };
  useEffect(() => {
    void reload();
  }, []);

  const folder = folders.find((f) => f.id === current) ?? folders[0];
  const shown = queryBookmarks(bookmarks, { folderId: current, search, sort });
  const folderName = (id: string) => folders.find((f) => f.id === id);

  return (
    <div class="ps">
      <aside class="side">
        <div class="side-title">{MGR.folders}</div>
        {folders.map((f) => (
          <div
            key={f.id}
            class={`fr${f.id === current ? ' on' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              setCurrent(f.id);
              setEditing(false);
            }}
          >
            <Icon name={f.icon} color={f.color} />
            <span class="fr-name">{f.name}</span>
            <span class="n">{countFolder(bookmarks, f.id)}</span>
          </div>
        ))}
        <div
          class="fr add"
          role="button"
          tabIndex={0}
          onClick={async () => {
            const f = await createFolder({ name: MGR.newFolder });
            await reload();
            setCurrent(f.id);
            setEditing(true);
          }}
        >
          <Icon name="ti-plus" />
          {MGR.newFolder}
        </div>
        <div class="io">
          <button onClick={() => downloadJson(exportData)}>{IO.export}</button>
          <label class="file-btn">
            {IO.import}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                if (!file) return;
                try {
                  alert(IO.importDone(await importData(JSON.parse(await file.text()))));
                } catch {
                  alert(IO.importFail);
                }
                input.value = '';
                await reload();
              }}
            />
          </label>
        </div>
      </aside>
      <main class="main">
        <div class="bar">
          {folder && <Icon name={folder.icon} color={folder.color} />}
          {folder && <span class="bar-name">{folder.name}</span>}
          {folder && !isBuiltinFolder(folder.id) && (
            <button class="icon-only" aria-label={MGR.edit} title={MGR.edit} onClick={() => setEditing(!editing)}>
              <Icon name="ti-edit" />
            </button>
          )}
          <div class="seg">
            <button class={view === 'post' ? 'on' : ''} onClick={() => setView('post')}>
              {MGR.postView}
            </button>
            <button class={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
              {MGR.listView}
            </button>
          </div>
        </div>
        <div class="tools">
          <input
            type="search"
            placeholder={MGR.search}
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
          <select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
            {SORTS.map(([k, l]) => (
              <option value={k}>{l}</option>
            ))}
          </select>
        </div>
        {editing && folder && !isBuiltinFolder(folder.id) && (
          <EditPanel
            key={folder.id}
            folder={folder}
            onDone={async (deleted) => {
              setEditing(false);
              if (deleted) setCurrent(ALL_FOLDER_ID);
              await reload();
            }}
          />
        )}
        {shown.length === 0 && <p class="empty">{MGR.empty}</p>}
        {view === 'post'
          ? shown.map((b) => <PostCard b={b} folderOf={folderName} />)
          : shown.map((b) => <ListRow b={b} folderOf={folderName} />)}
      </main>
    </div>
  );
}

function PostCard({ b, folderOf }: { b: Bookmark; folderOf: (id: string) => Folder | undefined }) {
  const s = b.snapshot;
  return (
    <article class="post">
      {s.avatar ? <img class="av" src={s.avatar} alt="" /> : <span class="av">{initials(s.author)}</span>}
      <div class="post-body">
        <div class="post-head">
          <strong>{s.author}</strong> <span class="muted">{s.handle}</span>
          {s.createdAt && <span class="muted"> · {new Date(s.createdAt).toLocaleDateString('ja-JP')}</span>}
        </div>
        <div class="text">{s.text}</div>
        {s.media.length > 0 && (
          <div class="media">
            {s.media.map((m) => (
              <img src={m} alt="" loading="lazy" />
            ))}
          </div>
        )}
        <div class="act">
          {b.folderIds.map((id) => {
            const f = folderOf(id);
            return f ? (
              <span class="tag" style={f.color ? { color: f.color } : undefined}>
                <Icon name={f.icon} /> {f.name}
              </span>
            ) : null;
          })}
          <a class="ext-link" href={s.url} target="_blank" rel="noreferrer" title={MGR.openOnX} aria-label={MGR.openOnX}>
            <Icon name="ti-external-link" />
          </a>
        </div>
      </div>
    </article>
  );
}

function ListRow({ b, folderOf }: { b: Bookmark; folderOf: (id: string) => Folder | undefined }) {
  const s = b.snapshot;
  const f = folderOf(b.folderIds[0]);
  return (
    <div class="mini">
      {f ? <Icon name={f.icon} color={f.color} /> : <Icon name="ti-bookmark" />}
      <span class="handle">{s.handle}</span>
      <span class="t">{s.text}</span>
      <a class="ext-link" href={s.url} target="_blank" rel="noreferrer" title={MGR.openOnX} aria-label={MGR.openOnX}>
        <Icon name="ti-external-link" />
      </a>
    </div>
  );
}

const initials = (name: string) => [...name.trim()].slice(0, 2).join('').toUpperCase();

function EditPanel({ folder, onDone }: { folder: Folder; onDone: (deleted?: boolean) => void }) {
  const [name, setName] = useState(folder.name);
  const [icon, setIcon] = useState(folder.icon);
  const [color, setColor] = useState<string | undefined>(folder.color);
  const [error, setError] = useState('');
  const colorOk = supportsColor(icon);

  const save = async () => {
    try {
      await updateFolder(folder.id, { name, icon, color: colorOk ? (color ?? null) : null });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section class="edit">
      <div class="erow">
        <span class="elabel">{MGR.name}</span>
        <input class="grow" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </div>
      <div class="erow wrap">
        <span class="elabel">{MGR.icon}</span>
        {ICONS.slice(0, 8).map((i) => (
          <button class={`ic${i === icon ? ' on' : ''}`} aria-label={i} onClick={() => setIcon(i)}>
            <Icon name={i} />
          </button>
        ))}
      </div>
      <div class={`erow${colorOk ? '' : ' disabled'}`} title={colorOk ? '' : MGR.colorOnlyFolder}>
        <span class="elabel">{MGR.color}</span>
        {COLORS.map((c) => (
          <button
            class={`sw${c === color ? ' on' : ''}`}
            style={{ background: c }}
            aria-label={c}
            disabled={!colorOk}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      {error && <p class="error">{error}</p>}
      <div class="erow">
        <button class="primary" onClick={save}>{MGR.save}</button>
        <button onClick={() => onDone()}>{MGR.cancel}</button>
        <button
          class="danger"
          onClick={async () => {
            if (!confirm(MGR.confirmDelete)) return;
            await deleteFolder(folder.id);
            onDone(true);
          }}
        >
          {MGR.delete}
        </button>
      </div>
    </section>
  );
}

async function downloadJson(make: typeof exportData): Promise<void> {
  const blob = new Blob([JSON.stringify(await make(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `postshelf-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
