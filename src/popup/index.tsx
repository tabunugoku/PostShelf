import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { inboxOf } from '../shared/folderPicker';
import { Icon } from '../shared/Icon';
import { HealthNotice } from '../manager/HealthNotice';
import { hasSidePanel, openManagerTab, openSidePanel } from '../shared/panel';
import { INBOX_ID, UNKNOWN_ACCOUNT_ID, accountLabel, displayName, type Account, type Bookmark, type Folder } from '../shared/models';
import { setDocumentLang, t } from '../shared/strings';
import { countFolder } from '../shared/query';
import { getLastSeenAccount, listBookmarks, listFolders, onDataChanged, onLastSeenAccountChanged, setAccountScope } from '../shared/storage';

const openManager = (hash = '') => void openManagerTab(hash);

function Popup() {
  const [counts, setCounts] = useState({ posts: 0, inbox: 0 });
  const [recent, setRecent] = useState<Bookmark[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // 件数は現在のアカウント (x.com で最後に読み取ったアカウント。分からなければ「アカウント未設定」) のもの
    const load = async () => {
      try {
      const last = await getLastSeenAccount();
      setAccount(last);
      setAccountScope(last?.id ?? UNKNOWN_ACCOUNT_ID);
      const [b, f] = await Promise.all([listBookmarks(), listFolders()]);
      setCounts({ posts: b.length, inbox: countFolder(b, INBOX_ID, Date.now()) }); // 管理画面の左のメニューの「未分類」と同じ関数で数える
      setFolders(f);
      setRecent([...b].sort((x, y) => y.savedAt - x.savedAt).slice(0, 3));
      setFailed(false);
      } catch {
        setFailed(true); // 読み込めなかったことを画面に出す
      }
    };
    void load();
    const offs = [onDataChanged(() => void load()), onLastSeenAccountChanged(() => void load())];
    return () => offs.forEach((o) => o());
  }, []);
  return (
    <div>
      <div class="hd">
        <img class="brand" src="brand/icon-32.png" width="24" height="24" alt="" />
        <span class="hd-title">{t('appTitle')}</span>
        {/* 現在のアカウント。判定できていないときだけ「アカウント未設定」 */}
        <span class="acct-chip popup-account" title={accountLabel(account ?? { id: UNKNOWN_ACCOUNT_ID, handle: '' })}>
          {accountLabel(account ?? { id: UNKNOWN_ACCOUNT_ID, handle: '' })}
        </span>
      </div>
      <div class="tiles">
        <div class="tile">
          <b>{counts.posts}</b>
          <span>{t('popupPosts')}</span>
        </div>
        {counts.inbox > 0 ? (
          <button class="tile tile-inbox" onClick={() => openManager('#inbox')}>
            <b>{counts.inbox}</b>
            <span>{t('popupInbox')}</span>
          </button>
        ) : (
          <div class="tile tile-quiet">
            <b>0</b>
            <span>{displayName(inboxOf(folders))}</span>
          </div>
        )}
      </div>
      <input
        class="popup-search"
        type="search"
        placeholder={t('popupSearch')}
        aria-label={t('popupSearch')}
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) openManager(`#q=${encodeURIComponent(query.trim())}`);
        }}
      />
      {failed && (
        <div class="sub error" role="alert">
          {t('errorStorage')}
        </div>
      )}
      <HealthNotice onDiagnose={() => openManager('#diagnostics')} />
      <div class="rec">
        <div class="rec-head">{t('recent')}</div>
        {recent.map((b) => (
          <div class="rec-row" title={b.snapshot.text}>
            <span class="rec-dots" aria-hidden="true">
              {b.folderIds.slice(0, 3).map((id) => {
                const f = folders.find((x) => x.id === id);
                // 「未分類」は中空の点、色のないフォルダは灰色の塗りの点、色のあるフォルダはその色の点
                if (id === INBOX_ID) return <i class="rec-dot hollow" />;
                return f?.color ? <i class="rec-dot" style={{ background: f.color }} /> : <i class="rec-dot" />;
              })}
            </span>
            <span class="rec-handle">{b.snapshot.handle}</span> {b.snapshot.text}
          </div>
        ))}
      </div>
      <button class="main-btn" onClick={() => openManager()}>
        <Icon name="ti-external-link" />
        {t('openManager')}
      </button>
      {hasSidePanel() && (
        <button
          class="sub-btn"
          onClick={() => {
            void openSidePanel().then(() => window.close());
          }}
        >
          <Icon name="ti-layout-sidebar-right" />
          {t('openSidePanel')}
        </button>
      )}
      <div class="foot-row">
        <button class="pr small" onClick={() => openManager('#settings')}>
          <Icon name="ti-settings" />
          {t('settings')}
        </button>
      </div>
    </div>
  );
}

setDocumentLang();
render(<Popup />, document.getElementById('app')!);
