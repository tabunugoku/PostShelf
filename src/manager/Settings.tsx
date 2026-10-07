import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';
import { getSettings, updateSettings, type ActionMode, type ButtonMode } from '../shared/settings';
import { exportData, importData } from '../shared/storage';
import { DiagnosticsDialog } from './Diagnostics';
import { HealthNotice } from './HealthNotice';

export function SettingsPage({ onChanged }: { onChanged: () => void }) {
  const [sync, setSync] = useState(false);
  const [bmode, setBmode] = useState<ButtonMode>('separate');
  const [amode, setAmode] = useState<ActionMode>('popup');
  const [diag, setDiag] = useState(location.hash === '#diagnostics');
  useEffect(() => {
    void getSettings().then((s) => {
      setSync(s.syncNative);
      setBmode(s.buttonMode);
      setAmode(s.actionMode);
    });
  }, []);
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
      </fieldset>
      {diag && <DiagnosticsDialog onClose={() => setDiag(false)} />}
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
