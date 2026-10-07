# 公開準備メモ

- [ ] 実機確認 (`docs/MANUAL_TEST.md`) を全項目実施
- [ ] Chrome Web Store で「PostShelf」の同名拡張がないか再確認
- [x] 拡張機能アイコン: `manifest.json` の `icons` (16/32/48/128) と `action.default_icon` (16/32/48) に設定済み
- [ ] ストア掲載用のアイコン画像: 128px = `static/brand/icon-128.png`、512px = `docs/brand/icon-512.png` (ソース SVG は `docs/brand/icon.svg`、確認用 `docs/brand/preview.png`)。黒地に白い吹き出しと青 (#1D9BF0) の栞。X のロゴは使っていない
- [ ] ストア掲載文・スクリーンショット・プライバシーポリシー (外部送信なし、保存は端末内のみ)
- [ ] 権限の説明: `storage`/`unlimitedStorage` (ブックマーク保存), host `x.com`/`twitter.com` (ボタン挿入と DOM 読み取り)
- [ ] リモートコード不使用 (CDN なし、アイコンフォントは同梱) を申告
- [ ] 類似拡張との差別化 (アイコン/色/X 風ポスト表示/完全ローカル) をストア説明に反映
- [ ] バージョン更新手順: `package.json` と `static/manifest.json` の version を揃える
