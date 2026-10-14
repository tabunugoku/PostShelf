import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';
import { ALL_FOLDER, INBOX_ID, displayName, type Bookmark, type Folder } from '../shared/models';
import {
  ancestors,
  canParent,
  descendants,
  descendantsMap,
  flattenFolders,
  leafMemberFolders,
  memberFoldersInTreeOrder,
  normalizeFolderIds,
  reparentedFolderIds,
  withAncestors,
  withoutDeletedFolders,
  withoutDescendants,
} from '../shared/folderTree';
import { inView } from '../shared/query';

/** デモの架空のフォルダ。A・C・G・B は翻訳しない固定の記号。A > C > G の木と、1 段目の B */
const DEMO_ACCOUNT = 'me';
const folderOf = (id: string, order: number, parentId?: string): Folder => ({
  id,
  name: id,
  icon: 'ti-folder',
  order,
  accountId: DEMO_ACCOUNT,
  ...(parentId ? { parentId } : {}),
});
const INITIAL_FOLDERS: Folder[] = [folderOf('A', 0), folderOf('C', 0, 'A'), folderOf('G', 0, 'C'), folderOf('B', 1)];

type ResultKey =
  | 'demoStart'
  | 'demoResSave'
  | 'demoResAdd'
  | 'demoResUncheckChild'
  | 'demoResUncheckParent'
  | 'demoResMove'
  | 'demoResDelete'
  | 'demoNoFolder';

interface DemoState {
  /** 削除したフォルダも含む、木の表示用の一覧。削除済みは deleted に入る */
  folders: Folder[];
  deleted: ReadonlySet<string>;
  folderIds: string[];
  result: ResultKey;
}

const initialState = (): DemoState => ({
  folders: INITIAL_FOLDERS,
  deleted: new Set(),
  folderIds: [INBOX_ID],
  result: 'demoStart',
});

/** 計算に使う、削除されていないフォルダ */
const liveOf = (s: DemoState): Folder[] => s.folders.filter((f) => !s.deleted.has(f.id));

/** 保存データにも設定にも触れない、架空のポスト 1 件 */
const samplePost = (folderIds: string[]): Bookmark => ({
  accountId: DEMO_ACCOUNT,
  tweetId: 'demo',
  folderIds,
  savedAt: 0,
  snapshot: { text: '', author: '', handle: '', media: [], url: '' },
});

/** C・G を使う操作か。C を削除したあとは、何も変えずに demoNoFolder を出す */
const needsC = new Set(['save', 'uncheckChild', 'move', 'delete']);

/** 操作ごとの次の状態。削除済みの C・G を使う操作は、状態を変えずに demoNoFolder だけ返す */
function applyOperation(s: DemoState, op: string): DemoState {
  if (needsC.has(op) && s.deleted.has('C')) return { ...s, result: 'demoNoFolder' };
  const live = liveOf(s);
  switch (op) {
    case 'save':
      return { ...s, folderIds: withAncestors([...s.folderIds, 'G'], live), result: 'demoResSave' };
    case 'add':
      return { ...s, folderIds: withAncestors([...s.folderIds, 'B'], live), result: 'demoResAdd' };
    case 'uncheckChild':
      return { ...s, folderIds: normalizeFolderIds(withoutDescendants(s.folderIds, ['C'], live)), result: 'demoResUncheckChild' };
    case 'uncheckParent':
      return { ...s, folderIds: normalizeFolderIds(withoutDescendants(s.folderIds, ['A'], live)), result: 'demoResUncheckParent' };
    case 'move': {
      if (!canParent(live, 'C', 'B')) return s;
      // 付け替えの前の祖先。付け替えたあとの木からは求められない
      const oldAncestorIds = ancestors(live, 'C').map((f) => f.id);
      const folders = s.folders.map((f) => (f.id === 'C' ? { ...f, parentId: 'B', order: 0 } : f));
      const moved = folders.filter((f) => !s.deleted.has(f.id));
      return {
        ...s,
        folders,
        folderIds: normalizeFolderIds(reparentedFolderIds(s.folderIds, moved, 'C', oldAncestorIds)),
        result: 'demoResMove',
      };
    }
    case 'delete': {
      const removed = new Set(['C', ...descendants(live, 'C').map((f) => f.id)]);
      return {
        ...s,
        deleted: removed,
        folderIds: normalizeFolderIds(withoutDeletedFolders(s.folderIds, removed)),
        result: 'demoResDelete',
      };
    }
    default:
      return s;
  }
}

/** 設定の「フォルダ」の欄に置く、親子のフォルダの動きを試すデモ。保存データも設定も読み書きしない */
export function FolderDemo({ showInAncestors }: { showInAncestors: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      class="folder-demo"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{t('demoSummary')}</summary>
      {/* 閉じている間は状態を作らない。開き直すと最初からになる */}
      {open && <FolderDemoBody initialAncestors={showInAncestors} />}
    </details>
  );
}

function FolderDemoBody({ initialAncestors }: { initialAncestors: boolean }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [ancestorsOn, setAncestorsOn] = useState(initialAncestors);
  // 設定のスイッチが変わったら、デモのスイッチも追う (デモの中で切り替えたあとも、設定が変われば上書きする)
  useEffect(() => {
    setAncestorsOn(initialAncestors);
  }, [initialAncestors]);

  const live = liveOf(state);
  const post = samplePost(state.folderIds);
  const descendantsOf = ancestorsOn ? undefined : descendantsMap(live);
  const rows = flattenFolders(state.folders);
  const movedUnderB = state.folders.find((f) => f.id === 'C')?.parentId === 'B';
  const stored = memberFoldersInTreeOrder(live, state.folderIds);
  const shown = leafMemberFolders(live, state.folderIds);
  const run = (op: string) => setState((s) => applyOperation(s, op));

  /** そのフォルダの一覧にこのポストが出るか、所属しているが出ないか */
  const statusOf = (folderId: string): string => {
    if (inView(post, folderId, 0, descendantsOf)) return t('demoListed');
    return state.folderIds.includes(folderId) ? t('demoMemberHidden') : '';
  };
  const chips = (list: Folder[]) =>
    list.length ? (
      list.map((f) => <span class="folder-demo-chip" key={f.id}>{displayName(f)}</span>)
    ) : (
      <span class="folder-demo-chip">{t('inboxName')}</span>
    );
  const operations: [string, string, boolean?][] = [
    ['save', 'demoOpSave'],
    ['add', 'demoOpAdd'],
    ['uncheckChild', 'demoOpUncheckChild'],
    ['uncheckParent', 'demoOpUncheckParent'],
    ['move', 'demoOpMove', movedUnderB && !state.deleted.has('C')],
    ['delete', 'demoOpDelete'],
  ];

  return (
    <div class="folder-demo-body">
      <p class="muted setting-desc">{t('demoNote')}</p>
      <label class="setting">
        <input
          type="checkbox"
          role="switch"
          checked={ancestorsOn}
          onChange={(e) => setAncestorsOn((e.target as HTMLInputElement).checked)}
        />
        <span>{t('demoAncestorsToggle')}</span>
      </label>
      <h4 class="folder-demo-heading">{t('demoTreeHeading')}</h4>
      <ul class="folder-demo-tree">
        <li data-demo-row="all">
          <span class="folder-demo-name"><Icon name={ALL_FOLDER.icon} />{t('allFolderName')}</span>
          <span class="folder-demo-status">{statusOf(ALL_FOLDER.id)}</span>
        </li>
        <li data-demo-row={INBOX_ID}>
          <span class="folder-demo-name"><Icon name="ti-inbox" />{t('inboxName')}</span>
          <span class="folder-demo-status">{statusOf(INBOX_ID)}</span>
        </li>
        {rows.map(({ folder: f, depth }) => {
          const gone = state.deleted.has(f.id);
          return (
            <li key={f.id} data-demo-row={f.id} class={gone ? 'gone' : undefined}>
              <span class="folder-demo-name" style={{ paddingLeft: (depth - 1) * 16 + 'px' }}>
                {depth > 1 && <span aria-hidden="true">└</span>}
                <Icon name={f.icon} />
                {gone ? t('demoDeleted', f.name) : f.name}
              </span>
              <span class="folder-demo-status">{gone ? '' : statusOf(f.id)}</span>
            </li>
          );
        })}
      </ul>
      <h4 class="folder-demo-heading">{t('demoStoredHeading')}</h4>
      <div class="folder-demo-chips" data-demo-stored>{chips(stored)}</div>
      <h4 class="folder-demo-heading">{t('demoShownHeading')}</h4>
      <div class="folder-demo-chips" data-demo-shown>{chips(shown)}</div>
      <div class="folder-demo-ops">
        {operations.map(([op, key, disabled]) => (
          <button key={op} type="button" disabled={disabled} onClick={() => run(op)}>{t(key)}</button>
        ))}
        <button type="button" onClick={() => {
          setState(initialState());
          setAncestorsOn(initialAncestors);
        }}>
          {t('demoOpReset')}
        </button>
      </div>
      <p class="muted setting-desc" aria-live="polite" data-demo-result>{t(state.result)}</p>
    </div>
  );
}
