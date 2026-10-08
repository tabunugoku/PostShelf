# 配布とリリースの手順 (手動インストール)

配布は Chrome Web Store ではなく、デベロッパーモードでの手動インストールです。利用者向けの手順は [INSTALL.md](INSTALL.md) ([English](INSTALL.en.md))。
このページは、リリースする人 (開発者) 向けです。ストア公開のための項目は、末尾に「いまは行わない (参考)」として残しています。

## 拡張機能 ID (固定)
- 拡張機能 ID: `aglgbnegdnodlmbmlfmaagjkneokagnc`
- `static/manifest.json` の `key` (RSA 2048 の公開鍵。DER を base64 にした値) から決まります。ID は、公開鍵の SHA-256 の先頭 128 bit を a〜p の 32 文字に変えたものです (`scripts/lib.mjs` の `extensionIdFromKey`。テストと `release:check` が `docs/INSTALL.md` の ID と一致することを確かめます)。
- 秘密鍵は、手動インストールでは使わないので、リポジトリにも手元にも残していません。**`key` を変えると ID が変わり、利用者のデータが引き継がれません**。変えないでください。
- ID を決めた版への切り替えは、利用者が 1 回だけエクスポート / インポートを行う必要があります (`docs/INSTALL.md` の 3)。以降の更新では、ID が変わらないので、データは残ります。

## リリースの手順
1. **バージョンを揃える**: `package.json` と `static/manifest.json` の `version` を同じ値にする。
   - 実機確認 (`docs/MANUAL_TEST.md`) を済ませてから `1.0.0` にします。それまでは `0.1.0` のままです。
2. `npm run release:check` を実行する。typecheck / テスト / ビルド / パッケージに加えて、次を確かめます。
   - manifest の version が `package.json` と一致している
   - 必須の `permissions` / `host_permissions` が現在の一覧と完全に同じ (増えていたら失敗)
   - 全 8 言語の `messages.json` のキーとプレースホルダーが一致している
   - `dist` の JavaScript に、外部のスクリプトの URL・`eval`・`new Function`・リモートコードの読み込みが無い
   - manifest が指すファイル (アイコンなど) がすべて zip に入っている
   - `key` から求めた拡張機能 ID が `docs/INSTALL.md` の ID と同じ
3. **リリースノートを書く**: `docs/releases/v<version>.md` に、「## 追加」と「## 修正」の節を書く (どちらも必須。無ければ `release:check` と Release のワークフローが失敗する)。過去のリリースにも同じ形で書く。
4. **タグを打つ**: `git tag v1.0.0 && git push origin v1.0.0` (タグは `v` + manifest の version)。
5. **ワークフローが zip を作る**: `.github/workflows/release.yml` が、タグと manifest の version の一致を確かめ、`release:check` を通してから、`postshelf-<version>.zip` を、`docs/releases/v<version>.md` を本文にして GitHub Release に添付します。
6. **zip を取得して、固定のフォルダに上書き**: Release から zip を保存し、`docs/INSTALL.md` の「2. 更新するとき」の手順で、同じフォルダに上書きして「再読み込み」を押す。更新の前に、設定の「データ」から必ずエクスポートします。

手元で zip だけ作るときは `npm run build && npm run package` (`release/postshelf-<version>.zip`。`release/` は `.gitignore`)。

## ブックマークの自動取り込み (v15) の方針とリスク
CLAUDE.md の「守ること」の例外として、**ユーザーが確認ダイアログで同意して開始した取り込みに限る**自動スクロールを入れている (`src/content/autocollect.ts`)。
- 自動では始まらない (インストール直後・アカウント切替直後・ページを開いただけでは案内を出すだけ)。開始のコマンドには `consent: true` が要り、無ければ動かない。設定「自動取り込みを使う」(既定はオン) をオフにすれば、案内も開始ボタンも出ない
- X の非公開 API / GraphQL は呼ばない。`fetch` / `XMLHttpRequest` も使わない (テストで確認)。外部へ送らない
- 速度を抑える (ゆっくり: 2〜4 秒、標準: 1〜2.5 秒)。いつでも一時停止・停止。X のエラー・制限の表示を検知したら止まる (セレクタは `src/shared/selectors.ts` の `xError`。**実機未確認**)。再開は、ユーザーが押したときだけ
- 必須の権限は増やしていない (開始は `chrome.storage.local` のコマンドで x.com のタブに伝え、タブは host 権限 (x.com) で探す)
- **規約上のリスク**: 自動スクロールは、X の規約が禁じる「自動化されたアクセス」とみなされる可能性がある。アカウントの制限などが起きても、作者は責任を負えません。README / FAQ / INSTALL にも、同じことを正直に書いている。根拠にした `reports/類似拡張機能の比較とX規約対応.md` は、リポジトリに入れていないので、要点だけを文書に書いた
- 手動インストールの配布では、利用者に直接伝えられる。下の「Chrome Web Store への公開」(参考) をやる場合は、この機能が審査や規約で問題になりうるので、公開前に必ず見直す (機能ごと外す、別の版にするなど)

## 同梱している第三者の部品
`THIRD_PARTY_NOTICES.md` に、名前・版・ライセンス全文を載せています (ビルドで `dist/` にも入ります)。部品を足したり版を上げたりしたら、ここも更新します。

## ライセンス
MIT に決定済みです。`LICENSE` に全文があり、`README.md` の「ライセンスと免責」に、対象範囲 (コードのみ)、X との無関係、利用者の責任、無保証を書いています。

# いまは行わない (参考): Chrome Web Store への公開

以下は、Chrome Web Store に公開する場合の準備メモです。配布は手動インストールなので、いまは行いません。

- [ ] 実機確認 (`docs/MANUAL_TEST.md`) を全項目実施
- [ ] GitHub のリポジトリを公開にしてから配る (設定画面の「GitHub で見る」のリンクは、リポジトリが非公開のあいだ、他の人には 404 になる。リンク先は `src/shared/links.ts` の `REPO_URL` の 1 か所)
- [ ] Chrome Web Store で「PostShelf」の同名拡張がないか再確認
- [x] 拡張機能アイコン: `manifest.json` の `icons` (16/32/48/128) と `action.default_icon` (16/32/48) に設定済み
- [ ] ストア掲載用のアイコン画像: 128px = `static/brand/icon-128.png`、512px = `docs/brand/icon-512.png` (ソース SVG は `docs/brand/icon.svg`、確認用 `docs/brand/preview.png`)。青 (#1D9BF0) の吹き出しと白い栞だけ (背景なし。ライト・ダークのどちらでも見える)。X のロゴは使っていない
- [ ] ストア掲載文・スクリーンショット・プライバシーポリシー (外部送信なし、保存は端末内のみ)
- [ ] 権限の説明: `storage`/`unlimitedStorage` (ブックマーク保存), `sidePanel` (サイドパネル), host `x.com`/`twitter.com` (ボタン挿入と DOM 読み取り。取り込みは、ユーザーが開いた「履歴」→「ブックマーク」タブ `/i/history` の表示中のポストだけを、ボタンを押したとき、または確認ダイアログで同意して始めた自動取り込みのときに読む。自動スクロールの規約上のリスクは、上の「ブックマークの自動取り込み」を参照)
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
