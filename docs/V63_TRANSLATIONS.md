# v63 の日本語 UI 文言の点検

利用者が選んだ 11 件を、`static/_locales/ja/messages.json` に反映した。ほかの 7 言語は、`showInAncestorsDesc` を除いて変えない (日本語の言い回しだけの修正のため。en などは、すでに意味どおり)。プレースホルダーは変えていない。

| キー | 変更前 (ja) | 変更後 (ja) | 理由 |
|---|---|---|---|
| cacheDirNonEmpty | ここに「.postshelf」「README.txt」「images」フォルダを作ってよいですか？ | ここに「.postshelf」と「README.txt」のファイル、「images」フォルダを作ってよいですか？ | 「フォルダ」が 3 つ全部にかかって読める。`.postshelf` と `README.txt` はファイル |
| fullTextSwitchDesc (末尾) | オフにすると、省略された分だけを保存します。 | オフにすると、X が省略した状態の本文をそのまま保存します。 | 「省略された分」が、省略された残りの部分と読める |
| showInAncestorsDesc | (V62 の案どおり、末尾に 1 文を追加) | …保存データは変わりません。親と子の両方に直接入れたポストは、子にだけ表示されます。 | 注意書きの追加。ja は V62 案から「直接」を補った (ほかの 7 言語は V62 案の文言を反映) |
| triageKeyReplace | はずす番号を選んでください。 | 外す番号を選んでください。 | 「外す」にそろえる |
| acReasonHidden | …自動で止めました | …自動で一時停止しました | 状態は「一時停止中」。`acNoteRunning` も「一時停止します」 |
| fullTextProgressSkipped | （飛ばした: $SKIPPED$ 件） | （スキップ: $SKIPPED$ 件） | 自動取り込みの表示にそろえる |
| removeFromPostShelf | PostShelf の保存を削除 | PostShelf から削除 | 同じ動作の `deletePost` にそろえる |
| folderDeleteTree | …ポストからその所属を外します。 | …ポストから、これらのフォルダへの所属を外します。 | 「その」の指す先を明示 |
| triageHint | 数字キーで入れる · Esc で終了 | 数字キーで仕分け · Esc で終了 | 入れる対象が分からない。1 行 20 字以内の制約 (v29) を守る |
| diagNotice | …X の画面構造の骨組みです。 | …X の画面構造の概要です。 | 比喩をやめる |
| recent7 | 最近の 7 日 | 直近 7 日 | 数値との組み合わせを自然にする |

`removeFromPostShelf` と `recent7` の変更に合わせて、これらの文言を直接書いているテストと文書 (`docs/FAQ.md`、`docs/MANUAL_TEST.md`) の表記も直した。
