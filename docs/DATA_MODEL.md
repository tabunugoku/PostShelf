# データモデル (保存データ)

すべて `chrome.storage.local`。保存と読み込みは `src/shared/storage.ts` (フォルダ/ブックマーク) と `src/shared/settings.ts` (設定・状態) に集約する。

## `folders`: Folder[]
`{ id, name, icon, color?, order }`
- 「すべて」は保存しない仮想フォルダ (`id: 'all'`)。表示名は `t('allFolderName')`
- 「未分類」(`id: 'inbox'`) は名前を `''` で保存し、表示時に `t('inboxName')` へ解決する (ユーザーが改名したらその名前)
- `color` はどのアイコンでも指定できる (許可リストの 8 色のみ)。無い = 色なし

## `bookmarks`: Record<tweetId, Bookmark>
`{ tweetId, folderIds, savedAt, snapshot }`
- `folderIds` が空になる操作 (manager の「フォルダから外す」) では、ポストを消さず `['inbox']` に移す。削除は明示的な「削除」だけ
- x.com のポップオーバーで全部のチェックを外した場合のみ、ブックマークごと削除する (従来どおり)

### `snapshot`
`{ text, author, handle, avatar?, media: string[], createdAt?, url, hasVideo?, hasLink? }`
- **v7 で追加**: `hasVideo?: boolean` / `hasLink?: boolean` (真偽値のみ。内容は保存しない)。保存時に content script が判定する
- 読み込み時に欠けていても動く。**v6 以前に保存したポストは未定義 = 未判定**で、「動画あり」「リンクあり」の絞り込みには出ない。URL や拡張子からの推定はしない
- 「画像あり」は `media.length > 0` で判定できるので既存データでも使える
- 保存し直す (フォルダを変更する) と、その時点のスナップショットで `hasVideo` / `hasLink` が入る

## `settings`
`{ syncNative, buttonMode, actionMode, lastFolderId, viewMode, sortKey }`
- `lastFolderId` / `viewMode` (`post|list|grid`) / `sortKey` は manager の最後の表示状態 (**v7**。`localStorage` は使わない)
- 不正値は読み込み時に既定値へ戻す

## `importHint`: `{ pending, dismissed }` (v7)
- `pending`: ブックマーク一覧 (`/i/history`) を開いたときに content script が記録した「画面に出ている未取り込み件数」(最後の観測値)
- `dismissed`: manager の取り込み案内バナーを閉じた時点の `pending`。`pending > dismissed` のときだけバナーを出す
- 件数が減ったとき (取り込んだ等) は `dismissed` も下げ、次の増加で再び案内する
