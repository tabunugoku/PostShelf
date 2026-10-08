import type { SortKey } from './query';

/** 設定ストア。chrome.storage.local の別キー (`settings`)。storage.ts と同様、直接 chrome.storage を触るのはここだけ。 */
export interface Settings {
  /** フォルダ保存に合わせて X 本来のブックマークも付ける/外す (既定オフ) */
  syncNative: boolean;
  /** x.com の標準ブックマークボタンの扱い。separate: 横に PostShelf のボタンを足す / replace: 標準ボタンのクリックを PostShelf のフォルダ選択に差し替える */
  buttonMode: ButtonMode;
  /** ツールバーアイコンのクリック時の動作。popup: ポップアップ / sidepanel: サイドパネルを開く */
  actionMode: ActionMode;
  /** manager の表示状態 (最後に開いたビュー / 表示形式 / 並べ替え)。chrome.storage.local に保存 (localStorage は使わない) */
  lastFolderId: string;
  viewMode: ViewMode;
  sortKey: SortKey;
  /** 手動で選んだ表示アカウントの ID。'' = 選んでいない (最後に x.com で読み取ったアカウントを使う) */
  viewAccount: string;
  /** 画像のキャッシュ (v11)。初期値はオフ */
  imageCache: ImageCacheSettings;
}

export type CacheBackend = 'idb' | 'dir';

export interface ImageCacheSettings {
  enabled: boolean;
  /** idb: ブラウザの中 (IndexedDB) / dir: 自分で選んだフォルダ */
  backend: CacheBackend;
  /** 最大容量 (バイト) */
  maxBytes: number;
  /** 保存する画質: large = 標準 / orig = 元のサイズ */
  quality: 'large' | 'orig';
  /** 容量がいっぱいのとき: evict = 古いポストの画像から消す / stop = 新しい画像を保存しない */
  onFull: 'evict' | 'stop';
}

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
/** 選べる最大容量 (指定 = 任意の MB。最小 100 MB) */
export const CACHE_SIZE_CHOICES = [500 * MB, 1 * GB, 2 * GB, 5 * GB, 10 * GB] as const;
export const CACHE_MIN_BYTES = 100 * MB;

export const DEFAULT_IMAGE_CACHE: ImageCacheSettings = { enabled: false, backend: 'idb', maxBytes: 1 * GB, quality: 'large', onFull: 'evict' };

function normalizeImageCache(raw: unknown): ImageCacheSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ImageCacheSettings>;
  const d = DEFAULT_IMAGE_CACHE;
  return {
    enabled: r.enabled === true,
    backend: r.backend === 'dir' ? 'dir' : d.backend,
    maxBytes: typeof r.maxBytes === 'number' && Number.isFinite(r.maxBytes) && r.maxBytes >= CACHE_MIN_BYTES ? Math.floor(r.maxBytes) : d.maxBytes,
    quality: r.quality === 'orig' ? 'orig' : d.quality,
    onFull: r.onFull === 'stop' ? 'stop' : d.onFull,
  };
}

export type ViewMode = 'post' | 'list' | 'grid';

export type ActionMode = 'popup' | 'sidepanel';

export type ButtonMode = 'separate' | 'replace';

export const DEFAULT_SETTINGS: Settings = { syncNative: false, buttonMode: 'separate', actionMode: 'popup', lastFolderId: 'all', viewMode: 'post', sortKey: 'savedDesc', viewAccount: '', imageCache: DEFAULT_IMAGE_CACHE };

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  const stored = (res[KEY] ?? {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (merged.buttonMode !== 'replace') merged.buttonMode = 'separate'; // 不正値は既定に戻す
  if (merged.actionMode !== 'sidepanel') merged.actionMode = 'popup';
  if (!['post', 'list', 'grid'].includes(merged.viewMode)) merged.viewMode = 'post';
  if (!['savedDesc', 'savedAsc', 'postedDesc', 'postedAsc'].includes(merged.sortKey)) merged.sortKey = 'savedDesc';
  if (typeof merged.lastFolderId !== 'string') merged.lastFolderId = 'all';
  if (typeof merged.viewAccount !== 'string') merged.viewAccount = '';
  merged.imageCache = normalizeImageCache(stored.imageCache);
  return merged;
}

/** 設定が変わったら呼ばれる (別タブ・manager からの変更も拾う)。解除関数を返す */
export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && KEY in changes) void getSettings().then(cb);
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

// 読み出し → 書き込みの途中で別の更新が入って、片方の変更が消えないよう、更新は 1 つずつ順に行う
let queue: Promise<unknown> = Promise.resolve();

export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = queue.then(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** 画像キャッシュの設定だけを更新する (他の設定は変えない。更新は 1 つずつ順に行う) */
export function updateImageCache(patch: Partial<ImageCacheSettings>): Promise<Settings> {
  const run = queue.then(async () => {
    const cur = await getSettings();
    const next = { ...cur, imageCache: normalizeImageCache({ ...cur.imageCache, ...patch }) };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

// ---- 取り込み案内 (manager のバナー用) ----
// ブックマーク一覧 (/i/history) を開いたときに content script が「画面に出ている未取り込みの件数」を記録する。manager はそれを読んで案内を出す。
// 閉じた時点の件数 (dismissed) を保存し、記録された件数がそれを超えたときだけ再表示する。

export interface ImportHint {
  /** 最後に観測した未取り込み件数 */
  pending: number;
  /** バナーを閉じた時点の件数 */
  dismissed: number;
}

const HINT_KEY = 'importHint';

/** アカウントごとの記録 (v9)。旧形式 (アカウントなしの { pending, dismissed }) は読み飛ばす = 一時的な値なので次の観測で作り直される */
type HintMap = Record<string, Partial<ImportHint>>;

async function readHints(): Promise<HintMap> {
  const res = await chrome.storage.local.get(HINT_KEY);
  const raw = res[HINT_KEY];
  if (!raw || typeof raw !== 'object' || 'pending' in raw || 'dismissed' in raw) return {};
  return raw as HintMap;
}

export async function getImportHint(accountId: string): Promise<ImportHint> {
  const h = (await readHints())[accountId] ?? {};
  return { pending: Number(h.pending) || 0, dismissed: Number(h.dismissed) || 0 };
}

/** 観測した件数を記録する。件数が減ったら (取り込んだ等)、閉じた時点の件数も下げて、次の増加で再び案内できるようにする */
export async function recordPending(accountId: string, pending: number): Promise<void> {
  const h = await getImportHint(accountId);
  if (h.pending === pending && h.dismissed <= pending) return;
  await chrome.storage.local.set({ [HINT_KEY]: { ...(await readHints()), [accountId]: { pending, dismissed: Math.min(h.dismissed, pending) } } });
}

export async function dismissImportHint(accountId: string): Promise<void> {
  const h = await getImportHint(accountId);
  await chrome.storage.local.set({ [HINT_KEY]: { ...(await readHints()), [accountId]: { ...h, dismissed: h.pending } } });
}

export const shouldShowImportHint = (h: ImportHint): boolean => h.pending > h.dismissed;

export function onImportHintChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && HINT_KEY in changes) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}

// ---- X の画面構造の自己診断結果 (content script が保存し、popup / 設定が表示する。外部には送らない) ----

export type HealthState = 'ok' | 'degraded' | 'broken';

export interface Health {
  state: HealthState;
  /** 検査時刻 (ms) */
  checkedAt: number;
  /** 見つからなかった要素のキー (broken のとき) */
  missing: string[];
  /** 2 番目以降の候補 (フォールバック) で見つかった要素のキー (degraded のとき) */
  fallback: string[];
  /** 検査したときの x.com のパス (クエリなし。ユーザー名・ID は ? に伏せる = safePath 済み) */
  path?: string;
}

const HEALTH_KEY = 'health';

export async function getHealth(): Promise<Health | null> {
  const res = await chrome.storage.local.get(HEALTH_KEY);
  const h = res[HEALTH_KEY] as Partial<Health> | undefined;
  if (!h || !['ok', 'degraded', 'broken'].includes(h.state as string)) return null;
  return { state: h.state as HealthState, checkedAt: Number(h.checkedAt) || 0, missing: h.missing ?? [], fallback: h.fallback ?? [], path: typeof h.path === 'string' ? h.path : undefined };
}

export async function saveHealth(h: Health): Promise<void> {
  await chrome.storage.local.set({ [HEALTH_KEY]: h });
}

export function onHealthChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && HEALTH_KEY in changes) cb();
  };
  chrome.storage.onChanged?.addListener(listener as never);
  return () => chrome.storage.onChanged?.removeListener(listener as never);
}


// ---- 設定の初期化 (v9-F) ----

/** 初期化の取り消し用: 初期化前の保存内容 (undefined = キーがなかった) */
export interface SettingsBackup {
  settings: unknown;
  hints: unknown;
}

/**
 * 設定を DEFAULT_SETTINGS (唯一の初期値) に戻し、取り込みバナーの非表示記録 (dismissed) も 0 に戻す。
 * 戻さないもの: フォルダ、保存したポスト、アカウント情報、lastSeenAccount (どれも別のキーなので、ここでは触らない)。
 * `settings` キーの内容を丸ごと置き換えるので、設定の項目が増えても漏れない。取り消し用に初期化前の内容を返す。
 */
export async function resetSettings(): Promise<SettingsBackup> {
  const backup: SettingsBackup = {
    settings: (await chrome.storage.local.get(KEY))[KEY],
    hints: (await chrome.storage.local.get(HINT_KEY))[HINT_KEY],
  };
  const cleared = Object.fromEntries(Object.entries(await readHints()).map(([id, h]) => [id, { pending: Number(h.pending) || 0, dismissed: 0 }]));
  // updateSettings と同じ待ち行列に載せ、進行中の更新と順序が入れ替わらないようにする
  const run = queue.then(() => chrome.storage.local.set({ [KEY]: { ...DEFAULT_SETTINGS }, [HINT_KEY]: cleared }));
  queue = run.catch(() => undefined);
  await run;
  return backup;
}

/** resetSettings の取り消し */
export async function restoreSettings(b: SettingsBackup): Promise<void> {
  const run = queue.then(async () => {
    const items: Record<string, unknown> = {};
    if (b.settings !== undefined) items[KEY] = b.settings;
    if (b.hints !== undefined) items[HINT_KEY] = b.hints;
    if (Object.keys(items).length) await chrome.storage.local.set(items);
    if (b.settings === undefined) await chrome.storage.local.remove?.(KEY);
    if (b.hints === undefined) await chrome.storage.local.remove?.(HINT_KEY);
  });
  queue = run.catch(() => undefined);
  await run;
}

// ---- 画像キャッシュの状態 (v11-B) ----

const FAIL_KEY = 'imageCacheFailures';
/** 失敗が続く画像は、この回数失敗したら再試行を止める */
export const MAX_FETCH_FAILURES = 3;

/** 画像ごとの取得の失敗回数 (キー: `tweetId/名前`)。失敗は記録して、次の機会に再試行する */
export async function getCacheFailures(): Promise<Record<string, number>> {
  return ((await chrome.storage.local.get(FAIL_KEY))[FAIL_KEY] ?? {}) as Record<string, number>;
}
export async function recordCacheFailure(key: string): Promise<number> {
  const f = await getCacheFailures();
  f[key] = (f[key] ?? 0) + 1;
  await chrome.storage.local.set({ [FAIL_KEY]: f });
  return f[key];
}
export async function clearCacheFailure(key: string): Promise<void> {
  const f = await getCacheFailures();
  if (!(key in f)) return;
  delete f[key];
  await chrome.storage.local.set({ [FAIL_KEY]: f });
}
export async function resetCacheFailures(): Promise<void> {
  await chrome.storage.local.set({ [FAIL_KEY]: {} });
}

const CLEANUP_KEY = 'imageCacheCleanup';
/** ポストを消したときにキャッシュ側の削除に失敗した (フォルダの許可が無い、など)。後で整理が必要 */
export async function getCacheCleanupNeeded(): Promise<boolean> {
  return (await chrome.storage.local.get(CLEANUP_KEY))[CLEANUP_KEY] === true;
}
export async function setCacheCleanupNeeded(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [CLEANUP_KEY]: v });
}
