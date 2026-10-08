import { useEffect, useState } from 'preact/hooks';
import { openStore } from '../shared/cacheops';
import type { ImageStore } from '../shared/imagecache';
import { getSettings } from '../shared/settings';

/**
 * 表示用のキャッシュの状態 (manager の中で共有)。キャッシュがオンで保存先に届くときだけ store が入る。
 * 届かない (フォルダの許可が無い、など) ときは store が null で、画像は X の URL から読む。
 */
interface View {
  ready: boolean;
  enabled: boolean;
  store: ImageStore | null;
  /** キャッシュの中身が変わったら増える (表示を読み直すため) */
  version: number;
}

let view: View = { ready: false, enabled: false, store: null, version: 0 };
const listeners = new Set<() => void>();
const set = (v: Partial<View>) => {
  view = { ...view, ...v };
  listeners.forEach((l) => l());
};

/** 設定を読み直して、使う保存先を開き直す */
export async function refreshCacheView(): Promise<void> {
  try {
    const s = (await getSettings()).imageCache;
    if (!s.enabled) return set({ ready: true, enabled: false, store: null });
    const opened = await openStore(s.backend);
    set({ ready: true, enabled: true, store: opened.store });
  } catch {
    set({ ready: true, enabled: false, store: null });
  }
}

/** 画像がキャッシュに入った / 消えた */
export const notifyCacheChanged = (): void => set({ version: view.version + 1 });

export function useCacheView(): View {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return view;
}
