# PostShelf

x.com (旧 Twitter) のブックマークを、無料アカウントでも独自フォルダに分類できる Chrome 拡張 (Manifest V3)。

- ブックマーク先をフォルダ分け (1 ポストを複数フォルダに入れられる)
- フォルダの名前変更・アイコン変更・色分け (どのアイコンでも色を選べる)
- 「ポスト表示」「リスト表示」の切替、検索、並べ替え
- `/i/bookmarks` を開いたとき、表示中のポストを取り込み (ボタンを押したときだけ)
- JSON エクスポート/インポート
- データは `chrome.storage.local` のみ。外部送信・解析・トラッキングなし

## 使い方 (開発版)
```
npm install
npm run build        # dist/ に出力
npm test
npm run typecheck
```
`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択。

## CI の成果物から読み込む (Node.js 不要)
GitHub Actions が push / PR ごとにビルドし、`dist/` を zip にして保存します。

1. リポジトリの **Actions** タブで、対象コミットの CI 実行を開く
2. 下部の **Artifacts** から `postshelf-dist` をダウンロードして展開 (中に `postshelf-dist.zip`、さらに展開すると `manifest.json` がある)
3. `chrome://extensions` → デベロッパーモードをオン → 「パッケージ化されていない拡張機能を読み込む」で、展開したフォルダを選択

テスト・型チェックが失敗した実行では成果物は作られません。成果物の保存期間は GitHub の既定 (90 日) です。

## 構成
- `src/shared`: models / storage (chrome.storage はここだけ) / selectors (X の DOM セレクタ) / strings (UI 文言)
- `src/content`: ポストのボタンとポップオーバー、スナップショット抽出、ブックマーク画面の収集
- `src/manager`, `src/popup`: Preact UI
- アイコンは Tabler Icons をローカル同梱

## X の仕様変更への備え
DOM セレクタは `src/shared/selectors.ts` に集約。X の仕様変更で合わなくなったら、そこだけ直す。X の非公開 API は使わず、自動スクロールもしない。
よくある質問 (スマホのブックマークの取り込み、別端末への移行など) は [docs/FAQ.md](docs/FAQ.md)。
実機確認項目は [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md)、計画は [docs/PLAN.md](docs/PLAN.md)。

## 注意
X の DOM を前提にしているため、fixture テストでは、実際の X との差異を検出できません。公開前に実機確認が必要です。
