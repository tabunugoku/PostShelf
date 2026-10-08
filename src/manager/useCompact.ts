import { useEffect, useState } from 'preact/hooks';

/** 幅がこの値以下ならサイドパネル向けの狭いレイアウト。超えたらタブ版のレイアウト (同じ部品を共用) */
export const COMPACT_MAX = 520;

export function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth <= COMPACT_MAX);
  useEffect(() => {
    const on = () => setCompact(window.innerWidth <= COMPACT_MAX);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return compact;
}
