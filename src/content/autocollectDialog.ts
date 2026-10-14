/**
 * x.com の「自動で取り込む…」を押したときの確認ダイアログ (v72)。x.com のタブの上に直接出す。管理画面のタブは開かない。
 *  - 部品と同意の文言・条件は shared/AutoCollectDialog.tsx、見た目は static/autocollect-dialog.css の 1 か所 (管理画面と共通)。
 *  - x.com の CSS の影響を受けないよう、閉じた Shadow DOM の中に描く。
 *  - x.com のページの JS も同じ DOM に触れるので、同意のチェックと「始める」は、利用者本人の操作 (isTrusted) だけ受け付ける。
 *    閉じた Shadow DOM で中身を探しにくくしても、この判定は省かない。
 *  - 同意して始めるときは、コマンドを経由せず、同じタブの AutoCollector.start を consent: true で直接呼ぶ。
 * 実機未確認 (docs/MANUAL_TEST.md の v72): x.com の上での見た目、キー操作が X に漏れないこと。
 */
import { h, render } from 'preact';
import dialogCss from '../../static/autocollect-dialog.css';
import { AutoCollectDialog } from '../shared/AutoCollectDialog';
import { accountLabel } from '../shared/models';
import { getSettings, onSettingsChanged, updateAutoCollect, type CollectCap, type CollectSpeed } from '../shared/settings';
import { getCurrentAccount, subscribeAccount } from './account';
import { getCollector } from './autocollect';
import { xTheme } from './theme';

/** 操作が利用者本人のものかの判定。jsdom のクリックは isTrusted が false になるので、テストはここを差し替える */
export const dialogTrust = { isTrusted: (e: Event): boolean => e.isTrusted };

/** ホスト要素のクラス (開いているダイアログの目印) */
const HOST_CLASS = 'postshelf-autocollect-dialog';

let closeCurrent: (() => void) | null = null;

/** 開いている確認ダイアログを閉じる (shadow root ごと外し、リスナーも残さない) */
export function closeAutoCollectDialog(): void {
  closeCurrent?.();
}

/** 確認ダイアログを開く。設定「自動取り込みを使う」がオフなら開かない。すでに開いていれば何もしない */
export async function openAutoCollectDialog(): Promise<void> {
  if (closeCurrent) return;
  const settings = (await getSettings()).autoCollect;
  if (!settings.enabled || closeCurrent) return; // 読んでいる間に、別の操作で開いた場合も含む

  const host = document.createElement('div');
  host.className = HOST_CLASS;
  host.dataset.theme = xTheme().scheme;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;margin:0;padding:0;border:0';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = dialogCss;
  const mount = document.createElement('div');
  mount.className = 'ac-root';
  shadow.append(style, mount);

  // ダイアログの中のキー操作は、X のショートカットに渡さない (Shadow DOM の外からは、入力欄ではなくホスト要素への操作に見えるため)
  const stopKey = (e: Event) => e.stopPropagation();
  const keyEvents = ['keydown', 'keyup', 'keypress'];
  keyEvents.forEach((name) => host.addEventListener(name, stopKey));

  const close = () => {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    unsubscribeSettings();
    unsubscribeAccount();
    render(null, mount);
    keyEvents.forEach((name) => host.removeEventListener(name, stopKey));
    host.remove();
  };

  const start = async (speed: CollectSpeed, cap: CollectCap) => {
    const account = getCurrentAccount();
    // 開いている間に、設定がオフになった / アカウントを判定できなくなったときは始めない
    if (!account || !(await getSettings()).autoCollect.enabled) return close();
    await updateAutoCollect({ speed, cap });
    const collector = getCollector();
    close();
    // 始めたあとは、進捗の帯 (autocollectPanel) が状況を出す。カウントダウンを待たずに戻る
    if (collector) void collector.start({ consent: true, speed, cap, accountId: account.id }).catch(() => {});
  };

  const draw = () => {
    const current = getCurrentAccount();
    render(
      h(AutoCollectDialog, {
        accountName: current ? accountLabel(current) : null,
        speed: settings.speed,
        cap: settings.cap,
        onCancel: close,
        onStart: (speed: CollectSpeed, cap: CollectCap) => void start(speed, cap),
        isTrusted: (e: Event) => dialogTrust.isTrusted(e),
        keyTarget: host,
      }),
      mount,
    );
  };

  const unsubscribeSettings = onSettingsChanged((s) => {
    if (!s.autoCollect.enabled) close();
  });
  const unsubscribeAccount = subscribeAccount(draw);
  closeCurrent = close;
  draw();
  document.body.append(host);
}
