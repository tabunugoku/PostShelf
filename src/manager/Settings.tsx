import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';
import { getSettings, resetSettings, restoreSettings, updateAutoCollect, updateSettings, type ActionMode, type ButtonMode } from '../shared/settings';
import { countAllData, exportData, importData, type DataCounts } from '../shared/storage';
import { Confirm, TypeToConfirm } from './ui';
import { ImageCacheSection } from './ImageCache';
import { deleteAllDataAndCache } from '../shared/cacheops';
import { refreshCacheView } from './cacheView';
import { DiagnosticsDialog } from './Diagnostics';
import { HealthNotice } from './HealthNotice';
import { INSTALL_URL, REPO_URL } from '../shared/links';
import { currentVersion } from '../shared/version';

export function SettingsPage({ onChanged, onApplied, onNotice, onAutoCollect, surface = 'tab' }: {
  /** 「ブックマークを自動で取り込む…」: 開始前の確認ダイアログを開く (ここでは始めない) */
  onAutoCollect?: () => void;
  /** 画像キャッシュのフォルダを選べるのはタブ版だけ */
  surface?: 'tab' | 'sidepanel';
  /** データが変わった (インポートなど) */
  onChanged: () => void;
  /** 設定やデータが変わって、開いている画面の表示を作り直す必要がある (初期化 / 取り消し / 全削除) */
  onApplied: () => void;
  /** 「元に戻す」付きのお知らせ (5 秒)。undo が無ければ通知だけ */
  onNotice: (message: string, undo?: () => Promise<void>) => void;
}) {
  const [sync, setSync] = useState(false);
  const [bmode, setBmode] = useState<ButtonMode>('separate');
  const [amode, setAmode] = useState<ActionMode>('popup');
  const [autoOn, setAutoOn] = useState(true);
  const [diag, setDiag] = useState(location.hash === '#diagnostics');
  const [dialog, setDialog] = useState<'reset' | 'deleteAll' | null>(null);
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [cacheKey, setCacheKey] = useState(0);
  const load = () =>
    void getSettings().then((s) => {
      setSync(s.syncNative);
      setBmode(s.buttonMode);
      setAmode(s.actionMode);
      setAutoOn(s.autoCollect.enabled);
    });
  useEffect(load, []);

  const doReset = async () => {
    setDialog(null);
    const backup = await resetSettings();
    load();
    setCacheKey((n) => n + 1);
    void refreshCacheView();
    onApplied();
    // 直後の 5 秒間は、初期化前の設定に戻せる
    onNotice(t('settingsResetDone'), async () => {
      await restoreSettings(backup);
      load();
      setCacheKey((n) => n + 1);
      void refreshCacheView();
      onApplied();
    });
  };
  const openDeleteAll = async () => {
    setCounts(await countAllData());
    setDialog('deleteAll');
  };
  const doDeleteAll = async () => {
    setDialog(null);
    const cacheCleared = await deleteAllDataAndCache(); // キャッシュした画像も消す。消せなくてもデータの削除は成功
    void refreshCacheView();
    setCacheKey((n) => n + 1);
    onApplied();
    onNotice(cacheCleared ? t('deleteAllDone') : `${t('deleteAllDone')} ${t('cacheCleanupNeeded')}`);
  };
  return (
    <section>
      <div class="bar">
        <Icon name="ti-settings" />
        <span class="bar-name">{t('settings')}</span>
      </div>
      <label class="setting">
        <input
          type="checkbox"
          role="switch"
          checked={sync}
          onChange={async (e) => setSync((await updateSettings({ syncNative: (e.target as HTMLInputElement).checked })).syncNative)}
        />
        <span>
          <strong>{t('syncNativeLabel')}</strong>
          <span class="muted setting-desc">{t('syncNativeDesc')}</span>
        </span>
      </label>
      <fieldset class="setting-group">
        <legend>{t('buttonModeHeading')}</legend>
        {(['separate', 'replace'] as const).map((m) => (
          <label class="setting">
            <input
              type="radio"
              name="buttonMode"
              checked={bmode === m}
              onChange={async () => setBmode((await updateSettings({ buttonMode: m })).buttonMode)}
            />
            <span>{t(m === 'separate' ? 'buttonModeSeparate' : 'buttonModeReplace')}</span>
          </label>
        ))}
        <p class="muted setting-desc">{t('buttonModeNote')}</p>
      </fieldset>
      <fieldset class="setting-group">
        <legend>{t('actionModeHeading')}</legend>
        {(['popup', 'sidepanel'] as const).map((m) => (
          <label class="setting">
            <input
              type="radio"
              name="actionMode"
              checked={amode === m}
              onChange={async () => setAmode((await updateSettings({ actionMode: m })).actionMode)}
            />
            <span>{t(m === 'popup' ? 'actionModePopup' : 'actionModeSidepanel')}</span>
          </label>
        ))}
        <p class="muted setting-desc">{t('actionModeNote')}</p>
      </fieldset>
      <ImageCacheSection surface={surface} reloadKey={cacheKey} />
      <fieldset class="setting-group">
        <legend>{t('dataSection')}</legend>
        <div class="io">
          <button onClick={() => downloadJson(exportData)}>{t('exportBtn')}</button>
          <label class="file-btn">
            {t('importBtn')}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                if (!file) return;
                try {
                  alert(t('importDone', await importData(JSON.parse(await file.text()))));
                } catch {
                  alert(t('importFail'));
                }
                input.value = '';
                onChanged();
              }}
            />
          </label>
        </div>
        <label class="setting ac-setting">
          <input
            type="checkbox"
            role="switch"
            checked={autoOn}
            onChange={async (e) => setAutoOn((await updateAutoCollect({ enabled: (e.target as HTMLInputElement).checked })).autoCollect.enabled)}
          />
          <span>
            <strong>{t('acSettingsSwitch')}</strong>
            <span class="muted setting-desc">{t('acSettingsSwitchDesc')}</span>
          </span>
        </label>
        {autoOn && onAutoCollect && (
          <div class="io">
            <button onClick={onAutoCollect}>
              <Icon name="ti-player-track-next" /> {t('acSettingsRun')}
            </button>
          </div>
        )}
        {autoOn && <p class="muted setting-desc">{t('acSettingsNote')}</p>}
        <p class="muted setting-desc version-info">
          <strong>{t('versionLabel', currentVersion())}</strong>
        </p>
        <p class="muted setting-desc">
          {t('updateGuide')}{' '}
          <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer">
            {t('installGuideLink')}
          </a>
        </p>
        <p class="repo-link">
          <a class="link-btn" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={t('githubLinkAria')}>
            <Icon name="ti-brand-github" />
            {t('githubLink')}
            <Icon name="ti-external-link" />
          </a>
        </p>
      </fieldset>
      <fieldset class="setting-group">
        <legend>{t('healthTitle')}</legend>
        <HealthNotice showOk onDiagnose={() => setDiag(true)} />
        <div class="io">
          <button onClick={() => setDiag(true)}>
            <Icon name="ti-stethoscope" /> {t('copyDiag')}
          </button>
        </div>
      </fieldset>
      <fieldset class="setting-group">
        <legend>{t('settingsResetHeading')}</legend>
        <p class="muted setting-desc">{t('settingsResetDesc')}</p>
        <div class="io">
          <button onClick={() => setDialog('reset')}>
            <Icon name="ti-restore" /> {t('settingsResetBtn')}
          </button>
        </div>
      </fieldset>
      <fieldset class="setting-group danger-zone">
        <legend class="danger-text">{t('dangerHeading')}</legend>
        <p class="muted setting-desc">{t('deleteAllDesc')}</p>
        <div class="io">
          <button class="danger" onClick={() => void openDeleteAll()}>
            <Icon name="ti-trash" /> {t('deleteAllBtn')}
          </button>
        </div>
      </fieldset>
      {diag && <DiagnosticsDialog onClose={() => setDiag(false)} />}
      {dialog === 'reset' && (
        <Confirm message={t('settingsResetConfirm')} confirmLabel={t('settingsResetConfirmBtn')} onCancel={() => setDialog(null)} onConfirm={() => void doReset()} />
      )}
      {dialog === 'deleteAll' && counts && (
        <TypeToConfirm title={t('deleteAllBtn')} word={t('deleteAllWord')} confirmLabel={t('delete')} onCancel={() => setDialog(null)} onConfirm={() => void doDeleteAll()}>
          <p>{t('deleteAllCounts', counts.folders, counts.posts, counts.accounts)}</p>
          <p>
            <button onClick={() => void downloadJson(exportData)}>
              <Icon name="ti-download" /> {t('deleteAllExport')}
            </button>
          </p>
          <p class="error">{t('deleteAllWarn', t('deleteAllWord'))}</p>
        </TypeToConfirm>
      )}
    </section>
  );
}

async function downloadJson(make: typeof exportData): Promise<void> {
  const blob = new Blob([JSON.stringify(await make(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `postshelf-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
