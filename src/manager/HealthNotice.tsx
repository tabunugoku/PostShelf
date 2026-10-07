import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { getHealth, onHealthChanged, type Health } from '../shared/settings';
import { t } from '../shared/strings';

export function useHealth(): [Health | null, boolean] {
  const [h, setH] = useState<Health | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const load = () => void getHealth().then((x) => { setH(x); setLoaded(true); });
    load();
    return onHealthChanged(load);
  }, []);
  return [h, loaded];
}

/**
 * X の画面構造の状態表示。ok のときは何も出さない (settings では「正常 (最終確認の時刻)」を出す)。
 * degraded / broken は文言と、broken では診断情報へのボタン。
 */
export function HealthNotice(props: { showOk?: boolean; onDiagnose?: () => void }) {
  const [h, loaded] = useHealth();
  if (!loaded) return null;
  if (!h) return props.showOk ? <p class="health health-unknown muted">{t('healthUnknown')}</p> : null;
  const when = new Date(h.checkedAt).toLocaleString(chrome.i18n.getUILanguage());
  if (h.state === 'ok') return props.showOk ? <p class="health health-ok"><Icon name="ti-circle-check" /> {t('healthOkAt', when)}</p> : null;
  const broken = h.state === 'broken';
  return (
    <div class={`health health-${h.state}`} role={broken ? 'alert' : 'status'}>
      <Icon name={broken ? 'ti-alert-triangle' : 'ti-info-circle'} />
      <span>{t(broken ? 'healthBroken' : 'healthDegraded')}</span>
      {broken && props.onDiagnose && (
        <button class="health-btn" onClick={props.onDiagnose}>
          {t('copyDiag')}
        </button>
      )}
    </div>
  );
}
