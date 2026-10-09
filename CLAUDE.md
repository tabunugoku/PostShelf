# PostShelf

Chrome 拡張 (Manifest V3)。x.com (旧 Twitter) のブックマークを独自フォルダに分類する。無料アカウントで使える。データは完全ローカル保存。

詳細な計画は `docs/PLAN.md`。最初に読むこと。

## 現在のタスク
v2〜v26 は実装済み (バージョン 1.1.1。v26 はコードレビューの指摘 15 件の修正: 取り込みの保存先、インポートの検証、全文取得、速度、細かい不具合、i18n)。v28〜v30 は実装済み。v31 (v28〜v30 のコードレビューの指摘 17 件の修正) の次は `docs/TASK_V32.md` (自動取り込みの待ちを適応式にして高速化) を実施する。その次は `docs/TASK_V33.md` (実機で見つかった不具合 4 件の修正)、`docs/TASK_V34.md` (管理画面の軽量化)、`docs/TASK_V35.md` (実機確認で残った 3 件)。実機での確認は `docs/MANUAL_TEST.md` のチェックリストを使う。

## 機能要件
1. ポスト (tweet) のブックマーク先をフォルダ分けできる (1 ポストが複数フォルダ可)
2. 保存済みポストを「リスト表示」と「ポスト表示 (X 風カード)」で見られる
3. フォルダの名前変更、アイコン変更が可能。どのアイコンでも色を選べる (v5 で変更。以前は folder のみ)
4. 組み込みフォルダ「すべて」は名前/アイコン/色の変更不可・削除不可

## UI の構成 (3 画面)
- content script: x.com の各ポストのブックマークボタン横にフォルダ選択ポップオーバー (チェックボックス式、「フォルダを追加」ボタンつき)
- manager ページ (`chrome-extension://.../manager.html`): 左にフォルダ一覧、右にポスト一覧。ヘッダーに編集ボタンと「ポスト表示 / リスト表示」切替。編集パネルは名前入力、アイコン 8 種以上のグリッド、色スウォッチ 8 色
- popup: 件数、フォルダ数、「管理画面を開く」

## 技術スタック
- TypeScript + esbuild (バンドル) + Preact (manager/popup)
- アイコンは Tabler Icons (outline) をローカル同梱 (CDN 禁止: MV3 の CSP とプライバシーのため)
- テスト: vitest + jsdom。x.com の DOM は `test/fixtures/*.html` に固定して検証
- 権限は最小: `storage`, `unlimitedStorage`, host `https://x.com/*` `https://twitter.com/*`。リモートコード/外部通信は禁止

## データモデル (`src/shared/models.ts`)
```ts
Folder   { id: string; name: string; icon: string; color?: string; order: number; accountId?: string }
Account  { id: string; handle: string; displayName?: string; avatar?: string; lastSeenAt: number }  // v9: id = 小文字のハンドル
Bookmark { accountId: string; tweetId: string; folderIds: string[]; savedAt: number;  // v9: 保存キーは accountId:tweetId
           snapshot: { text: string; author: string; handle: string; avatar?: string;
                       media: string[]; createdAt?: string; url: string } }
```
保存は `src/shared/storage.ts` に集約 (`chrome.storage.local`)。他のコードは直接 `chrome.storage` を触らない。

## 守ること
- X の DOM セレクタは `src/shared/selectors.ts` の 1 ファイルに集約 (`data-testid` 優先: `tweet`, `bookmark`, `removeBookmark`, `User-Name`, `tweetText` など)。X の仕様変更はここだけ直せばよい構造にする
- X の非公開 API / GraphQL を直接呼ばない。ユーザーが見ている画面の DOM のみ読む
- 自動スクロールによる取り込みは、ユーザーが確認ダイアログで同意して開始した取り込みに限る (速度を抑え、一時停止・停止ができ、X の制限を検知したら止める)。それ以外の自動スクロールは入れない。インストール直後・アカウント切替直後・ページを開いただけでは自動では始めない (案内を出すだけ)。実装は `src/content/autocollect.ts`。設定「自動取り込みを使う」をオフにすれば、案内も開始ボタンも出ない
- 長いポストの全文の取得 (v24) は、上の自動スクロールの例外と同じ扱いの、もう 1 つの例外: **保存した時点で、X がたたんでいた (「さらに表示」がある) ポストのページを、裏のタブ (`active: false`) で開いて読み、閉じる**。間隔 (4〜8 秒)・上限 (自動取り込みでは 1 回 30 件、「いま取得する」では 50 件)・止める条件 (X の制限の検知、連続 3 件の失敗) があり、設定「長いポストの全文を取得する」でオフにできる。タイムラインの「さらに表示」は押さない。いま見ているタブは移動も操作もしない。自動のスクロールもしない。実装は `src/background/fulltext.ts`。権限 (`tabs` など) は増やさない
- 外部サーバーへの送信なし。解析/トラッキングなし
- 公開してはいけないもの: **実在のポスト (本文・投稿者名・アイコン) と、開発者自身のアカウント名を含むスクリーンショット、モックアップ、テスト、文書**。スクリーンショットとモックのサンプルは、架空のアカウント (`@me`、`@sample_*` など) と架空の本文だけを使う。`reports/` と `research_notes/` は Git に入れない (`.gitignore` 済み)
- 不確かな X の DOM 構造は推測で断定せず、fixture とコメントで前提を明記する
- 対応言語は日本語と英語 (`chrome.i18n`, `_locales/{ja,en}`)。UI 文字列は直書きせず `t()` 経由

## 紹介サイト (GitHub Pages)
`site/index.html` (静的な 1 ページ。日本語と英語の併用で、ブラウザの言語が日本語なら日本語、それ以外は英語を表示し、ヘッダーの切替で変えられる (各文言は `<span class="ja">` / `<span class="en">` の対。新しい文言は両方に書く)。ビルド不要、外部の JS・CSS・フォントは使わない)。`.github/workflows/pages.yml` が、`main` への push で `site/` を公開する (リポジトリの Settings → Pages → Source を「GitHub Actions」にしてから動く)。スクリーンショットは載せず、画面のイメージはマークアップで描く。サンプルは架空のアカウントだけ。比較表は日付つきで、公開ページの記載に基づく (変わったら更新する)。

## 実装順 (マイルストーン)
1. M1 骨組み: manifest.json, ビルド, `models.ts`, `storage.ts`, フォルダ CRUD (名前/アイコン/色) と単体テスト
2. M2 content script: ブックマークボタン横のポップオーバー、スナップショット保存 (fixture でテスト)
3. M3 manager ページ: ポスト表示/リスト表示、フォルダ編集 UI、検索、並べ替え
4. M4 ブックマーク一覧 (`/i/history`。旧 `/i/bookmarks`) 閲覧時の DOM 収集、JSON エクスポート/インポート
5. M5 README、セレクタ耐性、公開準備メモ

各マイルストーンごとにコミットし、`npm test` と `npm run build` が通る状態を保つ。

## コマンド (M1 で整備する)
- `npm install`
- `npm run build` → `dist/` に出力 (`chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」)
- `npm test`
- `npm run typecheck`

## クラウド環境での注意
実ブラウザでの x.com 動作確認はできない。fixture テストとビルド成功で担保し、実機確認項目は `docs/MANUAL_TEST.md` にチェックリストとして残す (ユーザーが後で実施)。
