/**
 * ブックマークの自動取り込みの、管理画面側の部品 (v15-B-3。見た目の基準は docs/mockups/auto-collect.html)。
 *  - OfferBanner: 「X のブックマークを取り込みますか？」(自動では始まらない)
 *  - AutoCollectDialog: 開始前の確認 (同意のチェックを入れるまで「始める」は押せない)
 *  - ProgressBanner: x.com のタブで動いている取り込みの状況と、一時停止・停止
 * 取り込みは x.com のタブの中の拡張機能 (content script) が行う。ここからは chrome.storage.local のコマンドで指示するだけで、
 * 新しい権限は使わない。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { isBookmarksPath } from '../shared/selectors';
import { t } from '../shared/strings';
import {
  clearCollectCommand, getCollectRun, onCollectRunChanged, peekCollectCommand, sendCollectCommand, updateAutoCollect,
  type CollectCap, type CollectRun, type CollectSpeed,
} from '../shared/settings';

export function useCollectRun(): CollectRun | null {
  const [run, setRun] = useState<CollectRun | null>(null);
  useEffect(() => {
    const load = () => void getCollectRun().then(setRun).catch(() => {});
    load();
    return onCollectRunChanged(load);
  }, []);
  return run;
}

const X_HISTORY_URLS = ['https://x.com/i/history*', 'https://x.com/i/bookmarks*', 'https://twitter.com/i/history*', 'https://twitter.com/i/bookmarks*'];

/** x.com のブックマークの一覧のタブを前面に出す (無ければ開く)。tabs の権限は使わない (host 権限で URL が読める)。
 *  再利用するのは、x.com 側が取り込みを受け付けるページ (isBookmarksPath と同じ定義) のタブだけ。/i/history/likes などは使わない */
export async function openXTab(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: X_HISTORY_URLS });
  const tab = tabs.find((x) => {
    try {
      return !!x.url && isBookmarksPath(new URL(x.url).pathname);
    } catch {
      return false;
    }
  });
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows?.update?.(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: 'https://x.com/i/history' });
}

/** 開始の指示が、この時間のうちに x.com 側で受け取られなかったら、始まらなかったとみなす (読み込みが遅いタブを待つ余裕を含む) */
export const START_CHECK_MS = 30_000;

/** 開始の指示 (id) が、まだ残っていたら (x.com 側が受け取っていない) 指示を取り下げて onMissed を呼ぶ */
export function watchStart(id: string, onMissed: () => void, ms = START_CHECK_MS): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void peekCollectCommand()
      .then(async (cmd) => {
        if (cmd?.type !== 'start' || cmd.id !== id) return;
        await clearCollectCommand();
        onMissed();
      })
      .catch(() => {});
  }, ms);
}

/** 確認ダイアログで同意して「始める」を押したときだけ呼ぶ。consent: true のコマンドを書き、x.com のタブを開く */
export async function startAutoCollect(opts: { accountId: string; speed: CollectSpeed; cap: CollectCap }): Promise<string> {
  await updateAutoCollect({ speed: opts.speed, cap: opts.cap });
  const id = await sendCollectCommand({ type: 'start', consent: true, speed: opts.speed, cap: opts.cap, accountId: opts.accountId });
  await openXTab();
  return id;
}

export function OfferBanner(props: { accountName: string; onStart: () => void; onLater: () => void; onNever: () => void }) {
  return (
    <div class="banner ac-offer" role="region" aria-label={t('acOfferTitle')}>
      <div class="ac-offer-main">
        <strong>{t('acOfferTitle')}</strong>
        <div class="muted">{t('acOfferBody', props.accountName)}</div>
        <div class="ac-row">
          <button class="primary" onClick={props.onStart}>{t('acOfferStart')}</button>
          <button onClick={props.onLater}>{t('acOfferLater')}</button>
          <button onClick={props.onNever}>{t('acOfferNever')}</button>
        </div>
      </div>
    </div>
  );
}

export function AutoCollectDialog(props: {
  /** 表示するアカウント名。null = 判定できていない (始められない) */
  accountName: string | null;
  speed: CollectSpeed;
  cap: CollectCap;
  onCancel: () => void;
  onStart: (speed: CollectSpeed, cap: CollectCap) => void;
}) {
  const [speed, setSpeed] = useState<CollectSpeed>(props.speed);
  const [cap, setCap] = useState<CollectCap>(props.cap);
  const [agreed, setAgreed] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  const ok = agreed && props.accountName !== null;
  return (
    <div class="overlay" onClick={props.onCancel}>
      <div class="dialog dialog-wide ac-dialog" role="dialog" aria-modal="true" aria-labelledby="ac-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="ac-title" class="dialog-title">{t('acDlgTitle')}</h2>
        {props.accountName === null ? (
          <p class="error" role="alert">{t('acNoAccount')}</p>
        ) : (
          <p class="muted">{t('acDlgIntro', props.accountName)}</p>
        )}
        {/* 順: 説明 → 規約の注意 (黄色い枠) → 速度と 1 回の上限 → 並び順の図 → 同意 → 始める */}
        <div class="ac-alert" role="note">{t('acRisk')}</div>
        <fieldset class="ac-field">
          <legend>{t('acSpeedLabel')}</legend>
          <label class="setting">
            <input ref={first} type="radio" name="ac-speed" checked={speed === 'slow'} onChange={() => setSpeed('slow')} />
            <span>{t('acSpeedSlowOpt')} <span class="muted">{t('acSpeedSlowHint')}</span></span>
          </label>
          <label class="setting">
            <input type="radio" name="ac-speed" checked={speed === 'normal'} onChange={() => setSpeed('normal')} />
            <span>{t('acSpeedNormal')} <span class="muted">{t('acSpeedNormalHint')}</span></span>
          </label>
        </fieldset>
        <label class="ac-field ac-cap">
          <strong>{t('acCapLabel')}</strong>
          <select value={String(cap)} onChange={(e) => setCap(Number((e.target as HTMLSelectElement).value) as CollectCap)}>
            <option value="300">{t('acCap300')}</option>
            <option value="100">{t('acCap100')}</option>
            <option value="0">{t('acCap0')}</option>
          </select>
        </label>
        <div class="ac-order">
          <div>
            <b>{t('acOrderX')}</b>
            <ol><li>{t('acOrderNewest')}</li><li>{t('acOrderPrev')}</li><li>{t('acOrderOld')}</li></ol>
          </div>
          <div>
            <b>{t('acOrderShelf')}</b>
            <ol><li>{t('acOrderNewest')}</li><li>{t('acOrderPrev')}</li><li>{t('acOrderOld')}</li></ol>
            <span class="ac-ok">{t('acOrderSame')}</span>
          </div>
        </div>
        <label class="setting">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed((e.target as HTMLInputElement).checked)} />
          <span>{t('acConsent')}</span>
        </label>
        <div class="dialog-actions">
          <button onClick={props.onCancel}>{t('cancel')}</button>
          <button class="primary" disabled={!ok} onClick={() => ok && props.onStart(speed, cap)}>{t('acDlgStart')}</button>
        </div>
      </div>
    </div>
  );
}

const TITLE: Record<CollectRun['status'], string> = {
  countdown: 'acPanelRunning',
  running: 'acPanelRunning',
  paused: 'acPanelPaused',
  limit: 'acPanelLimit',
  stopped: 'acPanelStopped',
  done: 'acPanelDone',
};

export function ProgressBanner(props: { run: CollectRun; onClose: () => void; /** 取り込めた分があるときの「仕分ける」。タブ版は仕分けモードを始め、サイドパネル版は「未分類」を開く */ onTriage?: () => void }) {
  const { run } = props;
  const active = run.status === 'running' || run.status === 'countdown';
  const waiting = run.status === 'paused' || run.status === 'limit';
  const dot = run.status === 'done' ? 'done' : run.status === 'limit' ? 'ng' : active ? 'run' : 'pause';
  return (
    <div class="banner ac-progress" role="status" aria-live="polite">
      <div class="ac-offer-main">
        {/* 文と操作のボタンは同じ行の右端にまとめる。収まらないときは、ボタンが文の下の段に折り返す。
            終わった状態 (閉じるだけ) は、狭くても文が折り返し、「閉じる」は行の上端・右端のまま */}
        <div class={`ac-head${active || waiting ? '' : ' single'}`}>
          <strong class="ac-title">
            <span class={`ac-dot ${dot}`} aria-hidden="true" />
            {t(TITLE[run.status])}: {t('acProgressLine', run.imported, run.skipped)}
          </strong>
          <div class="ac-row ac-actions">
            {active && <button onClick={() => void sendCollectCommand({ type: 'pause' })}>{t('acBtnPause')}</button>}
            {waiting && <button class="primary" onClick={() => void sendCollectCommand({ type: 'resume' })}>{t('acBtnResume')}</button>}
            {(active || waiting) && <button onClick={() => void sendCollectCommand({ type: 'stop' })}>{t(active ? 'acBtnStop' : 'acBtnEnd')}</button>}
            {(active || waiting) && (
              <button onClick={() => void openXTab()}>
                <Icon name="ti-external-link" /> {t('acOpenX')}
              </button>
            )}
            {!active && !waiting && run.imported >= 1 && props.onTriage && (
              <button class="primary" onClick={props.onTriage}>
                <Icon name="ti-bolt" /> {t('acBtnTriage')}
              </button>
            )}
            {!active && !waiting && <button onClick={props.onClose}>{t('acBtnClose')}</button>}
          </div>
        </div>
        {active && <div class="ac-bar ind" aria-hidden="true"><i /></div>}
        {run.status === 'limit' && <div class="ac-alert">{t('acLimitAlert')}</div>}
      </div>
    </div>
  );
}
