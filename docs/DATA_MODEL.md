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
`{ text, author, handle, avatar?, media: string[], createdAt?, url, hasVideo?, hasLink?, videoPoster? }`
- **v11 で追加**: `videoPoster?: string` (動画の `<video poster>` の URL。保存時に取れたときだけ。古い保存分は未定義 = 動画アイコンの枠だけ。特別な移行はしない)
- **v7 で追加**: `hasVideo?: boolean` / `hasLink?: boolean` (真偽値のみ。内容は保存しない)。保存時に content script が判定する
- 読み込み時に欠けていても動く。**v6 以前に保存したポストは未定義 = 未判定**で、「動画あり」「リンクあり」の絞り込みには出ない。URL や拡張子からの推定はしない
- 「画像あり」は `media.length > 0` で判定できるので既存データでも使える
- 保存し直す (フォルダを変更する) と、その時点のスナップショットで `hasVideo` / `hasLink` が入る

## `settings`

(v28) 任意の項目 `recentFolderIds?: string[]` (x.com の保存ポップオーバーの「最近使った」。最大 3 件、新しい順。「未分類」と「すべて」は入れない。無い・不正な値は空として扱う)。
`{ syncNative, buttonMode, actionMode, lastFolderId, viewMode, sortKey, viewAccount, imageCache, autoCollect }`
- `autoCollect` (**v15**): `{ enabled: true, speed: 'slow' | 'normal', cap: 300 | 100 | 0, offers: Record<accountId, 'dismissed' | 'done'> }`。初期化の対象 (`offers` も戻る)。`cap` の 0 は「止めない」。`offers` は案内の記録 (dismissed = 「このアカウントでは表示しない」/ done = 取り込みが終わった)
- `imageCache` (**v11**): `{ enabled: false, backend: 'idb' | 'dir', maxBytes: 1 GB, quality: 'large' | 'orig', onFull: 'evict' | 'stop' }`。初期化の対象
- `viewAccount` (**v9**): 手動で選んだ表示アカウントの ID。`''` = 選んでいない (x.com で最後に読み取ったアカウントに追従)
- `lastFolderId` / `viewMode` (`post|list|grid`) / `sortKey` は manager の最後の表示状態 (**v7**。`localStorage` は使わない)
- 不正値は読み込み時に既定値へ戻す

## `importHint`: Record<accountId, `{ pending, dismissed }`> (v7、v9 でアカウントごとに)
- `pending`: ブックマーク一覧 (`/i/history`) を開いたときに content script が記録した「画面に出ている未取り込み件数」(最後の観測値)
- `dismissed`: manager の取り込み案内バナーを閉じた時点の `pending`。`pending > dismissed` のときだけバナーを出す
- 件数が減ったとき (取り込んだ等) は `dismissed` も下げ、次の増加で再び案内する

## 自動取り込みの状態 (v15)
- `collectRun`: `{ status: countdown|running|paused|limit|stopped|done, accountId, startedAt, imported, skipped, failed, oldestSeenPostDate?, recentPostDate?, speed, cap, reason?, updatedAt }`。x.com のタブが書き、管理画面が読む (進行表示と、ページを閉じたあとの前回の状態)。**設定の初期化の対象外**
- `collectCommand`: `{ id, type: start|pause|resume|stop, consent?, speed?, cap?, accountId?, at }`。管理画面が書き、x.com のブックマークのタブが読んで消す (1 回限り)。`start` は `consent: true` が無ければ動かない。2 分より古いものは捨てる
- **`savedAt` の決め方 (取り込み)**: 取り込んだ時刻ではなく、一覧での位置から決める (`src/shared/ordering.ts` の `assignOrder`)。新しいポストが連続する区間ごとに、すぐ上の取り込み済み (U) とすぐ下の取り込み済み (L) の `savedAt` を使う: U と L の両方がある (U > L) ときは 2 つのあいだを等間隔 (`L + (U − L) × (n − i) / (n + 1)`、小数でもよい)、U だけなら `U − (i + 1) × 1000`、L だけ (いちばん上) なら開始時刻 T から `T − i × 1000` (L より大きくならなければ L の上に積む)、どちらも無ければ `T − i × 1000`、U ≤ L のときは `U − (i + 1)` ミリ秒。取り込み済みのポストの `savedAt` は変えない。既存のデータは移行しない

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

## 画像のキャッシュ (v11)
画像の実体は `chrome.storage.local` には入れない。`src/shared/imagecache.ts` が扱う。
- `idb`: IndexedDB `postshelf-images`。ストア `blobs` (キー `tweetId/名前`、値 `{ buf, type }`)、`meta` (サイズ・保存日・ポストの保存日)、`dirmeta` (フォルダ保存のメタ)、`handles` (選んだフォルダのハンドル)
- `dir`: 選んだフォルダ (`.postshelf`、`README.txt`、`images/<ポストID>/N.ext`・`video-thumb.ext`・`post.json`)。`post.json` は `{ tweetId, handle, displayName, url, savedAt (ISO 8601) }` で、本文は入れない
- 名前は `N` (画像の番号。1 から) と `video-thumb`。拡張子はサーバーが返した形式
- `chrome.storage.local` のキー: `imageCacheFailures` (画像ごとの取得の失敗回数。3 回で諦める)、`imageCacheCleanup` (キャッシュ側の削除が済んでいないときの印)
- キャッシュはポスト ID (tweetId) 単位で、同じポストを複数のアカウントで保存していても 1 組。どのアカウントにも無くなったポストの画像だけ消す
- JSON のエクスポートに画像は含めない (URL のみ)
