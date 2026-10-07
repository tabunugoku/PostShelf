# 追加タスク (v6): 拡張機能アイコンの組み込み

前提: v5 は `claude/serene-johnson-j5tpe7` で実装済み (CI 成功)。続きで作業する (最初に `origin/main` をマージ)。

## アイコン
生成済み: `static/brand/icon-{16,32,48,128}.png` (X のダークテーマに合わせた黒地、青 #1D9BF0 のフォルダ、白い栞のデザイン。X のロゴは使っていない)。白地の代替案は `docs/brand/icon-white-512.png`。ソースは `docs/brand/icon.svg`、確認用の大きい画像は `docs/brand/icon-512.png`。

1. `static/manifest.json` に `icons` (16, 32, 48, 128) を追加し、`action.default_icon` にも 16, 32, 48 を指定する。パスは `brand/icon-N.png`
2. `build.mjs` は `static/` 全体を `dist/` にコピーしているので、`dist/brand/` に入ることを確認する (`dist/icons/` は Tabler Icons 用なので混ぜない)
3. popup と manager (タブ / サイドパネル) の見出しにある `ti-books` アイコンを、`brand/icon-32.png` に置き換えるかどうかを判断する。置き換える場合は `web_accessible_resources` の要否も確認する
4. ストア掲載用の画像 (`docs/PUBLISH.md`) に、アイコン 128px と 512px のファイルの場所を追記する
5. テスト: manifest の `icons` に書かれたファイルがすべて `static/brand/` に存在することを確認するテストを追加する

## 完了条件
- `npm run typecheck`, `npm test`, `npm run build` がすべて通る (CI も成功)
- コミットは 1 つにまとめる
