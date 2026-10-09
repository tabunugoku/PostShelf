# TASK v31: v28〜v30 のコードレビューの指摘 17 件の修正

v30 が終わったあとに実施する。`/code-review` (2026-10-09、v28〜v30 の 13 コミットが対象) の指摘 17 件を直す。新しい機能は足さない。保存データの形は変えない。必須の権限は増やさない。外部通信もしない。

指摘は、コードを読んで確認した。実機での再現はしていない。直す前に、各項目の「確認すること」で、現状のコードが書かれたとおりかを確かめる。違っていたら、直さず、その旨を報告に書く。

## 画面の文字列のルール (v28 と同じ。新しい文言を足す場合に適用)
- ボタンとチップは 1 行に収め、10 字前後までにする。説明は 40 字前後、2 行まで。
- 新しい文言は 8 言語 (`ja en zh_CN zh_TW ko es pt_BR fr`) すべてに入れる。

## 1. 仕分けモードで、数字キーの長押しが、続くポストにも効く (`src/manager/Triage.tsx`)
### 原因
- `onKey` の数字キーの処理 (`digitOf` のあと) に `e.repeat` の除外がない。長押しで keydown が繰り返されると、最初のキーで追加して `next()` したあと、再描画が終わってからのリピートが、次のポストに効き、さらに次へ進む。再描画の前のリピートは、古い `cur` / `assigned` の閉包で、同じポストに二重に動く。
### 直し方
- 数字キー、`ArrowLeft` / `ArrowRight`、`N` の処理の先頭で、`e.repeat` なら何もしない (`preventDefault` だけして戻る)。
- `choose` の実行中 (await のあいだ) は、次の `choose` を受けない (`useRef` の実行中フラグ)。終わったら外す。

## 2. サイドパネルのチップの連打で、先に押した分の選択が消える (`src/manager/SaveCurrent.tsx`)
### 原因
- `toggle(c, id)` は、描画時点の `cur.selected` から次の選択を作る。`setCur` は `commit` の `await` (`setBookmarkFolders` と `requestNativeSync`) のあとなので、そのあいだに 2 つ目を押すと、古い `selected` から上書きする。
### 直し方
- 選択は、`useRef` に最新の値を持ち、`toggle` はその値から作る (押した瞬間に ref とチップの表示を更新する。保存は順番に実行する)。保存の呼び出しは、直列にする (前の保存が終わってから、最新の選択で 1 回保存する。連打は最後の状態にまとめてよい)。
- 失敗したときは、ref とチップを、最後に保存できた状態に戻して、エラーを出す。

## 3. フォルダ名の区切り「、」の直書き (`src/manager/SaveCurrent.tsx` 92 行付近)
- `names.join('、')` を、`Intl.ListFormat(chrome.i18n.getUILanguage(), { style: 'narrow', type: 'conjunction' })` に替える。使えない環境では `', '`。CLAUDE.md の「UI 文字列は直書きせず `t()` 経由」に合わせる。
- 同じ問題が他にないか、`'、'` と `'・'` を `src` で探して確認する (UI に出る文字列だけが対象)。

## 4. 「最近使った」の更新 (`src/content/popover.ts`、`src/shared/settings.ts`、`src/manager/SaveCurrent.tsx`、`src/manager/Triage.tsx`)
### 原因
- ポップオーバーの保存で、`updateSettings({ recentFolderIds: pushRecentFolders((await getSettings())…) })` の `await` が、`.catch` の外にある。`getSettings` が失敗すると、例外が `saveNow` に伝わり、保存の成功後なのに「保存に失敗」と出て、続く `requestCache` / `requestFullText` / 連動モードの同期が飛ぶ。
- 読み (`getSettings`)・計算 (`pushRecentFolders`)・書き (`updateSettings`) が別々で、続けて保存すると、後の書き込みが先の追加を消す。
- V28 の指示書は「保存でフォルダを選ぶたびに更新する」だったが、更新は x.com のポップオーバーだけ。サイドパネルのチップと、仕分けモードは更新しない。
### 直し方
- `settings.ts` に `updateRecentFolders(used: string[]): Promise<void>` を足す。`updateSettings` と同じ書き込みの直列化の中で、現在の `recentFolderIds` を読み、`pushRecentFolders` で更新して書く (読みと書きを 1 回の操作にする)。失敗は呑み込まず、返す。
- ポップオーバーは、保存の成功後の最後 (`requestCache` / `requestFullText` / 連動モードの同期のあと) に `void updateRecentFolders(added).catch(() => {})` を呼ぶ。保存の流れを止めない。
- サイドパネルのチップの保存 (`commit`) と、仕分けモードの `choose` / 「他のフォルダ」/ 新しいフォルダでも、フォルダを新しく足したときに `updateRecentFolders` を呼ぶ (失敗は無視)。

## 5. 検索の正規化 (`src/shared/query.ts`、`src/shared/highlight.ts`、`src/shared/folderPicker.ts`、`src/manager/Settings.tsx`)
### 原因 (3 つ)
1. `foldText` が 2 か所にある (`query.ts` は 1 文字ずつ NFKC、`folderPicker.ts` は全体を NFKC)。挙動が違う。
2. `query.ts` の 1 文字ずつの NFKC は、半角カナの「ｶﾞ」を「カ」+ U+3099 にして、全角の「ガ」(U+30AC) と一致しない。分解された「か」+「゛」も合成されない。「全角半角を区別しない」の説明と合わない。
3. `queryBookmarks` が、入力のたびに全ポストの本文・投稿者・ハンドルを 1 文字ずつ正規化する。1 万件・本文平均 150 字で、1 回の入力に約 450 万回の `normalize` が走る。
### 直し方
- 新しい `src/shared/fold.ts` (他のモジュールに依存しない) に、`foldText` を 1 つだけ定義し、`query.ts` と `folderPicker.ts` は、そこから import する (`query.ts` は再エクスポートしてよい)。`folderPicker.ts` は content script からも読まれるので、`fold.ts` は `chrome` API や UI に依存させない。
- 正規化は、書記素 (`Intl.Segmenter('ja', { granularity: 'grapheme' })`) の単位で、NFKC → 小文字にする。「ｶﾞ」は 1 つの書記素なので、「ガ」になる。`Intl.Segmenter` がなければ、コードポイント単位に戻す。
- 速い道: 文字列がすべて ASCII なら `toLowerCase()` だけにする。
- `highlight.ts` は、書記素ごとの対応 (元の位置 ↔ 正規化後の位置) を、同じ関数から得る形にする (対応表を作る処理を `fold.ts` に置き、`highlightRanges` が使う)。
- `queryBookmarks` は、ポストごとの正規化済みの文字列を 1 回だけ作って使い回す (`WeakMap<Snapshot, string>` で、スナップショットのオブジェクトをキーにする。保存データが変わると新しいオブジェクトになるので、古いキャッシュは使われない)。検索語の側は、入力ごとに 1 回だけ正規化する。
- 設定の検索 (`Settings.tsx`) は、そのまま `foldText` を使う。

## 6. 設定の検索中の再走査 (`src/manager/Settings.tsx`)
### 原因
- `MutationObserver` が `subtree` の `childList` / `characterData` をすべて見て、変化のたびに `filterSettings` が全行の `textContent` を正規化して比べる。画像のキャッシュの進捗のように、文字が頻繁に変わる部品があると、そのたびに走る。
### 直し方
- 変化の通知は、`requestAnimationFrame` または 150ms のデバウンスで 1 回にまとめる。
- 変化の対象が、検索結果の表示 (`.settings-match` / `.settings-saved`) の中だけなら、何もしない。
- 検索語が空のあいだは、監視しない (いまのまま)。

## 7. 「変更を保存しました」が、関係のない書き込みでも出る (`src/manager/Settings.tsx`)
### 原因
- 変更から 3 秒以内に、どの設定の書き込みの通知 (`onSettingsChanged`) が来ても出す作りで、別タブの `recentFolderIds` の更新などでも出る。逆に、`select` / チェック / ラジオ / レンジ以外 (ボタンで変える設定、テキスト入力) では出ない。
### 直し方
- 時間の窓の推測をやめる。この画面で設定を変える処理 (`updateSettings` / `updateAutoCollect` / `updateImageCache` などを呼ぶ箇所) を、1 つの関数 (例: `save(patch)`) 経由にそろえ、その呼び出しが成功したときに、フラッシュを出す。`onSettingsChanged` は、画面の値の再読み込みにだけ使う。
- 出さない操作 (データの書き出し・読み込み、初期化、削除) は、これまでどおり。

## 8. フォルダ選択の見出しと「未分類」の行 (`src/shared/folderPicker.ts`)
### 原因
- 「最近使った」が出るとき、仮想の「未分類」の行が `shown` の先頭に残り、「すべてのフォルダ (N)」の見出しの下に出る。N には「未分類」が数えられていない。
### 直し方
- 「未分類」の行は、見出しの上 (一覧の先頭) に固定し、見出しの対象にしない。「最近使った」と「すべてのフォルダ」は、ユーザーのフォルダだけにする (「すべてのフォルダ (N)」の N と行数が一致する)。
- 絞り込み中 (`query` あり) は、「未分類」も絞り込みの対象にする (いまのまま)。

## 9. `addRow` の余分なブロック (`src/shared/folderPicker.ts`)
- `const addRow = (f) => { { … } }` の内側の `{ }` を外し、字下げを戻す。動作は変えない。

## 10. コメントの位置 (`src/manager/App.tsx` 85 行付近)
- `inboxView` の説明のコメント (「未分類」は保存データにまだ無くても常にスマートビューに出す…) を、`inboxView` の直前に戻す。`takeEntryHash` の説明のコメントは、`takeEntryHash` の直前だけにする。

## 11. `#triage` で始めるときに、直前の取り込み分が入らないことがある (`src/manager/App.tsx`)
### 原因
- 仕分けモードのキューは、`startTriage` が、App の state の `bookmarks` から作る。取り込み完了の直後に、別タブの保存の通知 (`onDataChanged`) による再読み込みが間に合っていないと、最後に保存された数件が入らない。
### 直し方
- `startTriage` を `async` にし、始める直前に、保存データを読み直した一覧 (`listBookmarks()` の結果。state の `reload()` と同じ読み込み) からキューを作る。読み込みの失敗は、`reportStorageError` で出し、始めない。
- 「仕分けモード」ボタン (`triage-start`) からの開始も、同じ関数を使う。

## 12. 仕分けモードの `live` の Set (`src/manager/App.tsx` 859 行付近)
- `live={new Set(bookmarks.map(…))}` を、`useMemo(() => new Set(…), [bookmarks])` にする。`Triage` の「削除されたポストを飛ばす」の `useEffect` が、毎回の描画で走らないことをテストで確かめる。

## 13. ポップアップの「最近の 3 件」の色の点 (`src/popup/index.tsx` 96 行付近)
- 色のないフォルダと「未分類」が、同じ「中空の点」になっている。色のないフォルダは、中身が塗られた灰色の点 (`var(--text-secondary)` 相当)、「未分類」は中空の点にして、区別する。`aria-hidden` のままでよい。

## 守ること
- 保存データの形は変えない。必須の権限は増やさない。外部通信はしない。
- CLAUDE.md の自動スクロールと全文取得の例外のルールを、広げない。
- 新しい文言を足す場合は、8 言語すべてに入れ、`npm run release:check` を通す (この版では、新しい文言は基本的に足さない)。
- スクリーンショットは撮らない・足さない。

## コミットの分け方
1. v31-A: 仕分けモード (長押し、実行中フラグ、`live` の Set、始める前の読み直し) — 項目 1・11・12
2. v31-B: サイドパネルのチップの連打と区切りの直書き — 項目 2・3
3. v31-C: 「最近使った」の更新 (`updateRecentFolders`、ポップオーバー、サイドパネル、仕分けモード) — 項目 4
4. v31-D: 検索の正規化 (`fold.ts`、書記素、キャッシュ、強調との対応) — 項目 5
5. v31-E: 設定の検索の再走査と「変更を保存しました」 — 項目 6・7
6. v31-F: フォルダ選択の見出しと余分なブロック、コメントの位置、ポップアップの点 — 項目 8・9・10・13
7. v31-G: テストの追加、`docs/MANUAL_TEST.md` の v31 の節

## テスト
- 1: `e.repeat` の keydown では何も起きない。`choose` の実行中の 2 つ目の数字キーは無視される。
- 2: 2 つのチップを続けて押しても (1 つ目の保存が終わる前でも)、最後に保存される選択が両方を含む。保存が失敗したら、チップが元に戻る。
- 3: 区切りが `Intl.ListFormat` 経由になる (`ja` と `en` で確かめる)。
- 4: `getSettings` が失敗しても、ポップオーバーの保存の成功後の処理 (`requestCache` など) が呼ばれ、エラーが出ない。2 つのフォルダを続けて足しても、`recentFolderIds` に両方が残る (直列化)。サイドパネルのチップと仕分けモードでも更新される。
- 5: 「ｶﾞｲﾄﾞ」を「ガイド」で、「ガイド」を「ｶﾞｲﾄﾞ」で検索できる。「か」+「゛」(分解形) と「が」が一致する。大文字小文字・全角半角の英数字が一致する。`highlight` の範囲が、これらの本文で元の文字の位置に戻る。同じスナップショットでは、正規化が 1 回だけ走る (呼び出し回数のテスト)。ASCII だけの文字列は `normalize` を呼ばない。
- 6: 変化が連続しても `filterSettings` が 1 フレームに 1 回だけ走る。検索結果の表示の更新では走らない。
- 7: この画面で `select` / チェック / ボタン / テキスト入力の設定を変えて保存が成功したときだけ、フラッシュが出る。別タブの書き込みの通知では出ない。保存が失敗したときは出ない。
- 8: 「最近使った」があるとき、「未分類」の行が見出しの上にあり、「すべてのフォルダ (N)」の N と行数が一致する。
- 11: `#triage` の直前に保存されたポストが、キューに入る (state が古い状態をつくって確かめる)。読み込みが失敗したら始まらない。
- 12: `bookmarks` が変わらない再描画で、`Triage` の `useEffect` が再実行されない。
- 13: 色のないフォルダの点と「未分類」の点が、別の見た目になる。
- 既存のテストは、通ったまま。

## 実機で確認する項目 (`docs/MANUAL_TEST.md` に v31 の節を足す)
- 仕分けモードで、数字キーを押しっぱなしにする。1 件だけが仕分けられる。
- サイドパネルで、チップを素早く 2 つ押す。両方に ✓ が付き、保存されている。
- 半角カナ (例: 「ｶﾞｲﾄﾞ」) を含むポストを、全角で検索できる。保存が数千件ある状態で、検索の入力が重くない。
- 設定を変えると「変更を保存しました」が出る。別のタブで x.com のポストを保存した直後は出ない。

## 完了の条件
`npm run typecheck`、`npm test`、`npm run build`、`npm run release:check` がすべて通ること。必須の権限を増やさないこと。
