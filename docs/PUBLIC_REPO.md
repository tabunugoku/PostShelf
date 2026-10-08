# 公開用リポジトリの作り方と更新 (開発用リポジトリの手順書)

このリポジトリ (開発用、非公開) は、画像、開発用の文書、モックを含み、履歴も残っています。**このリポジトリは公開しません。** 公開するのは、履歴のない別のリポジトリで、`tools/export_public.py` が書き出したものだけを入れます。

## 方針 (ユーザーの決定)
- 画像 (スクリーンショットも、架空のサンプルも) は、GitHub の公開リポジトリに載せない。手元と、開発用リポジトリには残す。
- `CLAUDE.md`、`docs/PLAN.md`、`docs/TASK_V*.md` などの開発用の文書も、公開しない。手元と、開発用リポジトリには残す。
- リポジトリの名前: 開発用を `PostShelf-dev` (非公開) に改名し、公開用を `PostShelf` にする。拡張機能の中の GitHub のリンク (`src/shared/links.ts`) と README の URL は、書き換えなくてよい。

## 公開用に入るもの / 入らないもの
入る: `src/`、`static/`、`scripts/`、`test/` (`install-docs.test.ts` を除く)、`.github/`、`README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md`、`build.mjs`、`package*.json`、`tsconfig.json`、`vitest.config.ts`、`docs/INSTALL.md`、`docs/INSTALL.en.md`、`docs/FAQ.md`、アイコン (`static/brand/`、`docs/brand/icon-512.png`、`docs/brand/icon.svg`)。

入らない: `docs/screenshots/`、`docs/mockups/`、`docs/brand/preview.png`、`CLAUDE.md`、`docs/PLAN.md`、`docs/TASK_V*.md`、`docs/MANUAL_TEST.md`、`docs/PUBLISH.md`、`docs/DATA_MODEL.md`、`docs/I18N.md`、`docs/PUBLIC_REPO.md`、`tools/`、`reports/`、`research_notes/`。

許可リストは `tools/export_public.py` の `ALLOW_DIRS` / `ALLOW_FILES` / `EXCLUDE`。書き出したあと、画像と Markdown が許可リストの外に混ざっていないかを、スクリプトが確かめる (見つかったら失敗する)。

## 初回の公開の手順 (GitHub で行うので、ユーザーが確認しながら進める)
1. 書き出す: `py -3 tools/export_public.py C:\work\postshelf-public` (空のフォルダ)。
2. 中身を目で確かめる (画像と開発用の文書がないこと)。`npm ci && npm run typecheck && npm test && npm run build && npm run release:check` が通ること (公開用のフォルダで)。
3. 開発用リポジトリを改名する: GitHub の `tabunugoku/PostShelf` → Settings → Repository name → `PostShelf-dev` (非公開のまま)。
   - 改名後に、クラウドセッションが `PostShelf-dev` で動くか確かめる (動かなければ、クラウド側の接続し直し)。
   - 手元の remote を更新する: `git remote set-url origin https://github.com/tabunugoku/PostShelf-dev.git`
4. 新しい**公開**リポジトリ `tabunugoku/PostShelf` を、空で作る (README や LICENSE は足さない)。
5. 書き出したフォルダで、`git init -b main`、`git add -A`、`git commit`、`git remote add origin ...`、`git push -u origin main`。
6. リリース: 公開用で `git tag v1.1.0 && git push origin v1.1.0` (リリースのワークフローが zip を作る)。開発用の `v1.1.0` の Release は、そのまま残してよい。
7. GitHub Pages を設定する (別の指示。画像を使わない作りにする)。

## 更新するときの手順
1. 開発用リポジトリで、これまでどおり開発・マージ・版上げをする。
2. 空のフォルダへ書き出し、公開用のリポジトリに、差分をコミットする (公開用の履歴は、更新ごとの 1 コミットになる)。
3. 公開用で、タグを打ち、Release を作る。

## 公開用に出ない情報の確認 (毎回)
- 書き出し後に、`rg -l "@tabunugoku_dev|CollectUI|ftcarpe|showheyohtaki"` で、実在のアカウント名が残っていないか見る (コードや文書には、本来ない)。
- コードのコメントに、公開しない文書の名前 (CLAUDE.md、docs/MANUAL_TEST.md、docs/mockups/…) が出てくる。名前だけで、中身は漏れないが、気になるときは、コメントを直す。
