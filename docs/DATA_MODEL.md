# データモデル (保存データ)

すべて `chrome.storage.local`。スキーマは **v9 でバージョン 2** (`schemaVersion`)。保存と読み込みは `src/shared/storage.ts` (フォルダ/ブックマーク) と `src/shared/settings.ts` (設定・状態) に集約する。

## `folders`: Folder[]
`{ id, name, icon, color?, order, accountId }` (**v9**: `accountId` を追加。フォルダはアカウントごとに分かれる)
- 「未分類」(`id: 'inbox'`) はアカウントごとに 1 つ。`id` が同じでも `accountId` が違えば別のフォルダ
- 「すべて」は保存しない仮想フォルダ (`id: 'all'`)。表示名は `t('allFolderName')`
- 「未分類」(`id: 'inbox'`) は名前を `''` で保存し、表示時に `t('inboxName')` へ解決する (ユーザーが改名したらその名前)
- `color` はどのアイコンでも指定できる (許可リストの 8 色のみ)。無い = 色なし

## `bookmarks`: Record<`${accountId}:${tweetId}`, Bookmark>
`{ accountId, tweetId, folderIds, savedAt, snapshot }`
- **v9**: キーは `accountId:tweetId`。同じポストを別アカウントで保存すると別のブックマークになる
- `folderIds` が空になる操作 (manager の「フォルダから外す」) では、ポストを消さず `['inbox']` に移す。削除は明示的な「削除」だけ
- x.com のポップオーバーで全部のチェックを外した場合のみ、ブックマークごと削除する (従来どおり)

### `snapshot`
`{ text, author, handle, avatar?, media: string[], createdAt?, url, hasVideo?, hasLink? }`
- **v7 で追加**: `hasVideo?: boolean` / `hasLink?: boolean` (真偽値のみ。内容は保存しない)。保存時に content script が判定する
- 読み込み時に欠けていても動く。**v6 以前に保存したポストは未定義 = 未判定**で、「動画あり」「リンクあり」の絞り込みには出ない。URL や拡張子からの推定はしない
- 「画像あり」は `media.length > 0` で判定できるので既存データでも使える
- 保存し直す (フォルダを変更する) と、その時点のスナップショットで `hasVideo` / `hasLink` が入る

## `settings`
`{ syncNative, buttonMode, actionMode, lastFolderId, viewMode, sortKey, viewAccount }`
- `viewAccount` (**v9**): 手動で選んだ表示アカウントの ID。`''` = 選んでいない (x.com で最後に読み取ったアカウントに追従)
- `lastFolderId` / `viewMode` (`post|list|grid`) / `sortKey` は manager の最後の表示状態 (**v7**。`localStorage` は使わない)
- 不正値は読み込み時に既定値へ戻す

## `importHint`: Record<accountId, `{ pending, dismissed }`> (v7、v9 でアカウントごとに)
- `pending`: ブックマーク一覧 (`/i/history`) を開いたときに content script が記録した「画面に出ている未取り込み件数」(最後の観測値)
- `dismissed`: manager の取り込み案内バナーを閉じた時点の `pending`。`pending > dismissed` のときだけバナーを出す
- 件数が減ったとき (取り込んだ等) は `dismissed` も下げ、次の増加で再び案内する

## アカウント (v9)
- `accounts`: Record<accountId, `{ id, handle, displayName?, avatar?, lastSeenAt }`>。`id` は正規化したハンドル (小文字、`@` なし)。`handle` は X での大文字小文字のまま
- `lastSeenAccount`: 同じ形。content script が x.com の画面 (左メニュー下部のアカウント切替ボタン) から読み取るたびに更新する。manager / サイドパネル / popup の既定の表示アカウント
- `schemaVersion`: `2`
- 特別なアカウント `unknown` (表示名「アカウント未設定」): v9 より前に保存したデータと、アカウントを判定できなかったとき用。`accounts` には保存しない
- ハンドルは変更できる。変更すると別のアカウント扱いになるため、manager の「割り当て」で付け替える

### 移行 (スキーマ 1 → 2)
- どの保存関数も、最初に `schemaVersion` を見る。2 未満なら 1 回だけ移行する
- `accountId` の無いフォルダとブックマークを `unknown` に入れ、ブックマークのキーを `unknown:<tweetId>` にする
- メモリ上で結果を検証 (件数・ID・中身が元と同じ) し、1 件でも違えば**何も書き込まず**に失敗する。書き込みは `folders`・`bookmarks`・`schemaVersion` の 1 回の `set`
- 冪等: 移行済みのデータに対してもう一度実行しても変わらない (テスト: `test/accounts.test.ts`)

### エクスポート JSON
- `version: 2`: `{ app, version, exportedAt, accounts, folders, bookmarks }` (全アカウント分。フォルダとブックマークに `accountId`)
- `version: 1` (v9 より前) または `version` なし: インポートすると `unknown` に入る
