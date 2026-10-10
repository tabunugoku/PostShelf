import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';

/** 本体と引用の動画タイルで共有する表示だけの印。再生操作は持たない。 */
export function VideoBadge() {
  return <span class="badge" role="img" aria-label={t('videoBadge')}><Icon name="ti-video" /> {t('videoBadge')}</span>;
}
export function VideoTileContent({ children }: { children?: ComponentChildren }) {
  return <>{children}<span class="play" aria-hidden="true" /><VideoBadge /></>;
}
