# PostShelf

x.com (旧 Twitter) のブックマークを、無料アカウントでも独自フォルダに分類できる Chrome 拡張 (Manifest V3)。

- ブックマーク先をフォルダ分け (1 ポストを複数フォルダに入れられる)
- フォルダの名前変更・アイコン変更。フォルダアイコンのときだけ色分け
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

## 構成
- `src/shared`: models / storage (chrome.storage はここだけ) / selectors (X の DOM セレクタ) / strings (UI 文言)
- `src/content`: ポストのボタンとポップオーバー、スナップショット抽出、ブックマーク画面の収集
- `src/manager`, `src/popup`: Preact UI
- アイコンは Tabler Icons をローカル同梱

## X の仕様変更への備え
DOM セレクタは `src/shared/selectors.ts` に集約。壊れたらそこだけ直す。X の非公開 API は使わず、自動スクロールもしない。
実機確認項目は [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md)、計画は [docs/PLAN.md](docs/PLAN.md)。

## 注意
X の DOM を前提にしているため、fixture テストは実際の X とのズレを保証しません。公開前に実機確認が必要です。
