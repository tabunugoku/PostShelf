/**
 * 設定「長いポストの全文」(v24)。スイッチ、全文を取得していないポストの件数、「いま取得する」(確認を 1 回出す)、進み具合と「止める」、止めた理由。
 * 取得そのものは background (src/background/fulltext.ts) が行う。ここからは、メッセージで依頼するだけ。
 */
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';
import { SavedContext } from './settingsSaved';
import { reportStorageError } from './errorBus';
import { getFullTextRun, getSettings, onFullTextRunChanged, updateSettings, type FullTextRun, type Settings } from '../shared/settings';
import { getAccountScope, listTruncated, onDataChanged } from '../shared/storage';
import { Confirm, Sentences } from './ui';

export function FullTextSection({ reloadKey = 0 }: { reloadKey?: number }) {
  const saved = useContext(SavedContext);
  const [on, setOn] = useState(true);
  const [speed, setSpeed] = useState<Settings['fullTextSpeed']>('slow');
  const [tabs, setTabs] = useState<Settings['fullTextTabs']>(1);
  const [changing, setChanging] = useState(false);
  const changingRef = useRef(false);
  const [radioKey, setRadioKey] = useState(0);
  const change = async (patch: Partial<Settings>) => {
    if (changingRef.current) return;
    changingRef.current = true;
    setChanging(true);
    try {
      const s = await updateSettings(patch);
      setSpeed(s.fullTextSpeed);
      setTabs(s.fullTextTabs);
      saved();
    } catch {
      reportStorageError();
      // 保存値からラジオを作り直し、ブラウザが先に変えた選択を戻す。
      setRadioKey(key => key + 1);
    } finally {
      changingRef.current = false;
      setChanging(false);
    }
  };
  const [pending, setPending] = useState(0);
  const [run, setRun] = useState<FullTextRun | null>(null);
  const [ask, setAsk] = useState(false);
  const load = async () => {
    const settings = await getSettings();
    setOn(settings.fullText);
    setSpeed(settings.fullTextSpeed);
    setTabs(settings.fullTextTabs);
    setPending((await listTruncated()).length);
    setRun(await getFullTextRun());
  };
  useEffect(() => {
    void load();
    const offs = [onFullTextRunChanged(() => void load()), onDataChanged(() => void load())];
    return () => offs.forEach((o) => o());
  }, [reloadKey]);

  const send = (msg: object) => void chrome.runtime?.sendMessage?.(msg)?.catch?.(() => {});
  const running = !!run?.running;
  const reason = !running && run?.stopReason ? { limit: 'fullTextStopLimit', failures: 'fullTextStopFailures', user: 'fullTextStopUser' }[run.stopReason] : null;
  return (
    <fieldset class="setting-group full-text">
      <legend>{t('fullTextTitle')}</legend>
      <label class="setting">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={async (e) => {
            try {
              setOn((await updateSettings({ fullText: (e.target as HTMLInputElement).checked })).fullText);
              saved(); // 保存に成功したときだけ
            } catch {
              reportStorageError();
            }
          }}
        />
        <span>
          <strong>{t('fullTextSwitch')}</strong>
          <span class="muted setting-desc"><Sentences text={t('fullTextSwitchDesc')} /></span>
        </span>
      </label>
      {on && <div class="ft-speed-setting">
        <strong>{t('fullTextSpeed')}</strong>
        <div key={radioKey} class="ft-speed-options" role="radiogroup" aria-label={t('fullTextSpeed')}>
          {(['slow', 'standard'] as const).map(value => <label class="setting ft-choice">
            <input type="radio" name="ft-speed" value={value} checked={speed === value} disabled={changing}
              onChange={() => void change({ fullTextSpeed: value })} />
            <span>{t(value === 'slow' ? 'fullTextSpeedSlow' : 'fullTextSpeedStd')}</span>
          </label>)}
        </div>
        <p class="muted setting-desc ft-speed-desc">{t('fullTextSpeedDesc')}</p>
        {speed === 'standard' && <div class="ft-tab-setting">
          <strong>{t('fullTextTabs')}</strong>
          <div key={radioKey} class="ft-speed-options" role="radiogroup" aria-label={t('fullTextTabs')}>
            {([1, 2, 3] as const).map(value => <label class="setting ft-choice">
              <input type="radio" name="ft-tabs" value={value} checked={tabs === value} disabled={changing}
                onChange={() => void change({ fullTextTabs: value })} />
              <span>{t('fullTextTabsN', value)}</span>
            </label>)}
          </div>
        </div>}
      </div>}
      {on && (
        <>
          <div class="io ft-row">
            <span class="ft-pending">{t('fullTextPending', pending)}</span>
            {!running && (
              <button disabled={pending === 0} onClick={() => setAsk(true)}>
                <Icon name="ti-download" /> {t('fullTextRunNow')}
              </button>
            )}
            {running && (
              <>
                <span role="status" class="ft-progress">{run!.skipped ? t('fullTextProgressSkipped', run!.done, run!.total, run!.skipped) : t('fullTextProgress', run!.done, run!.total)}</span>
                <button onClick={() => send({ type: 'stopFullText' })}>{t('fullTextStop')}</button>
              </>
            )}
          </div>
          {reason && (
            <p class={`setting-desc ${run?.stopReason === 'user' ? 'muted' : 'error'}`} role="status">
              {t(reason)}
            </p>
          )}
        </>
      )}
      {ask && (
        <Confirm
          message={t('fullTextConfirm', Math.min(pending, 50))}
          confirmLabel={t('fullTextStart')}
          onCancel={() => setAsk(false)}
          onConfirm={() => {
            setAsk(false);
            send({ type: 'fetchFullText', kind: 'manual', accountId: getAccountScope() });
          }}
        />
      )}
    </fieldset>
  );
}
