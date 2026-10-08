import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { UNKNOWN_ACCOUNT_ID, accountLabel, type Account } from '../shared/models';
import type { AccountSummary } from '../shared/storage';
import { t } from '../shared/strings';
import { Dropdown } from './ui';

/**
 * 表示するアカウントの決め方: 手動で選んだアカウント (まだ一覧にあれば) → x.com で最後に読み取ったアカウント → 一覧の先頭 → 未設定。
 * 保存が 0 件でも、最後に読み取ったアカウントは一覧にあるので、その空の棚を表示する。
 */
export function resolveViewAccount(manual: string, last: Account | null, list: AccountSummary[]): string {
  if (manual && list.some((a) => a.account.id === manual)) return manual;
  return last?.id ?? list[0]?.account.id ?? UNKNOWN_ACCOUNT_ID;
}

export function AccountAvatar({ account, size = 24 }: { account: Account; size?: number }) {
  const unknown = account.id === UNKNOWN_ACCOUNT_ID;
  if (account.avatar && !unknown) return <img class="acct-av" src={account.avatar} alt="" width={size} height={size} />;
  return (
    <span class="acct-av acct-av-fallback" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true">
      {unknown ? <Icon name="ti-user-question" /> : (account.handle[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * サイドバー最上部の「アカウント切替」。現在表示中のアカウント (アバター + @ハンドル + ▾)。
 * 押すと保存履歴のあるアカウントの一覧 (件数つき)。行をクリックするとそのアカウントの表示に切り替わる。
 * 「アカウント未設定」の行にだけ文字のボタン「割り当て…」。「このアカウントのデータを削除」は、各行の「…」のメニューの中 (v19-C)。
 * ここで切り替えても X のログイン状態は変わらない (一言を添える)。
 */
export function AccountSwitcher(props: {
  accounts: AccountSummary[];
  viewId: string;
  loggedInId: string | null;
  onPick: (id: string) => void;
  onAssign: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /** 「…」のメニューを開いている行のアカウント ID */
  const [moreId, setMoreId] = useState<string | null>(null);
  const menuHost = useRef<HTMLSpanElement>(null);
  const cur = props.accounts.find((a) => a.account.id === props.viewId)?.account ?? { id: props.viewId, handle: props.viewId, lastSeenAt: 0 };
  const label = accountLabel(cur);

  useEffect(() => {
    if (!open) return;
    // 開いたら現在のアカウントの行へフォーカス (キーボード操作)
    document.querySelector<HTMLElement>('.menu-acct .acct-main[aria-checked=true]')?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...document.querySelectorAll<HTMLElement>('.menu-acct .acct-main')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };

  return (
    <span class="menu-anchor acct" ref={menuHost}>
      <button
        class="acct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('accountSwitchLabel')}: ${label}`}
        title={t('accountSwitchLabel')}
        onClick={() => setOpen(!open)}
      >
        <AccountAvatar account={cur} size={24} />
        <span class="fr-name">{label}</span>
        <Icon name="ti-chevron-down" />
      </button>
      {open && (
        <Dropdown fixed onClose={() => setOpen(false)} label={t('accountSwitchLabel')} class="menu-acct">
          <div role="menu" onKeyDown={onKeyDown}>
            {props.accounts.map(({ account, count }) => {
              const name = accountLabel(account);
              return (
                <div key={account.id}>
                  <div class="acct-row">
                    <button
                      class="menu-item acct-main"
                      role="menuitemradio"
                      aria-checked={account.id === props.viewId}
                      onClick={() => {
                        setOpen(false);
                        props.onPick(account.id);
                      }}
                    >
                      <AccountAvatar account={account} size={24} />
                      <span class="acct-text">
                        <span class="fr-name">{name}</span>
                        {account.displayName && account.id !== UNKNOWN_ACCOUNT_ID && <span class="muted acct-sub">{account.displayName}</span>}
                        {account.id === props.loggedInId && <span class="muted acct-sub">{t('accountLoggedIn')}</span>}
                      </span>
                      <span class="n">{count}</span>
                    </button>
                    {account.id === UNKNOWN_ACCOUNT_ID && (
                      <button class="acct-assign" aria-label={`${t('accountAssign')} ${name}`} onClick={() => { setOpen(false); props.onAssign(account.id); }}>
                        {t('accountAssign')}
                      </button>
                    )}
                    <button
                      class="icon-btn"
                      aria-label={`${t('cardMenu')}: ${name}`}
                      title={t('cardMenu')}
                      aria-haspopup="menu"
                      aria-expanded={moreId === account.id}
                      onClick={() => setMoreId(moreId === account.id ? null : account.id)}
                    >
                      <Icon name="ti-dots" />
                    </button>
                  </div>
                  {moreId === account.id && (
                    <div class="acct-more" role="menu">
                      <button class="menu-item danger-text" role="menuitem" onClick={() => { setOpen(false); props.onDelete(account.id); }}>
                        <Icon name="ti-trash" /> {t('accountDelete')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p class="muted acct-note">{t('accountSwitchNote')}</p>
        </Dropdown>
      )}
    </span>
  );
}

/** データの割り当て: from のフォルダとポストを、選んだアカウントへ移す (同じポストは統合) */
export function AssignDialog(props: { from: AccountSummary; targets: AccountSummary[]; defaultTo: string | null; onCancel: () => void; onConfirm: (toId: string) => void }) {
  const [to, setTo] = useState(props.defaultTo && props.targets.some((x) => x.account.id === props.defaultTo) ? props.defaultTo : (props.targets[0]?.account.id ?? ''));
  const first = useRef<HTMLElement>(null);
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
  return (
    <div class="overlay" onClick={props.onCancel}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="assign-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="assign-title" class="dialog-title">{t('accountAssignTitle')}</h2>
        <p>{t('accountAssignDesc', accountLabel(props.from.account), props.from.count)}</p>
        {props.targets.length === 0 ? (
          <p class="muted">{t('accountAssignNone')}</p>
        ) : (
          <fieldset class="setting-group assign-targets">
            <legend>{t('accountAssignTo')}</legend>
            {props.targets.map((x, i) => (
              <label class="setting">
                <input ref={i === 0 ? (first as never) : undefined} type="radio" name="assign-to" checked={to === x.account.id} onChange={() => setTo(x.account.id)} />
                <span>{accountLabel(x.account)} <span class="muted">{t('itemCount', x.count)}</span></span>
              </label>
            ))}
          </fieldset>
        )}
        <div class="dialog-actions">
          <button onClick={props.onCancel}>{t('cancel')}</button>
          <button class="primary" disabled={!to} onClick={() => props.onConfirm(to)}>
            {t('accountAssign')}
          </button>
        </div>
      </div>
    </div>
  );
}
