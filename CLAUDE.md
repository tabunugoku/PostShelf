# PostShelf

Chrome 拡張 (Manifest V3)。x.com (旧 Twitter) のブックマークを独自フォルダに分類する。無料アカウントで使える。データは完全ローカル保存。

詳細な計画は `docs/PLAN.md`。最初に読むこと。

## 現在のタスク
`docs/TASK_V2.md` を最優先で実施する (外観を `docs/mockups/` に寄せる + 日英 i18n)。

## 機能要件
1. ポスト (tweet) のブックマーク先をフォルダ分けできる (1 ポストが複数フォルダ可)
2. 保存済みポストを「リスト表示」と「ポスト表示 (X 風カード)」で見られる
3. フォルダの名前変更、アイコン変更が可能。アイコンが `ti-folder` (フォルダ) のときだけ色を選べる
4. 組み込みフォルダ「すべて」は名前/アイコン/色の変更不可・削除不可

## UI の構成 (3 画面)
- content script: x.com の各ポストのブックマークボタン横にフォルダ選択ポップオーバー (チェックボックス式、「新しいフォルダ」行つき)
- manager ページ (`chrome-extension://.../manager.html`): 左にフォルダ一覧、右にポスト一覧。ヘッダーに編集ボタンと「ポスト表示 / リスト表示」切替。編集パネルは名前入力、アイコン 8 種以上のグリッド、色スウォッチ 8 色
- popup: 件数、フォルダ数、「管理画面を開く」

## 技術スタック
- TypeScript + esbuild (バンドル) + Preact (manager/popup)
- アイコンは Tabler Icons (outline) をローカル同梱 (CDN 禁止: MV3 の CSP とプライバシーのため)
- テスト: vitest + jsdom。x.com の DOM は `test/fixtures/*.html` に固定して検証
- 権限は最小: `storage`, `unlimitedStorage`, host `https://x.com/*` `https://twitter.com/*`。リモートコード/外部通信は禁止

## データモデル (`src/shared/models.ts`)
```ts
Folder   { id: string; name: string; icon: string; color?: string; order: number }
Bookmark { tweetId: string; folderIds: string[]; savedAt: number;
           snapshot: { text: string; author: string; handle: string; avatar?: string;
                       media: string[]; createdAt?: string; url: string } }
```
保存は `src/shared/storage.ts` に集約 (`chrome.storage.local`)。他のコードは直接 `chrome.storage` を触らない。

## 守ること
- X の DOM セレクタは `src/shared/selectors.ts` の 1 ファイルに集約 (`data-testid` 優先: `tweet`, `bookmark`, `removeBookmark`, `User-Name`, `tweetText` など)。X の仕様変更はここだけ直せばよい構造にする
- X の非公開 API / GraphQL を直接呼ばない。自動スクロールで大量取得しない。ユーザーが見ている画面の DOM のみ読む
- 外部サーバーへの送信なし。解析/トラッキングなし
- 不確かな X の DOM 構造は推測で断定せず、fixture とコメントで前提を明記する
- 対応言語は日本語と英語 (`chrome.i18n`, `_locales/{ja,en}`)。UI 文字列は直書きせず `t()` 経由

## 実装順 (マイルストーン)
1. M1 骨組み: manifest.json, ビルド, `models.ts`, `storage.ts`, フォルダ CRUD (名前/アイコン/色) と単体テスト
2. M2 content script: ブックマークボタン横のポップオーバー、スナップショット保存 (fixture でテスト)
3. M3 manager ページ: ポスト表示/リスト表示、フォルダ編集 UI、検索、並べ替え
4. M4 `/i/bookmarks` 閲覧時の DOM 収集、JSON エクスポート/インポート
5. M5 README、セレクタ耐性、公開準備メモ

各マイルストーンごとにコミットし、`npm test` と `npm run build` が通る状態を保つ。

## コマンド (M1 で整備する)
- `npm install`
- `npm run build` → `dist/` に出力 (`chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」)
- `npm test`
- `npm run typecheck`

## クラウド環境での注意
実ブラウザでの x.com 動作確認はできない。fixture テストとビルド成功で担保し、実機確認項目は `docs/MANUAL_TEST.md` にチェックリストとして残す (ユーザーが後で実施)。
