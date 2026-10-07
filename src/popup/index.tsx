import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { MGR } from '../shared/strings';
import { listBookmarks, listFolders } from '../shared/storage';

function Popup() {
  const [counts, setCounts] = useState({ posts: 0, folders: 0 });
  useEffect(() => {
    void (async () => {
      const [b, f] = await Promise.all([listBookmarks(), listFolders()]);
      setCounts({ posts: b.length, folders: f.length - 1 }); // 「すべて」を除く
    })();
  }, []);
  return (
    <div class="popup">
      <p>
        {MGR.popupBookmarks}: <strong>{counts.posts}</strong>
      </p>
      <p>
        {MGR.popupFolders}: <strong>{counts.folders}</strong>
      </p>
      <button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') })}>
        {MGR.openManager}
      </button>
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
