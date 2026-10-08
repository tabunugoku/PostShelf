import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { requestNativeSync, requestSnapshot, watchActivePost, type ActivePost } from '../shared/activeTab';
import type { Folder, Snapshot } from '../shared/models';
import { getAccountScope, getBookmark, setBookmarkFolders } from '../shared/storage';
import { requestCache, requestFullText } from '../shared/cacheRequest';
import { t } from '../shared/strings';
import { Dropdown, FolderPickerHost } from './ui';

/**
 * サイドパネル下部の固定ボタン「いま開いているポストを保存…」。
 * アクティブタブが x.com/*\/status/* のときだけ表示。押すとそのタブの content script からスナップショットを取り、
 * 共通のフォルダ選択を開く。取れなければ短いエラーを出して何も保存しない。
 */
export function SaveCurrent(props: { folders: Folder[]; onSaved: () => void; /** 保存できない理由 (アカウントを判定できない / 表示中のアカウントが違う)。あるときは保存ボタンの代わりにこれを出す */ blockedReason?: string }) {
  const [post, setPost] = useState<ActivePost | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ tweetId: string; snapshot: Snapshot; selected: string[]; tabId: number; /** このポストは、すでに PostShelf に保存してある (画像のキャッシュと全文の取得は、保存したときに要求済み) */ saved: boolean } | null>(null);
  useEffect(() => watchActivePost((p) => {
    setPost(p);
    setError('');
    setOpen(null);
  }), []);
  if (!post) return null; // x.com 以外のタブ / ポスト以外のページでは出さない
  if (props.blockedReason)
    return (
      <div class="pfoot">
        <div class="pfoot-note error" role="alert">
          {props.blockedReason}
        </div>
      </div>
    );

  const start = async () => {
    setError('');
    const r = await requestSnapshot(post);
    if (!r) {
      setOpen(null);
      setError(t('saveCurrentFail'));
      return;
    }
    const prev = await getBookmark(r.tweetId);
    setOpen({ tweetId: r.tweetId, snapshot: r.snapshot, selected: prev?.folderIds ?? [], tabId: post.tabId, saved: !!prev });
  };

  return (
    <div class="pfoot">
      <span class="menu-anchor block">
        <button class="cta" aria-haspopup="dialog" aria-expanded={!!open} onClick={() => (open ? setOpen(null) : void start())}>
          <Icon name="ti-folder-plus" />
          {t('saveCurrentPost')}
        </button>
        {open && (
          <Dropdown onClose={() => setOpen(null)} label={t('saveCurrentPost')} class="menu-wide">
            <FolderPickerHost
              folders={props.folders}
              selected={open.selected}
              onChange={async (sel) => {
                // 全フォルダを外しても、保存は残る (「未分類」になる)。保存の解除は、ここではしない
                await setBookmarkFolders(open.tweetId, [...sel], open.snapshot);
                // 画像のキャッシュと全文の取得は、保存の状態が変わったとき (新しく保存したとき) だけ要求する
                if (!open.saved) {
                  open.saved = true;
                  requestCache(open.tweetId, getAccountScope());
                  if (open.snapshot.truncated) requestFullText(open.tweetId, getAccountScope()); // たたまれた状態で保存した (v24)
                }
                await requestNativeSync(open.tabId, open.tweetId, true);
                props.onSaved();
              }}
            />
          </Dropdown>
        )}
      </span>
      {error ? (
        <div class="pfoot-note error" role="alert">
          {error}
        </div>
      ) : (
        <div class="pfoot-note muted">{t('saveCurrentHint')}</div>
      )}
    </div>
  );
}
