---
paths:
  - "docs/releases/**"
  - "package.json"
  - "package-lock.json"
  - "static/manifest.json"
  - "test/release.test.ts"
  - ".github/workflows/release.yml"
  - "scripts/release-check.mjs"
---

## リリース
バージョンは次の場所を同時に変える (manifest と package.json の食い違いは `npm run release:check` が、サイトの表示と zip の名前は `test/release.test.ts` が検出する): `package.json`、`package-lock.json` (2 か所)、`static/manifest.json`、`site/index.html` (バージョンの表示と zip の名前 2 か所)、`test/release.test.ts`、ルートの `CLAUDE.md` の「現在のタスク」。リリースノートは `docs/releases/vX.Y.Z.md`。README.md と同じく、英語を先に置き、日本語は末尾の `<details><summary>日本語 (Japanese)</summary>` に折りたたむ。原文は日本語で書き、英語はその訳にする (英語だけを書き換えない。直すときは日本語を直してから訳し直す)。節は、英語が `## Added`・`## Fixed`・`## Install / update`、日本語が `## 追加`・`## 修正`・`## インストール・更新`。画面の名前は、英語では `static/_locales/en` の文言、日本語では `ja` の文言に合わせる。main へマージしたあと、注釈つきタグ `vX.Y.Z` を打つと `.github/workflows/release.yml` が動く。
