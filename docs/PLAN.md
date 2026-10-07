# PostShelf 開発計画

## Context
X のブックマークフォルダは Premium 限定で、名前/アイコン/色のカスタムや一覧表示は弱い。PostShelf は無料アカウントで使える独自フォルダ + 名前変更 + アイコン変更 + (フォルダ時のみ) 色分け + リスト/ポスト表示を提供する。

## 先行調査 (2026-10-07)
類似拡張は多数: Markfolder, XOrganize, X Bookmark Organizer (色付きフォルダ), BookmarkSOS (色付きフォルダ+タグ), Easy X Bookmark Folder, X-mark Manager, bookmarX, BookmarkHub, Tweetsmash, XBookmark (OSS), ufofo。
「アイコン変更 + 色分け + 名前変更 + ポスト/リスト表示切替」を全部満たすものは未確認 (ストア詳細は未精査)。
差別化: アイコン/色カスタム、X 風ポスト表示、完全ローカル保存。

## 名前
"PostShelf" は Web / Chrome Web Store / GitHub 検索で同名なし (近い: GitShelf, ShelfQ, Shelf.io Web Clipper)。公開前にストアで再確認する。

## リスク
1. X の DOM / GraphQL は頻繁に変わる → セレクタを `src/shared/selectors.ts` に集約
2. 公式 API は有料 → 使わない。取得はユーザーが見ている画面の DOM のみ
3. ポスト表示は X 本体の描画を再利用できない → スナップショットから自前描画 (見た目の完全一致は目標外)
4. X ネイティブの上限 (約800-1000件表示) とは独立にローカル保持

## UI イメージ
### manager ページ
```
+-------------------+--------------------------------------------+
| ブックマーク      | [icon] 開発ネタ  [edit]   [ポスト|リスト]  |
| すべて         6  |--------------------------------------------|
| </> 開発ネタ   2  | (ポスト表示) アバター @handle · 2h         |
| 本 あとで読む  2  |   本文...                                  |
| [folder] デザイン 2|   返信 RT いいね   [フォルダ名]            |
| + 新しいフォルダ  | (リスト表示) icon @handle  本文1行  [link] |
|                   |--------------------------------------------|
|                   | 編集パネル: 名前 [____]                    |
|                   |  アイコン [folder][star][code][book]...    |
|                   |  色 (folderのみ) (o)(o)(o)(o)(o)(o)(o)(o)  |
+-------------------+--------------------------------------------+
```
- 色スウォッチ: #E24B4A #BA7517 #639922 #1D9E75 #378ADD #7F77DD #D4537E #888780
- アイコン候補: folder, star, code, book, bulb, heart, photo, briefcase (拡張可)
- 色はアイコンが `folder` のときのみ有効 (他は薄く表示して無効)

### Chrome 内での見え方
- ツールバー: 拡張アイコン + 件数バッジ → クリックで popup (件数 / フォルダ数 / 最近 3 件 / 管理画面を開く / 設定)
- x.com: ポストのブックマークアイコン横に「v」→ フォルダ選択ポップオーバー (チェックボックス + 新しいフォルダ)
- 新規タブ: manager ページ

## 設計
- Manifest V3、権限 `storage`, `unlimitedStorage`、host `https://x.com/*` `https://twitter.com/*`
- 構成: `src/content`, `src/manager`, `src/popup`, `src/background`, `src/shared`
- background: メッセージ中継、JSON エクスポート/インポート

## マイルストーン
M1 骨組み + フォルダ CRUD / M2 content script / M3 manager / M4 取り込み + エクスポート / M5 仕上げ
(CLAUDE.md に詳細)

## 検証
- ビルドして `chrome://extensions` で読み込み
- x.com のタイムライン/個別ポスト/ブックマーク画面でフォルダ追加・移動・削除
- 名前/アイコン/色変更が manager とポップオーバーに即反映
- ポスト/リスト切替、再起動後の永続化
