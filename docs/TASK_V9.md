# 追加タスク (v9): ブックマーク一覧の URL 変更への対応

前提: v8 まで `claude/serene-johnson-j5tpe7` で実装済み (CI 成功)。続きで作業する (最初に `origin/main` をマージ)。

## 実機で確認できたこと (2026-10 時点、ユーザーの x.com)
- 左メニューの項目名が「ブックマーク」から「履歴」に変わっている
- 「履歴」を押すと、上部に「ブックマーク」と「いいね」の 2 タブがあるページに移る
  - ブックマーク: `https://x.com/i/history`
  - いいね: `https://x.com/i/history/likes`
- `https://x.com/i/bookmarks` を開くと `https://x.com/i/history` へリダイレクトされる
- 現在の拡張は `/i/bookmarks` だけを取り込み対象にしている (`src/content/collect.ts` の `isBookmarksPage`)。そのため取り込みボタンが出ない

## A. 取り込み対象のページ判定
1. `isBookmarksPage` を次のとおりにする
   - `/i/history` は対象 (末尾スラッシュあり・なしの両方)
   - `/i/bookmarks` も対象のまま残す (リダイレクトされない環境や旧仕様のため)
   - `/i/history/likes` は対象外 (いいねはブックマークではない。取り込まない)
2. X の画面は SPA なので、`/i/history` と `/i/history/likes` のタブ切替で、収集ボタンが正しく出し入れされること (`src/content/index.ts` の遷移検知を確認)
3. 判定する URL 文字列は `src/shared/selectors.ts` に集約する (ここだけ直せば追従できる構造を保つ)
4. fixture テスト
   - `/i/history` でボタンが出る / `/i/bookmarks` でも出る
   - `/i/history/likes` と `/home` では出ない
   - `/i/history` から `/i/history/likes` へ pushState で遷移するとボタンが消え、戻すと出る
   - 末尾スラッシュあり (`/i/history/`) でも出る

## B. 文言とドキュメントの修正
`/i/bookmarks` と書いている箇所をすべて `/i/history` (ブックマークタブ) に直す。
1. 全 8 言語の `_locales/*/messages.json` (取り込み手順 `importHowSteps` など。まず `git grep -n "bookmarks"` で洗い出す)
   - 手順は「左メニューの『履歴』を開き、『ブックマーク』タブを選ぶ」の形にする。X の表示名が変わる可能性があるため、URL (`x.com/i/history`) も併記する
2. `README.md`、`docs/FAQ.md`、`docs/MANUAL_TEST.md`、`docs/PUBLISH.md`
3. 既存テストの期待値 (`test/manager.test.tsx` の `/i/bookmarks` を含む表示の確認など) を新しい文言に合わせる
4. 日本語は v8 の方針 (全角括弧、「自分で」「スマホ」) に従う

## C. 自己診断への反映
- v7-D のヘルスチェックで、収集ボタンが出るはずのページ (`/i/history`) で「ポスト要素が 0 件」の場合は degraded として扱う。URL がまた変わった場合に気づけるように、診断情報へ「現在のパス (クエリなし)」を含める。ポストの本文・ユーザー名は含めない
- GitHub Issue テンプレートに「ブックマーク一覧の URL (アドレスバーのパス部分)」の欄を追加する

## 完了条件
- `npm run typecheck`, `npm test`, `npm run build` がすべて通る (CI も成功)
- A / B / C は 1 コミットでよい
- `docs/MANUAL_TEST.md` に追加: 「履歴 → ブックマーク」タブで収集ボタンが出ること、「いいね」タブでは出ないこと、`/i/bookmarks` を開いてもリダイレクト先で出ること
- 最終報告: 変更点と、実機確認が必要な項目
