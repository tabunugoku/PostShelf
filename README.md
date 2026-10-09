# PostShelf

A Chrome extension (Manifest V3) that lets you sort your X (formerly Twitter) bookmarks into your own folders. It works with a free account. Your data stays on your computer.

**Website:** https://tabunugoku.github.io/PostShelf/ · **Download:** [Releases](https://github.com/tabunugoku/PostShelf/releases) · **License:** MIT

日本語の説明は、下の「日本語 (Japanese)」を開いてください。

## Features

- Sort saved posts into folders (one post can be in several folders)
- Rename folders, change their icons, and color them (any icon can have a color)
- Post view, list view and grid view; search, filters and sorting
- Side panel: save the post you have open with one tap
- Several X accounts: your data is kept separately for each account
- Import your existing bookmarks from x.com (only after you agree in a confirmation dialog)
- Full text of long posts, with collapse/expand and links inside the text
- Export and import your data as JSON
- Images and videos: view images in a large viewer; videos play on X (only the thumbnail is saved)
- Image cache (in Settings, **off by default**): also keep the images of saved posts, either inside the browser or in a folder you choose.
  - Turning it on adds one more destination: `pbs.twimg.com` (X's image server, the same place X itself loads images from). Chrome asks for permission when you turn it on (it is an optional permission, and it is not requested if you leave the cache off).
  - Downloaded images are stored only on your computer and are never sent to any server. A JSON export contains only image URLs, not the images.
- The interface is available in 8 languages
- Data is stored in `chrome.storage.local` only. No data is sent out. No analytics. No tracking.

## Install

PostShelf is not distributed on the Chrome Web Store. Download the zip from [Releases](https://github.com/tabunugoku/PostShelf/releases), unzip it, and load the folder with "Developer mode" in Chrome (Chrome 114 or later). To update, **do not remove the extension**: overwrite the same folder and press "Reload", and your saved data is kept. For the steps, see **[docs/INSTALL.en.md](docs/INSTALL.en.md)** ([日本語](docs/INSTALL.md)).

## Development

```
npm install
npm run build        # outputs to dist/
npm test
npm run typecheck
```

Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and select `dist/`.

### Load a build from CI (no Node.js needed)

GitHub Actions builds every push and pull request and saves `dist/` as a zip.

1. Open the **Actions** tab of this repository and open the CI run of the commit you want.
2. Download `postshelf-dist` from **Artifacts** at the bottom and unzip it (it contains `postshelf-dist.zip`; unzip that too, and you get `manifest.json`).
3. Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and select the unzipped folder.

No artifact is produced when tests or the type check fail. Artifacts are kept for GitHub's default period (90 days).

### Layout

- `src/shared`: models / storage (the only place that touches `chrome.storage`) / selectors (X DOM selectors) / strings (UI text)
- `src/content`: the post buttons and popover, snapshot extraction, collecting from the bookmarks page
- `src/manager`, `src/popup`: Preact UI
- Icons are bundled locally from Tabler Icons

### Keeping up with changes on X

All DOM selectors live in `src/shared/selectors.ts`. If a change on X breaks them, fix that file only. PostShelf does not use X's private API. Automatic scrolling is limited to the bookmark import that you start by agreeing in a confirmation dialog (see "Importing bookmarks automatically" below).

For frequently asked questions (importing bookmarks saved on your phone, moving to another computer, and so on), see [docs/FAQ.md](docs/FAQ.md) (Japanese). The manual test checklist is [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md), and the plan is [docs/PLAN.md](docs/PLAN.md) (both in Japanese).

## Full text of long posts (note on X's terms)

X collapses long posts behind "Show more". If a post was saved while collapsed, its full text is missing, so **when you save it, PostShelf opens that post's page in a background tab, reads the full text, and closes the tab** (the tab you are looking at is left alone). It waits 4 to 8 seconds between posts, and stops if X shows a limit or a warning. If you turn off "Fetch the full text of long posts" in Settings, only the collapsed text is saved. Nothing is sent outside, and X's private API is not used. Even so, this behavior may be regarded as "automated access" under X's terms (this is not legal advice, and the author cannot take responsibility). See [docs/FAQ.md](docs/FAQ.md) for details.

## Importing bookmarks automatically (note on X's terms)

PostShelf can import your bookmarks from x.com ("History" → "Bookmarks") by scrolling the page automatically. **It runs only after you agree in the confirmation screen and press "Start"** (it never starts right after installation, right after switching accounts, or just because you opened the page). The speed is kept low, you can pause or stop at any time, and it stops by itself if X shows a limit or an error. Nothing is sent outside, and X's private API is not used. If you turn off "Use automatic import" in Settings, neither the guide nor the start button is shown.

However, automatic scrolling may be regarded as "automated access", which X's terms prohibit. **If your account is restricted or anything else happens, the author cannot take responsibility.** Use it at your own risk and only on your own account. See [docs/FAQ.md](docs/FAQ.md) for details.

## Caution

PostShelf relies on X's DOM, so fixture tests cannot detect differences from the real X. Check on a real browser before relying on it.

## License and disclaimer

- Licensed under the MIT License ([LICENSE](LICENSE)). The license covers only PostShelf's code. It does not cover X's content or trademarks such as X's name and logo. For bundled third-party parts, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- PostShelf is an unofficial extension and is not affiliated with X.
- You are responsible for following X's terms of service.
- The author gives no warranty of any kind and takes no responsibility for account suspension or restriction, data loss, or anything else.

<details>
<summary>日本語 (Japanese)</summary>

x.com (旧 Twitter) のブックマークを、無料アカウントでも独自フォルダに分類できる Chrome 拡張 (Manifest V3)。データはパソコンの中だけに保存します。

**紹介サイト:** https://tabunugoku.github.io/PostShelf/ · **ダウンロード:** [Releases](https://github.com/tabunugoku/PostShelf/releases) · **ライセンス:** MIT

## 機能

- ブックマーク先をフォルダ分け (1 ポストを複数フォルダに入れられる)
- フォルダの名前変更・アイコン変更・色分け (どのアイコンでも色を選べる)
- 「ポスト表示」「リスト表示」「グリッド表示」の切替、検索、絞り込み、並べ替え
- サイドパネル: いま開いているポストを 1 タップで保存
- 複数の X アカウント: データはアカウントごとに分けて保存
- x.com の既存のブックマークの取り込み (確認の画面で同意したときだけ)
- 長いポストの全文の取得、たたむ・広げる、本文中のリンク
- JSON エクスポート/インポート
- 画像・動画: ポストの画像を大きく表示できます。動画は X で再生します (サムネイルだけ保存)
- 画像のキャッシュ (設定、**初期値はオフ**): 保存したポストの画像を、ブラウザの中か、自分で選んだフォルダにも残せます。
  - オンにすると、通信先に `pbs.twimg.com` (X の画像サーバー。X が自分で画像を読み込んでいる場所と同じ) が加わります。Chrome がオンにするときに許可を求めます (任意の権限。オフのままなら求めません)
  - 取得した画像は、この PC の中にだけ置きます。外部のサーバーへは送りません。JSON のエクスポートに画像は入りません (URL のみ)
- 画面は 8 言語に対応
- データは `chrome.storage.local` のみ。外部送信・解析・トラッキングなし

## インストール

Chrome Web Store では配布していません。[Releases](https://github.com/tabunugoku/PostShelf/releases) から zip をダウンロードして展開し、Chrome の「デベロッパーモード」でそのフォルダを読み込みます (Chrome 114 以降)。更新するとき、**拡張機能を削除せず**、同じフォルダに上書きして「再読み込み」を押すと、保存したデータが残ります。手順は **[docs/INSTALL.md](docs/INSTALL.md)** ([English](docs/INSTALL.en.md)) を見てください。

## 開発 (開発版の使い方)

```
npm install
npm run build        # dist/ に出力
npm test
npm run typecheck
```

`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択。

### CI の成果物から読み込む (Node.js 不要)

GitHub Actions が push / PR ごとにビルドし、`dist/` を zip にして保存します。

1. リポジトリの **Actions** タブで、対象コミットの CI 実行を開く
2. 下部の **Artifacts** から `postshelf-dist` をダウンロードして展開 (中に `postshelf-dist.zip`、さらに展開すると `manifest.json` がある)
3. `chrome://extensions` → デベロッパーモードをオン → 「パッケージ化されていない拡張機能を読み込む」で、展開したフォルダを選択

テスト・型チェックが失敗した実行では成果物は作られません。成果物の保存期間は GitHub の既定 (90 日) です。

### 構成

- `src/shared`: models / storage (chrome.storage はここだけ) / selectors (X の DOM セレクタ) / strings (UI 文言)
- `src/content`: ポストのボタンとポップオーバー、スナップショット抽出、ブックマーク画面の収集
- `src/manager`, `src/popup`: Preact UI
- アイコンは Tabler Icons をローカル同梱

### X の仕様変更への備え

DOM セレクタは `src/shared/selectors.ts` に集約。X の仕様変更で合わなくなったら、そこだけ直す。X の非公開 API は使わない。自動スクロールは、ユーザーが確認ダイアログで同意して始めたブックマークの自動取り込みに限る (下の「ブックマークの自動取り込み」を参照)。

よくある質問 (スマホのブックマークの取り込み、別端末への移行など) は [docs/FAQ.md](docs/FAQ.md)。実機確認項目は [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md)、計画は [docs/PLAN.md](docs/PLAN.md)。

## 長いポストの全文の取得 (規約上の注意)

X は、長いポストを「さらに表示」でたたみます。たたまれた状態で保存すると、全文が取れないので、**保存した時点で、そのポストのページを、裏のタブで開いて全文を読み、閉じます** (いま見ているタブは、そのままです)。1 件ごとに 4〜8 秒の間隔をあけ、X が制限や警告を出したら止まります。設定の「長いポストの全文を取得する」をオフにすると、たたまれた分だけを保存します。外部への送信や X の非公開 API の利用はありません。この動作も、X の規約上の「自動化されたアクセス」とみなされる可能性があります (法的な助言ではありません。作者は責任を負えません)。詳しくは [docs/FAQ.md](docs/FAQ.md)。

## ブックマークの自動取り込み (規約上の注意)

x.com の「履歴」→「ブックマーク」を、画面の自動スクロールで取り込む機能があります。**確認の画面で同意して「始める」を押したときだけ動きます** (インストール直後・アカウント切替直後・ページを開いただけでは始まりません)。速度を抑え、いつでも一時停止・停止でき、X が制限やエラーを出したら自動で止まります。外部への送信や X の非公開 API の利用はありません。設定の「自動取り込みを使う」をオフにすると、案内も開始のボタンも出ません。

ただし、自動スクロールは、X の規約が禁じる「自動化されたアクセス」とみなされる可能性があります。**アカウントの制限などが起きても、作者は責任を負えません。** 自分の判断で、自分のアカウントに対してだけ使ってください。詳しくは [docs/FAQ.md](docs/FAQ.md)。

## 注意

X の DOM を前提にしているため、fixture テストでは、実際の X との差異を検出できません。公開前に実機確認が必要です。

## ライセンスと免責

- ライセンスは MIT です ([LICENSE](LICENSE))。対象は PostShelf のコードだけで、X のコンテンツや X の名称・ロゴなどの商標は含みません。同梱の第三者の部品は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
- PostShelf は非公式の拡張機能で、X との提携はありません。
- X の利用規約を守る責任は、利用者にあります。
- 作者は、いかなる保証もしません。アカウントの停止や制限、データの消失などについて、責任を負いません。

</details>
