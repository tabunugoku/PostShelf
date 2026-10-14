/**
 * ブックマークの自動取り込みの確認ダイアログ (同意のチェックを入れるまで「始める」は押せない)。
 * 管理画面 (OfferBanner から) と x.com の上 (「自動で取り込む…」から。src/content/autocollectDialog.ts) の両方で使う。
 * 同意の文言と条件はここだけに置く。見た目は static/autocollect-dialog.css (1 か所)。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from './strings';
import { CAP_MAX, normalizeCap, type CollectCap, type CollectSpeed } from './settings';

/** 開発者用の裏モードに入る / 出る文字キーの並び。画面には案内を出さない (利用者向けの機能ではない) */
const DEV_KEYS = 'devcap';

/** 文字を打つ入力欄か。ラジオ・チェックボックス・ボタンは、打った文字を受けないので、数えてよい */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !['radio', 'checkbox', 'button', 'submit'].includes(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** 件数の入力が、上限として使える値か (0 = 止めない、または 1〜CAP_MAX の整数) */
const validCapText = (text: string): boolean => text.trim() !== '' && normalizeCap(Number(text)) === Number(text);

/** 確認ダイアログ。isTrusted を渡すと、チェックと「始める」はその判定が true を返す操作だけ受け付ける (x.com の上で、ページの JS による偽装を防ぐ) */
export function AutoCollectDialog(props: {
  /** 表示するアカウント名。null = 判定できていない (始められない) */
  accountName: string | null;
  speed: CollectSpeed;
  cap: CollectCap;
  onCancel: () => void;
  onStart: (speed: CollectSpeed, cap: CollectCap) => void;
  /** 操作が利用者本人のものか。省略時は確かめない (拡張機能のページでは、ページの JS が同じ DOM に触れない) */
  isTrusted?: (e: Event) => boolean;
  /** Esc と裏モードのキーを受ける先。省略時は document (x.com の上では、X のキー操作に漏らさないよう、ホスト要素にする) */
  keyTarget?: EventTarget;
}) {
  const [speed, setSpeed] = useState<CollectSpeed>(props.speed);
  /** 最後に有効だった上限 (開始のときに使う) */
  const [cap, setCap] = useState<CollectCap>(props.cap);
  /** 裏モードの数字の入力。ダイアログの state だけに持ち、保存しない (閉じると切れる) */
  const [devMode, setDevMode] = useState(false);
  const [capText, setCapText] = useState(String(props.cap));
  const [agreed, setAgreed] = useState(false);
  const devProgress = useRef(0);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const keyTarget = props.keyTarget ?? document;
    const key = (e: Event) => {
      if (!(e instanceof KeyboardEvent)) return;
      if (e.key === 'Escape') props.onCancel();
      if (e.key === 'Shift' || e.ctrlKey || e.metaKey || e.altKey) return; // 修飾キーだけでは、並びを途切れさせない
      // Shadow DOM の中の入力欄は、外から見ると target がホスト要素になる
      if (isTextEntry(e.composedPath()[0] ?? e.target)) {
        devProgress.current = 0;
        return;
      }
      // 途中で別のキーが入ったら、最初から数え直す (先頭の文字なら、そこから 1 文字目)
      const at = devProgress.current;
      devProgress.current = e.key === DEV_KEYS[at] ? at + 1 : e.key === DEV_KEYS[0] ? 1 : 0;
      if (devProgress.current === DEV_KEYS.length) {
        devProgress.current = 0;
        setDevMode((on) => !on);
      }
    };
    keyTarget.addEventListener('keydown', key);
    return () => {
      keyTarget.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  const capOk = !devMode || validCapText(capText);
  const ok = agreed && props.accountName !== null && capOk;
  // ラベルやボタンへの偽のクリックは、チェックの切り替えや開始にならないよう、中に届く前に止める
  const guard = (e: Event) => {
    if (props.isTrusted && !props.isTrusted(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <div class="overlay" onClickCapture={guard} onClick={props.onCancel}>
      <div
        class="dialog dialog-wide ac-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ac-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
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
          {devMode ? (
            <input
              type="number"
              min={0}
              max={CAP_MAX}
              step={1}
              aria-label={t('acCapLabel')}
              value={capText}
              onInput={(e) => {
                const text = (e.target as HTMLInputElement).value;
                setCapText(text);
                if (validCapText(text)) setCap(Number(text));
              }}
            />
          ) : (
            <select
              value={String(cap)}
              onChange={(e) => {
                const next = Number((e.target as HTMLSelectElement).value);
                setCap(next);
                setCapText(String(next));
              }}
            >
              <option value="300">{t('acCap300')}</option>
              <option value="100">{t('acCap100')}</option>
              <option value="0">{t('acCap0')}</option>
              {![300, 100, 0].includes(cap) && <option value={String(cap)}>{cap}</option>}
            </select>
          )}
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
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => {
              const box = e.target as HTMLInputElement;
              // クリックを止めても、偽の change だけを送られることがあるので、ここでも確かめる。表示は同意の状態に戻す
              if (props.isTrusted && !props.isTrusted(e)) {
                box.checked = agreed;
                return;
              }
              setAgreed(box.checked);
            }}
          />
          <span>{t('acConsent')}</span>
        </label>
        <div class="dialog-actions">
          <button onClick={props.onCancel}>{t('cancel')}</button>
          <button
            class="primary"
            disabled={!ok}
            onClick={(e) => {
              if (props.isTrusted && !props.isTrusted(e)) return;
              if (ok) props.onStart(speed, devMode ? Number(capText) : cap);
            }}
          >
            {t('acDlgStart')}
          </button>
        </div>
      </div>
    </div>
  );
}
