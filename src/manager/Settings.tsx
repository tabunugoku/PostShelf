import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { t } from '../shared/strings';
import { foldText } from '../shared/fold';
import { getSettings, onSettingsChanged, resetSettings, restoreSettings, updateAutoCollect, updateSettings, type ActionMode, type ButtonMode } from '../shared/settings';
import { countAllData, exportData, importData, type DataCounts } from '../shared/storage';
import { Confirm, Sentences, TypeToConfirm } from './ui';
import { ImageCacheSection } from './ImageCache';
import { SavedContext } from './settingsSaved';
import { reportStorageError } from './errorBus';
import { FullTextSection } from './FullText';
import { deleteAllDataAndCache } from '../shared/cacheops';
import { refreshCacheView } from './cacheView';
import { DiagnosticsDialog } from './Diagnostics';
import { HealthNotice } from './HealthNotice';
import { INSTALL_URL } from '../shared/links';
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
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  /** 「変更を保存しました」: この画面でスイッチ・選択を変えたあとの 2 秒だけ出す */
  const [flash, setFlash] = useState(false);
  const root = useRef<HTMLElement>(null);
  const load = () =>
    void getSettings().then((s) => {
      setSync(s.syncNative);
      setBmode(s.buttonMode);
      setAmode(s.actionMode);
      setAutoOn(s.autoCollect.enabled);
    });
  useEffect(load, []);
  /** 「変更を保存しました」を 2 秒出す。この画面で設定を書く処理が成功したときだけ呼ぶ (別タブの書き込みの通知では出さない) */
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const flashSaved = () => {
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2000);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  /** この画面での設定の書き込み。成功したら画面の値を合わせて「変更を保存しました」を出す。失敗したときは出さず、エラーを画面に出す */
  const saveOf = async <T,>(write: Promise<T>, apply: (r: T) => void): Promise<void> => {
    try {
      const r = await write;
      apply(r);
      flashSaved();
    } catch {
      reportStorageError();
    }
  };
  // 別のタブ・別の画面での変更も、画面の値には反映する (フラッシュは出さない)
  useEffect(() => onSettingsChanged(() => load()), []);
  // 設定の検索: 一致しない行は hidden にする (要素は消さない。状態を失わないため)。子の部品が遅れて描かれても追従する
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = () => setMatchCount(filterSettings(el, query));
    apply();
    if (!query.trim()) return;
    // 変化の通知は 1 回にまとめる (画像のキャッシュの進捗のように、文字が頻繁に変わる部品があっても、全行を比べ直すのは 100ms に 1 回まで)。
    // 検索結果・保存の表示の中だけの変化では、何もしない
    let timer: ReturnType<typeof setTimeout> | undefined;
    const own = (n: Node) => !!(n instanceof Element ? n : n.parentElement)?.closest('.settings-match, .settings-saved');
    const mo = new MutationObserver((list) => {
      if (timer !== undefined || list.every((m) => own(m.target))) return;
      timer = setTimeout(() => {
        timer = undefined;
        apply();
      }, 100);
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      clearTimeout(timer);
    };
  }, [query]);

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
  const groups = [
    ['save', 'groupSave'],
    ['collect', 'groupCollect'],
    ['behavior', 'groupBehavior'],
    ['data', 'groupData'],
    ['info', 'groupInfo'],
    ['reset', 'groupReset'],
  ] as const;
  /** 目次: URL のハッシュは使わない (管理画面は #settings などを画面の切り替えに使う)。見出しまでスクロールして、見出しにフォーカスを移す */
  const jump = (id: string) => {
    const h = document.getElementById(`set-group-${id}`);
    if (!h) return;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    h.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    h.focus({ preventScroll: true });
  };
  const heading = (id: string, key: string) => (
    <h3 class="set-h" id={`set-group-${id}`} data-group={id} tabIndex={-1}>
      {t(key)}
    </h3>
  );
  return (
    <section
      ref={root}
      class="settings-page"
    >
      <div class="bar">
        <Icon name="ti-settings" />
        <span class="bar-name">{t('settings')}</span>
        <span class="settings-saved muted" role="status" aria-live="polite">
          {flash ? t('settingsSaved') : ''}
        </span>
      </div>
      <label class="search settings-search">
        <Icon name="ti-search" />
        <input
          type="search"
          placeholder={t('settingsSearch')}
          aria-label={t('settingsSearch')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="muted settings-match" role="status" aria-live="polite">
        {query.trim() ? (matchCount > 0 ? t('settingsMatchCount', query.trim(), matchCount) : t('notFoundTitle')) : ''}
      </div>
      <nav class="settings-nav" aria-label={t('settingsJump')}>
        {groups.map(([id, key]) => (
          <button type="button" class="nav-chip" data-group={id} onClick={() => jump(id)}>
            {t(key)}
          </button>
        ))}
      </nav>
      {heading('save', 'groupSave')}
      <fieldset class="setting-group">
        <legend>{t('syncNativeSection')}</legend>
        <label class="setting">
        <input
          type="checkbox"
          role="switch"
          checked={sync}
          onChange={(e) => void saveOf(updateSettings({ syncNative: (e.target as HTMLInputElement).checked }), (s) => setSync(s.syncNative))}
        />
        <span>
          <strong>{t('syncNativeLabel')}</strong>
          {/* 他の設定と同じく、1 文を 1 行で描く (箇条書きはやめた。v37) */}
          <span class="muted setting-desc">
            {(['syncNativeDesc1', 'syncNativeDesc2', 'syncNativeDesc3', 'syncNativeNote'] as const).map((k) => (
              <span class="desc-line" key={k}>{t(k)}</span>
            ))}
          </span>
        </span>
      </label>
      </fieldset>
      <fieldset class="setting-group">
        <legend>{t('buttonModeHeading')}</legend>
        {(['separate', 'replace'] as const).map((m) => (
          <label class="setting">
            <input
              type="radio"
              name="buttonMode"
              checked={bmode === m}
              onChange={() => void saveOf(updateSettings({ buttonMode: m }), (s) => setBmode(s.buttonMode))}
            />
            <span>{t(m === 'separate' ? 'buttonModeSeparate' : 'buttonModeReplace')}</span>
          </label>
        ))}
        <p class="muted setting-desc"><Sentences text={t('buttonModeNote')} /></p>
      </fieldset>
      <SavedContext.Provider value={flashSaved}>
        <FullTextSection reloadKey={cacheKey} />
        <ImageCacheSection surface={surface} reloadKey={cacheKey} />
      </SavedContext.Provider>
      {heading('collect', 'groupCollect')}
      <fieldset class="setting-group">
        <legend>{t('acSection')}</legend>
        <label class="setting ac-setting">
          <input
            type="checkbox"
            role="switch"
            checked={autoOn}
            onChange={(e) => void saveOf(updateAutoCollect({ enabled: (e.target as HTMLInputElement).checked }), (s) => setAutoOn(s.autoCollect.enabled))}
          />
          <span>
            <strong>{t('acSettingsSwitch')}</strong>
            <span class="muted setting-desc"><Sentences text={t('acSettingsSwitchDesc')} /></span>
          </span>
        </label>
        {autoOn && onAutoCollect && (
          <div class="io">
            <button onClick={onAutoCollect}>
              <Icon name="ti-player-track-next" /> {t('acSettingsRun')}
            </button>
          </div>
        )}
        {autoOn && <p class="muted setting-desc"><Sentences text={t('acSettingsNote')} /></p>}
      </fieldset>
      {heading('behavior', 'groupBehavior')}
      <fieldset class="setting-group">
        <legend>{t('actionModeHeading')}</legend>
        {(['popup', 'sidepanel'] as const).map((m) => (
          <label class="setting">
            <input
              type="radio"
              name="actionMode"
              checked={amode === m}
              onChange={() => void saveOf(updateSettings({ actionMode: m }), (s) => setAmode(s.actionMode))}
            />
            <span>{t(m === 'popup' ? 'actionModePopup' : 'actionModeSidepanel')}</span>
          </label>
        ))}
        <p class="muted setting-desc"><Sentences text={t('actionModeNote')} /></p>
      </fieldset>
      {heading('data', 'groupData')}
      <fieldset class="setting-group">
        <legend>{t('dataMoveSection')}</legend>
        <p class="muted setting-desc"><Sentences text={t('dataMoveDesc')} /></p>
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
      {heading('info', 'groupInfo')}
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
        <legend>{t('aboutSection')}</legend>
        <p class="muted setting-desc version-info">
          <strong>{t('versionLabel', currentVersion())}</strong>
        </p>
        <p class="muted setting-desc">
          <Sentences text={t('updateGuide')}>
            <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer">
              {t('installGuideLink')}
            </a>
          </Sentences>
        </p>
      </fieldset>
      {heading('reset', 'groupReset')}
      <fieldset class="setting-group">
        <legend>{t('settingsResetHeading')}</legend>
        <p class="muted setting-desc"><Sentences text={t('settingsResetDesc')} /></p>
        <div class="io">
          <button onClick={() => setDialog('reset')}>
            <Icon name="ti-restore" /> {t('settingsResetBtn')}
          </button>
        </div>
      </fieldset>
      <fieldset class="setting-group danger-zone">
        <legend class="danger-text">{t('dangerHeading')}</legend>
        <p class="muted setting-desc"><Sentences text={t('deleteAllDesc')} /></p>
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

/**
 * 設定の検索。.setting の行は、項目名・説明の文字が一致するものだけを残す (グループの見出しが一致すれば、その中の行は残す)。
 * 行のないグループ (書き出し・初期化など) は、グループ全体の文字で比べる。一致のないグループと、その見出し・目次の項目も隠す。
 * 戻り値は、一致した行 (行のないグループは 1 件) の数。空の検索語では、すべて元に戻す。
 */
export function filterSettings(root: HTMLElement, raw: string): number {
  const q = foldText(raw.trim());
  const has = (el: Element) => foldText(el.textContent ?? '').includes(q);
  const groups = [...root.querySelectorAll<HTMLElement>('fieldset.setting-group')];
  let count = 0;
  for (const g of groups) {
    const rows = [...g.querySelectorAll<HTMLElement>('.setting')];
    let shown = true;
    if (q) {
      const legend = g.querySelector('legend');
      const titleHit = !!legend && has(legend);
      if (rows.length) {
        const hits = rows.map((r) => titleHit || has(r));
        rows.forEach((r, i) => (r.hidden = !hits[i]));
        shown = hits.some(Boolean);
        count += hits.filter(Boolean).length;
      } else {
        shown = has(g);
        if (shown) count++;
      }
    } else rows.forEach((r) => (r.hidden = false));
    g.hidden = !shown;
  }
  // 見出しと目次: 次の見出しまでのグループが 1 つでも見えているものだけ残す
  const heads = [...root.querySelectorAll<HTMLElement>('h3.set-h')];
  const chips = new Map([...root.querySelectorAll<HTMLElement>('.settings-nav .nav-chip')].map((c) => [c.dataset.group, c]));
  heads.forEach((h) => {
    let any = false;
    for (let n = h.nextElementSibling; n && !n.matches('h3.set-h'); n = n.nextElementSibling) {
      if (!(n as HTMLElement).hidden && (n.matches('fieldset.setting-group') || n.querySelector('fieldset.setting-group:not([hidden])'))) any = true;
    }
    h.hidden = !any;
    const chip = chips.get(h.dataset.group);
    if (chip) chip.hidden = !any;
  });
  return count;
}

async function downloadJson(make: typeof exportData): Promise<void> {
  const blob = new Blob([JSON.stringify(await make(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `postshelf-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
