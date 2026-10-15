import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { RELEASES_URL } from '../shared/links';
import { onSettingsChanged } from '../shared/settings';
import { t } from '../shared/strings';
import { cachedUpdate, checkForUpdate, displayVersion } from '../shared/updateCheck';

/**
 * 新しいバージョンの案内 (v73)。設定「新しいバージョンを確かめる」がオフ、または新しいバージョンが無いときは何も出さない。
 * ask: 問い合わせてよい画面 (管理画面・サイドパネル)。ポップアップは false にして、前回の結果だけを出す
 */
export function UpdateAvailable({ ask }: { ask: boolean }) {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // 設定でオンにしたときも、すぐ確かめる (24 時間以内なら問い合わせず、前回の結果を使う)
    const load = () => {
      void (ask ? checkForUpdate() : cachedUpdate())
        .then((v) => {
          if (alive) setLatest(v);
        })
        .catch(() => undefined); // 確かめられないときは、案内を出さないだけ
    };
    load();
    const off = onSettingsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [ask]);
  if (!latest) return null;
  return (
    <div class="health health-degraded update-available" role="status">
      <Icon name="ti-info-circle" />
      <span>{t('updateAvailable', displayVersion(latest))}</span>
      <a
        class="health-btn"
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('updateAvailableLinkAria')}
      >
        {t('updateAvailableLink')}
      </a>
    </div>
  );
}
