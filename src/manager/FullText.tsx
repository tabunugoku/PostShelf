/**
 * 設定「長いポストの全文」(v24)。スイッチ、全文を取得していないポストの件数、「いま取得する」(確認を 1 回出す)、進み具合と「止める」、止めた理由。
 * 取得そのものは background (src/background/fulltext.ts) が行う。ここからは、メッセージで依頼するだけ。
 */
import { useContext, useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';
import { SavedContext } from './settingsSaved';
import { reportStorageError } from './errorBus';
import { getFullTextRun, getSettings, onFullTextRunChanged, updateSettings, type FullTextRun } from '../shared/settings';
import { getAccountScope, listTruncated, onDataChanged } from '../shared/storage';
import { Confirm } from './ui';

export function FullTextSection({ reloadKey = 0 }: { reloadKey?: number }) {
  const saved = useContext(SavedContext);
  const [on, setOn] = useState(true);
  const [pending, setPending] = useState(0);
  const [run, setRun] = useState<FullTextRun | null>(null);
  const [ask, setAsk] = useState(false);
  const load = async () => {
    setOn((await getSettings()).fullText);
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
          <span class="muted setting-desc">{t('fullTextSwitchDesc')}</span>
        </span>
      </label>
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
