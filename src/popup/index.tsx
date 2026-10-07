import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { HealthNotice } from '../manager/HealthNotice';
import { hasSidePanel, openManagerTab, openSidePanel } from '../shared/panel';
import type { Bookmark } from '../shared/models';
import { t } from '../shared/strings';
import { listBookmarks, listFolders } from '../shared/storage';

const openManager = (hash = '') => void openManagerTab(hash);

function Popup() {
  const [counts, setCounts] = useState({ posts: 0, folders: 0 });
  const [recent, setRecent] = useState<Bookmark[]>([]);
  useEffect(() => {
    void (async () => {
      const [b, f] = await Promise.all([listBookmarks(), listFolders()]);
      setCounts({ posts: b.length, folders: f.length - 1 }); // 「すべて」を除く
      setRecent([...b].sort((x, y) => y.savedAt - x.savedAt).slice(0, 3));
    })();
  }, []);
  return (
    <div>
      <div class="hd">
        <img class="brand" src="brand/icon-32.png" width="24" height="24" alt="" />
        <span>{t('appTitle')}</span>
      </div>
      <div class="sub">
        {counts.posts} {t('popupPosts')} · {counts.folders} {t('popupFolders')}
      </div>
      <HealthNotice onDiagnose={() => openManager('#diagnostics')} />
      <div class="rec">
        <div>{t('recent')}</div>
        {recent.map((b) => (
          <div title={b.snapshot.text}>
            {b.snapshot.handle} {b.snapshot.text}
          </div>
        ))}
      </div>
      <button class="pr link" onClick={() => openManager()}>
        <Icon name="ti-external-link" />
        {t('openManager')}
      </button>
      {hasSidePanel() && (
        <button
          class="pr link"
          onClick={() => {
            void openSidePanel().then(() => window.close());
          }}
        >
          <Icon name="ti-layout-sidebar-right" />
          {t('openSidePanel')}
        </button>
      )}
      <button class="pr" onClick={() => openManager('#diagnostics')}>
        <Icon name="ti-stethoscope" />
        {t('copyDiag')}
      </button>
      <button class="pr" onClick={() => openManager('#settings')}>
        <Icon name="ti-settings" />
        {t('settings')}
      </button>
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
