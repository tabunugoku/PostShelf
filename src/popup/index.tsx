import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import type { Bookmark } from '../shared/models';
import { t } from '../shared/strings';
import { listBookmarks, listFolders } from '../shared/storage';

const openManager = () => void chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });

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
        <Icon name="ti-books" />
        <span>{t('appTitle')}</span>
      </div>
      <div class="sub">
        {counts.posts} {t('popupPosts')} · {counts.folders} {t('popupFolders')}
      </div>
      <div class="rec">
        <div>{t('recent')}</div>
        {recent.map((b) => (
          <div title={b.snapshot.text}>
            {b.snapshot.handle} {b.snapshot.text}
          </div>
        ))}
      </div>
      <button class="pr link" onClick={openManager}>
        <Icon name="ti-external-link" />
        {t('openManager')}
      </button>
      <button class="pr" onClick={openManager}>
        <Icon name="ti-settings" />
        {t('settings')}
      </button>
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
