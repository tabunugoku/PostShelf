# 公開準備メモ

- [ ] 実機確認 (`docs/MANUAL_TEST.md`) を全項目実施
- [ ] Chrome Web Store で「PostShelf」の同名拡張がないか再確認
- [x] 拡張機能アイコン: `manifest.json` の `icons` (16/32/48/128) と `action.default_icon` (16/32/48) に設定済み
- [ ] ストア掲載用のアイコン画像: 128px = `static/brand/icon-128.png`、512px = `docs/brand/icon-512.png` (ソース SVG は `docs/brand/icon.svg`、確認用 `docs/brand/preview.png`)。青 (#1D9BF0) の吹き出しと白い栞だけ (背景なし。ライト・ダークのどちらでも見える)。X のロゴは使っていない
- [ ] ストア掲載文・スクリーンショット・プライバシーポリシー (外部送信なし、保存は端末内のみ)
- [ ] 権限の説明: `storage`/`unlimitedStorage` (ブックマーク保存), `sidePanel` (サイドパネル), host `x.com`/`twitter.com` (ボタン挿入と DOM 読み取り。取り込みは、ユーザーが開いた「履歴」→「ブックマーク」タブ `/i/history` の表示中のポストだけを、ボタンを押したときに読む)
  - **画像のキャッシュ (任意の権限)**: `pbs.twimg.com` (X の画像サーバー) へのアクセスは、manifest の `optional_host_permissions` に宣言している。必須の `permissions` / `host_permissions` は増やしていない (テストで manifest を確認)。そのため、拡張機能の更新だけで Chrome が権限の再承認を求めることはない。設定「画像のキャッシュ」をオンにするクリックの中で `chrome.permissions.request` を呼び、拒否されたらオフに戻す。通信は画像の取得 (GET) だけで、X の非公開 API は呼ばない。取得した画像はこの PC の中にだけ置き、外部へ送らない
  - プライバシーポリシーには、キャッシュをオンにした場合の通信先 (`pbs.twimg.com`) と、画像が端末内にだけ保存されることを書く (初期値はオフ)
  - 「自分で選んだフォルダ」は File System Access API。選んだフォルダのハンドルは IndexedDB に保存し、書き込みは `images/` の下の自分が作ったファイルだけ
  - サイドパネルの「いま開いているポストを保存」はアクティブタブの URL (x.com / twitter.com のみ) を読むが、**`tabs` / `activeTab` 権限は追加していない**。x.com / twitter.com は host 権限に入っているので `chrome.tabs.query` の `url` が読める。他のサイトの URL は読めない
- [ ] リモートコード不使用 (CDN なし、アイコンフォントは同梱) を申告
- [ ] 類似拡張との差別化 (アイコン/色/X 風ポスト表示/完全ローカル) をストア説明に反映
- [ ] バージョン更新手順: `package.json` と `static/manifest.json` の version を揃える

## X の画面構造の変更への自己診断 (v7)
- [ ] 外部サーバーからセレクタを取得しない (外部通信なしの方針)。自己診断は端末内で完結し、結果は `chrome.storage.local` の `health` に保存するだけ
- [ ] 「診断情報をコピー」: ユーザーが押したときだけ作り、内容をダイアログで確認させてから、ユーザーが「コピー」を押したときだけクリップボードに入れる。内容はバージョン / UA / UI 言語 / health / article の骨格 (タグ名・role・data-testid・aria-* の属性名のみ。テキスト・URL・ユーザー名・ID は含めない)。自動送信はしない
- [ ] 「GitHub で報告」のリンク先は `src/shared/links.ts` の `ISSUE_URL` の **1 か所**で定義 (`.github/ISSUE_TEMPLATE/selector-broken.md`)。公開時にリポジトリ名が変わるならここを直す。リンクを開くだけで、診断情報は自動では貼らない
- [ ] ストアのプライバシー説明: 診断情報は端末内で作成され、ユーザーが明示的にコピーして自分で報告する場合のみ外に出る
