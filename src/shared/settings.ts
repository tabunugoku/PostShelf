/** 設定ストア。chrome.storage.local の別キー (`settings`)。storage.ts と同様、直接 chrome.storage を触るのはここだけ。 */
export interface Settings {
  /** フォルダ保存に合わせて X 本来のブックマークも付ける/外す (既定オフ) */
  syncNative: boolean;
  /** x.com の標準ブックマークボタンの扱い。separate: 横に PostShelf のボタンを足す / replace: 標準ボタンのクリックを PostShelf のフォルダ選択に差し替える */
  buttonMode: ButtonMode;
}

export type ButtonMode = 'separate' | 'replace';

export const DEFAULT_SETTINGS: Settings = { syncNative: false, buttonMode: 'separate' };

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  const stored = (res[KEY] ?? {}) as Partial<Settings>;
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (merged.buttonMode !== 'replace') merged.buttonMode = 'separate'; // 不正値は既定に戻す
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

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
