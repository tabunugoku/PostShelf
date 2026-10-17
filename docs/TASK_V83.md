# TASK v83: 保存したポストを、1 件ずつ別の保存キーに分ける (スキーマ 3)

v1.1.8 の軽量化のレビューで残した指摘 #25 の対応。いまは全ポストを 1 つのキー `bookmarks` に入れているので、1 件の読み書きでも全件を読み書きする。保存データの形を変えるので、この版では、保存の形の変更と移行だけを行い、ほかの機能は変えない。必須の権限は増やさない。外部通信もしない。文言 (_locales) も変えない。

## 決めた方針 (ユーザーの判断、2026-10-17)

1. 一覧の読み方: **Chrome 130 以上にして、`chrome.storage.local.getKeys()` を使う** (`minimum_chrome_version` を 114 から 130 に上げる)。
2. 移行の場所: **裏方 (service worker) だけ**。ほかの画面はスキーマ 3 になるまで待つ。
3. v1.1.8 に戻したとき: **古いキー `bookmarks` に残ったポストのうち、無いものだけを足してから消す**。

## いまの形と困っていること

- `bookmarks`: `Record<'<accountId>:<tweetId>', Bookmark>` を 1 つのキーに入れている (`src/shared/storage.ts`)。
- 次の操作が、1 件だけを扱うのに全件を読む、または全件を書く:
  - `getBookmark`・`getBookmarkOf` (裏方の全文の取得では 1 件ごと)
  - `setBookmarkFolders` (x.com での保存。全件を読んで全件を書く)
  - `refreshFullText`・`fillMissing`・`removeBookmark`
- 別の実行環境 (x.com のタブと管理画面、裏方) が同時に書くと、後から書いたほうが先の変更を消すおそれがある (`storage.ts` の先頭のコメント。自動取り込みを 20 件ごとに保存して、重なる時間を短くしている)。
- 書き込みのたびに、`chrome.storage.onChanged` が全件の新旧の値を、購読しているすべての実行環境に届ける。

## 新しい形 (スキーマ 3)

- ポスト 1 件を 1 つのキーにする: `bm:<accountId>:<tweetId>` → `Bookmark`。値の形 (`Bookmark` の型) は変えない。
- `folders`・`accounts`・`lastSeenAccount`・設定・`collectRun` などは、いまのまま。
- `schemaVersion` を 3 にする。
- 書き出しの JSON は変えない (`version: 2` のまま)。書き出しと取り込みは、移行に失敗したときと、前の版に戻すときの手段になるため。スキーマの番号と書き出しの番号は別のもの。

### 変わること

| 操作 | いま | 新しい形 |
|---|---|---|
| 1 件を読む (`getBookmark` など) | 全件を読む | 1 キーを読む |
| 1 件を保存・更新する (`setBookmarkFolders`・`refreshFullText`) | 全件を読んで全件を書く | 1 キーを読んで 1 キーを書く |
| 補完 (`fillMissing`)・取り込み (`addCollected`) | 全件を読んで全件を書く | 対象のキーだけを読み、変わったキーだけを書く |
| 一括操作 (`mutateBookmarks`)・フォルダの削除 | 全件を読んで全件を書く | 対象のキーだけを読み、変わったキーだけを 1 回の `set` で書く |
| 保存済みの ID (`getSavedIds`・`listAllTweetIds`) | 全件を読む | `getKeys()` でキーだけを読む (値は読まない) |
| 一覧 (`listBookmarks`・`getFillViews`) | 全件を読む | `getKeys()` でそのアカウントのキーを選び、`get(keys)` で読む (全アカウントの分は読まない) |
| 別の実行環境と同時に、別のポストを書く | 後の書き込みが先の変更を消しうる | 互いに消さない |
| 同時に、同じポストを書く | 後の書き込みが残る | 同じ (後の書き込みが残る) |

## 方針の中身

### 1. Chrome 130 以上にして `getKeys()` を使う

- `static/manifest.json` の `minimum_chrome_version` を `"130"` にする (`key` は変えない)。
- 保存済みの ID (`getSavedIds`・`listAllTweetIds`) は、`getKeys()` で `bm:` のキーだけを読み、値は読まない。x.com のブックマーク一覧の件数の計算が、保存件数にかかわらず軽くなる。
- アカウントの一覧 (`listBookmarks`・`getFillViews` など) は、`getKeys()` で `bm:<accountId>:` のキーを選び、`get(keys)` で読む。ほかのアカウントの分は読まない。
- 全アカウントの分 (書き出し、管理画面の全件) は、`getKeys()` で `bm:` のキーを選んで読む。重さはいまと同じ。
- 目次のキーは持たない。全員が書き込む共有のキーが無いので、別の画面と同時に別のポストを書いても、変更が消えない。
- 対応の Chrome の表記 (114 → 130) を直す: `README.md`・`docs/INSTALL.md`・`docs/INSTALL.en.md`・`docs/FAQ.md`・`site/index.html` (2 か所)・`docs/MANUAL_TEST.md` の v5-C の最低バージョンの項目。
- `_locales` の「サイドパネルは Chrome 114 以降で使えます。」(8 言語) は、内容としては正しいので、この作業では変えない。消すか変えるかは、あとでユーザーが選ぶ。
- 前提 (実機未確認): Chrome 114〜129 で、フォルダを上書きして「再読み込み」を押すと、拡張機能は読み込めずエラーになる。拡張機能を削除しなければ、保存データは残る (Chrome を 130 以上にしてから読み込み直せば戻る)。リリースノートに書く。

### 2. 移行は裏方 (service worker) だけが行う

- 裏方は、起動時 (`runtime.onInstalled` と、service worker の起動のたび) に `schemaVersion` を見て、3 未満なら移行する。
- 管理画面・サイドパネル・ポップアップ・x.com のタブは移行しない。保存の関数は、`schemaVersion` が 3 になるまで待つ (`onChanged` で知る)。
  - 待ち始めたら、裏方へ移行を頼むメッセージを 1 回送る (止まっている裏方を起こすため)。
  - 30 秒たっても 3 にならなければ、`StorageError` にする (何も書かない)。
- 裏方の中で同時に 2 回動かないよう、移行は 1 つの Promise にまとめる (いまの `migrating` と同じ)。
- 前提 (実機未確認): 拡張機能を更新すると、古い版の content script は保存データに書けなくなる (`Extension context invalidated`)。古い版が、移行の後に古い `bookmarks` を書き戻すことはない。

### 3. 古いキーに残ったポストを足す

- 古い版 (v1.1.8 まで) は、`schemaVersion` が 3 でも「2 未満ではない」ので移行せず、`bookmarks` を読み書きする。新しい形のポストは見えず、保存すると新しい `bookmarks` キーを作る。
- 新しい版の裏方は、`schemaVersion` が 3 以上でも `bookmarks` のキーがあれば、次のように取り込んでから消す:
  - 新しい形に無いポストだけを `bm:` のキーとして足す。
  - 新しい形に既にあるポストは上書きしない (前の版で変えた所属は反映されない。リリースノートに書く)。
  - 足したキーを読み直して確かめてから、`bookmarks` を `remove` する。
- 古い版が作ったフォルダは `folders` に入っているので、そのまま見える。
- 回収が終わるまで、ほかの画面は保存・書き出し・削除を待つ (PR #72 のレビューの指摘。待たずに進むと、書き出しが旧キーだけのポストを落とし、全削除のあとに旧キーからポストが戻る)。全削除は旧キーも消す。

## 直し方 (案)

### 保存層 (`src/shared/storage.ts`)
- 読み書きの部品を、キーごとにする:
  - `readOne(key)`、`readMany(keys)`、`keysOf(accountId?)` (`getKeys()` から `bm:` または `bm:<accountId>:` を選ぶ)
  - 書き込みは、変わったキーだけの `set`
- `serial()` (同じ実行環境の中で 1 つずつ) は残す。
- 1 件を読んでから書くまで、別の `await` を挟まない決まりも残す。
- `set` と `remove` の両方が要る操作 (`removeBookmark`・`deleteBookmarks`・`assignAccount`・`deleteAccountData`・`deleteAllData`・`restoreBookmarks`):
  - **先に `set`、あとで `remove`** の順にする。途中で止まっても、消えるのではなく重複が残るようにする。
  - `assignAccount` は、新しいキーを `set` してから古いキーを `remove` する。
- `mutateBookmarks` の `hasInbox` は、全件ではなく、変えるポストだけを見る。
- フォルダの削除と付け替え (`deleteFolder`・`writeReparented`) は、`folders` と変わったポストを、1 回の `set` にまとめる (いまと同じく 1 回)。

### 移行 (スキーマ 2 → 3)
1. 純粋な関数 `migrateToV3(map)` で、新しいキーと値を作り、メモリ上で確かめる。
   - 確かめること: 件数、キー、中身が元と同じ。
   - 1 件でも違えば何も書かない (`migrateToV2` と同じ)。
2. 新しいキーと `schemaVersion: 3` を、1 回の `set` で書く。
3. 書いたキーを読み直して、元と比べる。
4. 一致したときだけ、`bookmarks` を `remove` する。
- もう一度実行しても変わらないようにする (冪等)。
- スキーマ 1 のデータは、1 → 2 → 3 と順に移す。

### 変更の通知
- `onDataChanged` は、`bm:` で始まるキーか `folders` が変わったら通知する。`accounts` の扱いはいまのまま。
- `watchMigration` は、いま「`bookmarks` が消えたら、データが消された」と判断している。移行で `bookmarks` を消すと、すべての実行環境が誤って判断するので、条件を直す (`schemaVersion` が消えたとき、または 3 未満になったとき)。
- 公開している関数の名前と引数は変えない。`buttons.ts`・`collect.ts`・`media.ts`・`App.tsx` は変えずに済むようにする。
- 移行を頼むメッセージを受ける処理は `src/background/index.ts` に足す (移行の本体は `storage.ts` に置く)。

### 文書
- `docs/DATA_MODEL.md`: `bookmarks` の節を `bm:<accountId>:<tweetId>` に書き換え、移行 (スキーマ 2 → 3) の節を足す。
- `storage.ts` の先頭のコメント、CLAUDE.md の「データモデル」の節の必要なところ。

## 進め方 (コミットの順)

テストの約 40 ファイルが、`bookmarks` のキーを直接作るか、直接読んで確かめている。形を変えるコミットとテストの書き換えを分ける。

1. **テストの補助を足す (形は変えない)**
   - `test/chrome-mock.ts` の `storage.local` に `getKeys()` と `remove()` を足す。
   - `test/` に、保存したポストを作る関数と読む関数を足す (例: `seedBookmarks(data, list)`・`storedBookmarks(data)`)。
   - 約 40 ファイルを、この関数を使う形に書き換える。この時点では、関数の中身は `bookmarks` のキーを扱う。
2. **保存の形を変える**
   - `storage.ts`・`src/background/index.ts` (移行を頼むメッセージ)・`static/manifest.json` (`minimum_chrome_version`)・テストの補助の関数の中身を変える。
   - 移行 (裏方だけ)、`getKeys()` による読み方、古いキーに残ったポストの取り込みを入れる。
3. **対応の Chrome の表記と文書**
   - 114 → 130: `README.md`・`docs/INSTALL.md`・`docs/INSTALL.en.md`・`docs/FAQ.md`・`site/index.html`。
   - `DATA_MODEL.md`・CLAUDE.md・`MANUAL_TEST.md` の v83。

storage.ts は 1 ファイルなので、Codex の項目は 3 個になる (項目のあいだでファイルを重ねない)。テンプレートの「保存データの形は変えない」は、この作業では外すと明記する。

## 受け入れ条件 (テストで確かめる)

- 1 件の保存・全文の更新・補完で、`set` に渡るキーが、そのポストの 1 キー (と、必要なら `folders`) だけ。
- `getBookmark` は、そのポストの 1 キーだけを読む。
- 架空のデータ (`@sample_*`、例: 5,000 件) をスキーマ 2 から 3 に移し、件数・中身が同じ。`bookmarks` が消える。
- 移行をもう一度実行しても変わらない。
- 移行の確かめで不一致があれば、何も書かない。
- 裏方以外は移行せず、3 になるまで待つ。30 秒で 3 にならなければ、何も書かずにエラーになる。
- 3 になったあとに残った `bookmarks` から、無いポストだけを足し、既にあるポストは上書きしない。
- `getSavedIds` は `getKeys()` だけを使い、値を読まない。
- `listBookmarks` は、ほかのアカウントのキーを読まない。
- 別の実行環境を模した 2 つの書き込み (別のポスト) が、互いの変更を消さない。
- `removeBookmark` などは、`set` のあとに `remove` する。
- 書き出しの JSON は、移行の前と後で同じ。

## 実機で確認してほしい点 (MANUAL_TEST v83)

- v1.1.8 で書き出してから更新する。更新のあと、管理画面の件数 (アカウントごと、フォルダごと) が更新の前と同じ。書き出した JSON を比べても、同じ。
- 更新の直後に x.com のタブと管理画面を開いたままでも、移行が 1 回で終わり、ポストが消えない。
- x.com の 2 つのタブで、別々のポストを続けて保存しても、どちらも残る。
- Chrome 130 未満の環境があれば、読み込みでエラーになり、保存データが消えない (Chrome を上げてから読み込み直すと戻る)。
- 保存件数の多いデータで、x.com での保存と、管理画面での一括操作が、以前より遅くならない。
- v1.1.8 に戻して 1 件保存し、もう一度更新すると、その 1 件が見える。
