/** 設定ストア。chrome.storage.local の別キー (`settings`)。storage.ts と同様、直接 chrome.storage を触るのはここだけ。 */
export interface Settings {
  /** フォルダ保存に合わせて X 本来のブックマークも付ける/外す (既定オフ) */
  syncNative: boolean;
}

export const DEFAULT_SETTINGS: Settings = { syncNative: false };

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(res[KEY] as Partial<Settings> | undefined) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
