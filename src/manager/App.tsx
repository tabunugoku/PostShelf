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
import { createFolder, deleteFolder, listBookmarks, listFolders, updateFolder } from '../shared/storage';

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
    <div class="layout">
      <aside class="sidebar">
        <h2>{MGR.folders}</h2>
        {folders.map((f) => (
          <button
            key={f.id}
            class={`folder-item${f.id === current ? ' active' : ''}`}
            onClick={() => {
              setCurrent(f.id);
              setEditing(false);
            }}
          >
            <Icon name={f.icon} color={f.color} /> <span class="grow">{f.name}</span>
            <span class="count">{countFolder(bookmarks, f.id)}</span>
          </button>
        ))}
        <button
          class="folder-item"
          onClick={async () => {
            const f = await createFolder({ name: MGR.newFolder });
            await reload();
            setCurrent(f.id);
            setEditing(true);
          }}
        >
          <Icon name="ti-plus" /> {MGR.newFolder}
        </button>
      </aside>
      <main>
        <header class="header">
          {folder && (
            <h1>
              <Icon name={folder.icon} color={folder.color} /> {folder.name}
            </h1>
          )}
          {folder && !isBuiltinFolder(folder.id) && (
            <button onClick={() => setEditing(!editing)}>
              <Icon name="ti-pencil" /> {MGR.edit}
            </button>
          )}
          <span class="grow" />
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
          <div class="toggle">
            <button class={view === 'post' ? 'on' : ''} onClick={() => setView('post')}>
              {MGR.postView}
            </button>
            <button class={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
              {MGR.listView}
            </button>
          </div>
        </header>
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
        {view === 'post' ? (
          <div class="posts">
            {shown.map((b) => (
              <PostCard b={b} folderOf={folderName} />
            ))}
          </div>
        ) : (
          <ul class="list">
            {shown.map((b) => (
              <ListRow b={b} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function PostCard({ b, folderOf }: { b: Bookmark; folderOf: (id: string) => Folder | undefined }) {
  const s = b.snapshot;
  return (
    <article class="card">
      <div class="card-head">
        {s.avatar ? <img class="avatar" src={s.avatar} alt="" /> : <span class="avatar" />}
        <strong>{s.author}</strong> <span class="muted">{s.handle}</span>
        {s.createdAt && <span class="muted"> · {new Date(s.createdAt).toLocaleDateString('ja-JP')}</span>}
        <a class="grow-end" href={s.url} target="_blank" rel="noreferrer" title={MGR.openOnX}>
          <Icon name="ti-external-link" />
        </a>
      </div>
      <p class="text">{s.text}</p>
      {s.media.length > 0 && (
        <div class="media">
          {s.media.map((m) => (
            <img src={m} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <div class="tags">
        {b.folderIds.map((id) => {
          const f = folderOf(id);
          return f ? (
            <span class="tag">
              <Icon name={f.icon} color={f.color} /> {f.name}
            </span>
          ) : null;
        })}
      </div>
    </article>
  );
}

function ListRow({ b }: { b: Bookmark }) {
  const s = b.snapshot;
  return (
    <li class="row">
      <span class="muted">{s.handle}</span>
      <span class="text-1line">{s.text}</span>
      <a href={s.url} target="_blank" rel="noreferrer" title={MGR.openOnX}>
        <Icon name="ti-external-link" />
      </a>
    </li>
  );
}

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
    <section class="edit-panel">
      <label>
        {MGR.name} <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <div>
        {MGR.icon}
        <div class="grid">
          {ICONS.map((i) => (
            <button class={`icon-btn${i === icon ? ' on' : ''}`} aria-label={i} onClick={() => setIcon(i)}>
              <Icon name={i} />
            </button>
          ))}
        </div>
      </div>
      <div class={colorOk ? '' : 'disabled'} title={colorOk ? '' : MGR.colorOnlyFolder}>
        {MGR.color}
        <div class="grid">
          {COLORS.map((c) => (
            <button
              class={`swatch${c === color ? ' on' : ''}`}
              style={{ background: c }}
              aria-label={c}
              disabled={!colorOk}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      {error && <p class="error">{error}</p>}
      <div class="actions">
        <button onClick={save}>{MGR.save}</button>
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
