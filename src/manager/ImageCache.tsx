import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { afterPostsRemoved, cacheMissing, clearAllCaches, evictToFit, migrateStore, openStore, previewEviction, type OpenedStore } from '../shared/cacheops';
import { DirStore, NotOurFolderError, prepareDirectory, requestDirPermission, saveDirHandle, type DirHandleLike, type ImageStore, type Usage } from '../shared/imagecache';
import { hasImagePermission, requestImagePermission } from '../shared/permissions';
import {
  CACHE_MIN_BYTES,
  CACHE_SIZE_CHOICES,
  DEFAULT_IMAGE_CACHE,
  GB,
  MB,
  getCacheCleanupNeeded,
  getSettings,
  updateImageCache,
  type CacheBackend,
  type ImageCacheSettings,
} from '../shared/settings';
import { listAllBookmarks } from '../shared/storage';
import type { Bookmark } from '../shared/models';
import { t } from '../shared/strings';
import { notifyCacheChanged, refreshCacheView } from './cacheView';
import { Confirm } from './ui';

export function formatBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1).replace(/\.0$/, '')} GB`;
  if (n >= MB) return `${Math.round(n / MB).toLocaleString()} MB`;
  return `${Math.max(0, Math.round(n / 1024)).toLocaleString()} KB`;
}

type Dlg =
  | { kind: 'switch'; to: CacheBackend; count: number }
  | { kind: 'lower'; max: number; count: number }
  | { kind: 'clear'; count: number }
  | { kind: 'nonEmpty'; resolve: (ok: boolean) => void }
  | { kind: 'moving'; done: number; total: number }
  | null;

const pickerAvailable = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/** ポストごとに 1 件 (同じポストを複数アカウントで保存していても、画像は 1 組) */
const uniquePosts = (list: Bookmark[]): Bookmark[] => [...new Map(list.map((b) => [b.tweetId, b])).values()];

/**
 * 設定「画像のキャッシュ」(docs/mockups/media-viewer.html)。保存先 (ブラウザの中 / 自分で選んだフォルダ)、最大容量、画質、いっぱいになったとき。
 * 初期値はオフ。オンにするクリックの中で、画像サーバー (pbs.twimg.com) への任意の権限を Chrome に求める。
 */
export function ImageCacheSection(props: { surface: 'tab' | 'sidepanel'; /** 設定の初期化や取り消しのあとに読み直すための値 */ reloadKey?: number }) {
  const [cfg, setCfg] = useState<ImageCacheSettings>(DEFAULT_IMAGE_CACHE);
  const [opened, setOpened] = useState<OpenedStore>({ status: 'ok', store: null });
  const [usage, setUsage] = useState<Usage>({ bytes: 0, files: 0, posts: 0 });
  const [granted, setGranted] = useState(true);
  const [cleanup, setCleanup] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [custom, setCustom] = useState(false);
  const [customMb, setCustomMb] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef({ aborted: false });

  const load = async () => {
    const c = (await getSettings()).imageCache;
    setCfg(c);
    setGranted(await hasImagePermission());
    setCleanup(await getCacheCleanupNeeded());
    const o = await openStore(c.backend);
    setOpened(o);
    try {
      setUsage(o.store ? await o.store.usage() : { bytes: 0, files: 0, posts: 0 });
    } catch {
      setUsage({ bytes: 0, files: 0, posts: 0 });
    }
    setCustom(!(CACHE_SIZE_CHOICES as readonly number[]).includes(c.maxBytes));
    setCustomMb(String(Math.round(c.maxBytes / MB)));
    await refreshCacheView();
  };
  useEffect(() => void load(), [props.reloadKey]);

  const save = async (patch: Partial<ImageCacheSettings>) => {
    await updateImageCache(patch);
    await load();
  };
  const note = (text: string, error = false) => setMessage({ text, error });

  // ---- オン / オフ ----
  const toggle = async (checked: boolean) => {
    setMessage(null);
    if (!checked) return save({ enabled: false });
    // ユーザーのクリックの中で、最初に権限を求める (確認画面にはユーザー操作が必要)。拒否されたらスイッチはオフのまま
    if (!(await requestImagePermission())) {
      await load();
      return note(t('cachePermDenied'), true);
    }
    await save({ enabled: true });
  };
  const grantImages = async () => {
    if (await requestImagePermission()) await load();
    else note(t('cachePermDenied'), true);
  };

  // ---- フォルダ ----
  /** フォルダを選んで使えるようにする。選ばなかった / 使えなかったときは null */
  const pickFolder = async (): Promise<DirHandleLike | null> => {
    const w = window as unknown as { showDirectoryPicker?: (o: { mode: 'readwrite' }) => Promise<DirHandleLike> };
    if (!w.showDirectoryPicker) {
      note(t('cacheDirUnsupported'), true);
      return null;
    }
    let handle: DirHandleLike;
    try {
      handle = await w.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') note(t('cacheDirUnsupported'), true);
      return null;
    }
    try {
      await prepareDirectory(handle, t('cacheDirReadme'), () => new Promise<boolean>((resolve) => setDlg({ kind: 'nonEmpty', resolve })));
      await saveDirHandle(handle);
      return handle;
    } catch (e) {
      if (!(e instanceof NotOurFolderError)) note(t('cacheDirUnsupported'), true);
      return null;
    }
  };
  const repick = async () => {
    setMessage(null);
    if (await pickFolder()) await load();
  };
  const grantDir = async () => {
    if (opened.handle && (await requestDirPermission(opened.handle))) await load();
  };

  // ---- 保存先 ----
  const currentUsageOf = async (backend: CacheBackend): Promise<{ store: ImageStore | null; count: number }> => {
    const o = await openStore(backend);
    try {
      return { store: o.store, count: o.store ? (await o.store.list()).length : 0 };
    } catch {
      return { store: o.store, count: 0 };
    }
  };
  const chooseBackend = async (to: CacheBackend) => {
    if (to === cfg.backend) return;
    setMessage(null);
    if (to === 'dir') {
      // 選ぶ操作はユーザーのクリックの中で最初に行う。すでに選んだフォルダがあればそれを使う
      const existing = opened.handle ?? (await openStore('dir')).handle;
      if (!existing && !(await pickFolder())) return;
    }
    const from = await currentUsageOf(cfg.backend);
    if (from.count > 0) setDlg({ kind: 'switch', to, count: from.count });
    else await save({ backend: to });
  };
  const doSwitch = async (move: boolean) => {
    const d = dlg;
    if (d?.kind !== 'switch') return;
    setDlg(null);
    if (move) {
      const from = (await openStore(cfg.backend)).store;
      const to = (await openStore(d.to)).store;
      if (from && to) {
        setDlg({ kind: 'moving', done: 0, total: d.count });
        try {
          await migrateStore(from, to, (p) => setDlg({ kind: 'moving', ...p }));
        } catch {
          note(t('cacheMoveFail'), true);
        }
        setDlg(null);
      } else note(t('cacheMoveFail'), true);
    }
    await save({ backend: d.to });
    notifyCacheChanged();
  };

  // ---- 最大容量 ----
  const applyMax = async (max: number) => {
    const lowering = max < cfg.maxBytes;
    if (lowering && opened.store) {
      const n = await previewEviction(opened.store, max);
      if (n > 0) return setDlg({ kind: 'lower', max, count: n });
    }
    await save({ maxBytes: max });
  };
  const doLower = async () => {
    const d = dlg;
    if (d?.kind !== 'lower') return;
    setDlg(null);
    await save({ maxBytes: d.max });
    if (opened.store) await evictToFit(opened.store, d.max);
    await load();
    notifyCacheChanged();
  };
  const onSelect = (v: string) => {
    if (v === 'custom') {
      setCustom(true);
      return;
    }
    setCustom(false);
    void applyMax(Number(v));
  };
  const commitCustom = () => {
    const mb = Math.floor(Number(customMb));
    if (!Number.isFinite(mb) || mb * MB < CACHE_MIN_BYTES) {
      setCustomMb(String(Math.max(100, Math.round(cfg.maxBytes / MB))));
      return note(t('cacheMaxMin'), true);
    }
    setMessage(null);
    void applyMax(mb * MB);
  };

  // ---- まとめてキャッシュ / 削除 ----
  const bulk = async () => {
    if (!opened.store) return;
    setMessage(null);
    abort.current = { aborted: false };
    setProgress({ done: 0, total: 0 });
    const posts = uniquePosts(await listAllBookmarks());
    const r = await cacheMissing(opened.store, cfg, posts, { signal: abort.current, onProgress: setProgress });
    setProgress(null);
    if (r.total === 0) note(t('cacheBulkNothing'));
    else if (r.blocked) note(t('cacheBulkBlocked'), true);
    else if (r.full) note(t('cacheBulkFull'), true);
    else note(t('cacheBulkDone', r.cached, r.failed));
    await load();
    notifyCacheChanged();
  };
  const askClear = async () => setDlg({ kind: 'clear', count: usage.files });
  const doClear = async () => {
    setDlg(null);
    const ok = await clearAllCaches();
    note(ok ? t('cacheClearDone') : t('cacheCleanupNeeded'), !ok);
    await load();
    notifyCacheChanged();
  };
  const rescan = async () => {
    if (!(opened.store instanceof DirStore)) return;
    const n = await opened.store.rescan();
    note(t('cacheDirRescanDone', n));
    await load();
  };
  const cleanNow = async () => {
    await afterPostsRemoved();
    await load();
    notifyCacheChanged();
  };

  const dirMode = cfg.backend === 'dir';
  const tabOnly = props.surface === 'sidepanel' || !pickerAvailable();
  const dirName = opened.handle?.name;
  const pct = Math.min(100, Math.round((usage.bytes / cfg.maxBytes) * 100));
  const busy = progress !== null;
  const sizeValue = custom ? 'custom' : String(cfg.maxBytes);

  return (
    <fieldset class="setting-group image-cache">
      <legend>{t('cacheTitle')}</legend>
      <label class="setting">
        <input type="checkbox" role="switch" checked={cfg.enabled} onChange={(e) => void toggle((e.target as HTMLInputElement).checked)} />
        <span>
          <strong>{t('cacheEnable')}</strong>
          <span class="muted setting-desc">{t('cacheEnableDesc')}</span>
        </span>
      </label>
      {/* 初めてオンにするとき Chrome が許可を求める、という補足は、オンにする前に読める位置に置く (畳んでいても残す) */}
      <p class="muted setting-desc cache-perm-note">{t('cachePermNote')}</p>
      {message && (
        <p class={message.error ? 'error' : 'muted'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {cfg.enabled && !granted && (
        <div class="warn" role="alert">
          <b>{t('cachePermMissing')}</b>
          <button class="primary" onClick={() => void grantImages()}>
            {t('cacheGrant')}
          </button>
        </div>
      )}
      {!cfg.enabled && (
        <div class="fold" id="cache-collapsed">
          <span>{t('cacheCollapsedHint')}</span>
        </div>
      )}
      {!cfg.enabled && usage.files > 0 && (
        <div class="io">
          <button class="danger" disabled={busy} onClick={() => void askClear()}>
            {t('cacheClear')}
          </button>
        </div>
      )}
      {cfg.enabled && (<div>
        <div class="field">
          <div class="lab">{t('cacheDest')}</div>
          <label class="setting">
            <input type="radio" name="cacheBackend" checked={!dirMode} disabled={!cfg.enabled} onChange={() => void chooseBackend('idb')} />
            <span>{t('cacheDestIdb')}</span>
          </label>
          <label class="setting">
            <input type="radio" name="cacheBackend" checked={dirMode} disabled={!cfg.enabled} onChange={() => void chooseBackend('dir')} />
            <span>{t('cacheDestDir')}</span>
          </label>
          {dirMode && (
            <div class="dirbox">
              <div class="rowflex">
                <code>{dirName ?? t('cacheDirNone')}</code>
                {!tabOnly && (
                  <button disabled={!cfg.enabled} onClick={() => void repick()}>
                    {dirName ? t('cacheDirRepick') : t('cacheDirPick')}
                  </button>
                )}
                {opened.status === 'ok' && opened.store instanceof DirStore && (
                  <button onClick={() => void rescan()}>{t('cacheDirRescan')}</button>
                )}
              </div>
              {opened.status === 'needs-permission' && (
                <div class="warn" role="alert">
                  <b>{t('cacheDirPermNeeded')}</b> {t('cacheDirPermNote')}
                  <button class="primary" onClick={() => void grantDir()}>
                    {t('cacheGrant')}
                  </button>
                </div>
              )}
              {tabOnly && <div class="muted">{t(pickerAvailable() ? 'cacheDirTabOnly' : 'cacheDirUnsupported')}</div>}
            </div>
          )}
        </div>
        <div class="field">
          <div class="lab">{t('cacheMax')}</div>
          <div class="rowflex">
            <select aria-label={t('cacheMax')} value={sizeValue} disabled={!cfg.enabled} onChange={(e) => onSelect((e.target as HTMLSelectElement).value)}>
              {CACHE_SIZE_CHOICES.map((n) => (
                <option value={String(n)}>{formatBytes(n)}</option>
              ))}
              <option value="custom">{t('cacheMaxCustom')}</option>
            </select>
            {custom && (
              <label class="rowflex">
                <input
                  type="number"
                  min="100"
                  step="100"
                  aria-label={t('cacheMaxCustomLabel')}
                  value={customMb}
                  disabled={!cfg.enabled}
                  onInput={(e) => setCustomMb((e.target as HTMLInputElement).value)}
                  onBlur={commitCustom}
                  onKeyDown={(e) => e.key === 'Enter' && commitCustom()}
                />
                <span class="muted">MB</span>
              </label>
            )}
            <span class="muted">{t('cacheUsage', formatBytes(usage.bytes), formatBytes(cfg.maxBytes), usage.files.toLocaleString())}</span>
          </div>
          <div class="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('cacheMax')}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div class="field">
          <div class="lab">{t('cacheQuality')}</div>
          {(['large', 'orig'] as const).map((q) => (
            <label class="setting">
              <input type="radio" name="cacheQuality" checked={cfg.quality === q} disabled={!cfg.enabled} onChange={() => void save({ quality: q })} />
              <span>{t(q === 'large' ? 'cacheQualityLarge' : 'cacheQualityOrig')}</span>
            </label>
          ))}
        </div>
        <div class="field">
          <div class="lab">{t('cacheFull')}</div>
          {(['evict', 'stop'] as const).map((m) => (
            <label class="setting">
              <input type="radio" name="cacheFull" checked={cfg.onFull === m} disabled={!cfg.enabled} onChange={() => void save({ onFull: m })} />
              <span>{t(m === 'evict' ? 'cacheFullEvict' : 'cacheFullStop')}</span>
            </label>
          ))}
        </div>
        <div class="io">
          {busy ? (
            <>
              <span role="status">{t('cacheBulkProgress', progress!.done, progress!.total)}</span>
              <button onClick={() => (abort.current.aborted = true)}>{t('cacheBulkStop')}</button>
            </>
          ) : (
            <button disabled={!cfg.enabled || !opened.store || !granted} onClick={() => void bulk()}>
              {t('cacheBulk')}
            </button>
          )}
          <button class="danger" disabled={busy} onClick={() => void askClear()}>
            {t('cacheClear')}
          </button>
        </div>
        <p class="muted setting-desc">{t('cacheBulkHelp')}</p>
        <p class="muted setting-desc">{t('cacheRules')}</p>
      </div>)}
      {cleanup && (
        <div class="warn" role="alert">
          <span>{t('cacheCleanupNeeded')}</span>
          <button onClick={() => void cleanNow()}>{t('cacheCleanupNow')}</button>
        </div>
      )}

      {dlg?.kind === 'switch' && (
        <div class="overlay" onClick={() => setDlg(null)}>
          <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cs-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="cs-title" class="dialog-title">{t('cacheSwitchTitle')}</h2>
            <p>{t('cacheSwitchBody', dlg.count)}</p>
            <div class="dialog-actions">
              <button onClick={() => setDlg(null)}>{t('cancel')}</button>
              <button onClick={() => void doSwitch(false)}>{t('cacheSwitchKeep')}</button>
              <button class="primary" onClick={() => void doSwitch(true)}>{t('cacheSwitchMove')}</button>
            </div>
          </div>
        </div>
      )}
      {dlg?.kind === 'moving' && (
        <div class="overlay">
          <div class="dialog" role="alertdialog" aria-modal="true">
            <p role="status">{t('cacheSwitchProgress', dlg.done, dlg.total)}</p>
            <div class="meter"><i style={{ width: `${dlg.total ? Math.round((dlg.done / dlg.total) * 100) : 100}%` }} /></div>
          </div>
        </div>
      )}
      {dlg?.kind === 'lower' && <Confirm message={t('cacheLowerConfirm', dlg.count)} confirmLabel={t('cacheLowerBtn')} onCancel={() => { setDlg(null); void load(); }} onConfirm={() => void doLower()} />}
      {dlg?.kind === 'clear' && <Confirm message={t('cacheClearConfirm', dlg.count)} confirmLabel={t('delete')} onCancel={() => setDlg(null)} onConfirm={() => void doClear()} />}
      {dlg?.kind === 'nonEmpty' && (
        <Confirm
          message={t('cacheDirNonEmpty')}
          confirmLabel={t('cacheDirNonEmptyOk')}
          onCancel={() => { dlg.resolve(false); setDlg(null); }}
          onConfirm={() => { dlg.resolve(true); setDlg(null); }}
        />
      )}
    </fieldset>
  );
}
