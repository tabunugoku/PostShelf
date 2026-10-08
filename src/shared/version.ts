/** 読み込んでいる拡張機能のバージョン (manifest の version) */
export const currentVersion = (): string => chrome.runtime?.getManifest?.().version ?? '';
