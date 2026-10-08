import { useEffect, useState } from 'preact/hooks';

/** 保存・読み込みの失敗を画面に出すための小さな通知口 (console だけで終わらせない) */
let current = false;
const subs = new Set<(v: boolean) => void>();
const set = (v: boolean) => {
  current = v;
  subs.forEach((s) => s(v));
};

export const reportStorageError = (): void => set(true);
export const clearStorageError = (): void => set(false);

export function useStorageError(): boolean {
  const [v, setV] = useState(current);
  useEffect(() => {
    subs.add(setV);
    setV(current);
    return () => void subs.delete(setV);
  }, []);
  return v;
}

/** 拾われなかった失敗 (await 忘れ・void で投げた保存など) を拾う */
export function installErrorHandlers(): void {
  window.addEventListener('unhandledrejection', () => reportStorageError());
  window.addEventListener('error', () => reportStorageError());
}
