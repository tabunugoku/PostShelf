import { useEffect, useRef, useState } from 'preact/hooks';
import { requestDiagnostics } from '../shared/activeTab';
import { buildReport } from '../shared/diagnostics';
import { ISSUE_URL } from '../shared/links';
import { getHealth } from '../shared/settings';
import { t } from '../shared/strings';
import { Icon } from '../shared/Icon';

/** x.com のタブから診断情報を作る。タブが無ければ、拡張側で分かる範囲 (バージョン等と health) だけ */
export async function makeReport(): Promise<string> {
  const fromTab = await requestDiagnostics();
  if (fromTab) return fromTab;
  return buildReport({
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    uiLanguage: chrome.i18n.getUILanguage(),
    health: await getHealth(),
    skeleton: null,
  });
}

/**
 * 診断情報の確認ダイアログ。コピーする内容をそのまま表示し、ユーザーが「コピー」を押したときだけクリップボードに入れる。
 * 「GitHub で報告」は Issue の新規作成画面を新しいタブで開くだけ (診断情報は自動では貼らない)。
 */
export function DiagnosticsDialog(props: { onClose: () => void }) {
  const [report, setReport] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    void makeReport().then(setReport);
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report ?? '');
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="diag-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="diag-title" class="dialog-title">{t('diagTitle')}</h2>
        <p class="diag-notice">{t('diagNotice')}</p>
        <pre class="diag-pre" tabIndex={0} aria-label={t('diagTitle')}>{report ?? t('diagPreparing')}</pre>
        {state === 'copied' && <p class="muted" role="status">{t('diagCopied')}</p>}
        {state === 'failed' && <p class="error" role="alert">{t('diagCopyFail')}</p>}
        <div class="dialog-actions">
          <a class="btn-link" href={ISSUE_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="ti-brand-github" /> {t('diagReport')}
          </a>
          <span class="grow" />
          <button ref={close} onClick={props.onClose}>
            {t('dismiss')}
          </button>
          <button class="primary" disabled={report === null} onClick={() => void copy()}>
            <Icon name="ti-copy" /> {t('diagCopy')}
          </button>
        </div>
      </div>
    </div>
  );
}
