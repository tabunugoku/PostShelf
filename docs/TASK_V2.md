# 追加タスク (v2): 外観を mockup に寄せる + 日英対応

前提: M1〜M5 は `claude/serene-johnson-j5tpe7` で実装済み。このブランチの続きで作業する (main を先にマージ)。

## A. 外観を mockup に寄せる
基準: `docs/mockups/manager.html`, `docs/mockups/chrome-overview.html` (ブラウザで開ける静的 HTML。CSS 変数は `shared.css`)。

1. 現在の `static/manager.css` は簡素すぎる。mockup のレイアウト・余白・配色・角丸・hover/選択状態に合わせる
   - manager: 左サイドバー 200px (フォルダ行: アイコン + 名前 + 件数)、右にヘッダー (フォルダアイコン、名前、編集ボタン、ポスト/リスト切替のセグメント)、ポスト表示は X 風カード (アバター + @handle + 本文 + 操作列 + 所属フォルダ表示)、リスト表示は 1 行 (フォルダアイコン / handle / 本文 1 行 / 外部リンク)
   - 編集パネル: 名前入力、アイコン 8 種のグリッド (選択中は枠)、色スウォッチ 8 色。アイコンが `ti-folder` 以外のとき色行を薄くして操作不可
   - x.com のポップオーバー (`src/content/popover.ts`): フォルダ行 = アイコン(色つき) + 名前 + チェックボックス、末尾に「新しいフォルダ」行。角丸 12px、`border .5px`、影
   - popup: PostShelf ロゴ行、件数 · フォルダ数、「最近保存した 3 件」「管理画面を開く」「設定」
2. ライト/ダーク両対応 (`prefers-color-scheme`)。mockup の `shared.css` の変数体系を踏襲
3. x.com 上の注入 UI は X のテーマ (ライト/ダーク/ダーク青) に合わせて読める配色にする (背景色は X の body の computed style から判定)
4. 仕上がり確認: dist を静的に開いた manager.html を、可能なら headless ブラウザ (playwright 等が使えれば) でスクリーンショットし、mockup と見比べて `docs/screenshots/` に保存。使えない場合は省略してよいが、その旨を最終報告に書く

## B. 日英対応 (i18n)
1. Chrome 標準の `chrome.i18n` を使う。`static/_locales/en/messages.json` と `static/_locales/ja/messages.json`
2. manifest: `"default_locale": "en"`, `name`/`description`/`action.default_title` は `__MSG_...__`
3. `src/shared/strings.ts` を `t(key)` ラッパーにする (内部で `chrome.i18n.getMessage`)。テストでは `test/chrome-mock.ts` に `getMessage` を追加し、ja の辞書を読んで返す。ja/en のキー集合が一致することを検証するテストを追加
4. 組み込みフォルダ「すべて / All」「未分類 / Unsorted」は名前を保存せず、表示時に `t()` で解決する (言語を切り替えても追従する)。ユーザーが作ったフォルダ名は変換しない
5. 新規フォルダの既定名 (「新しいフォルダ」/ "New folder") は作成時の言語で保存してよい
6. 日付表示は `Intl.DateTimeFormat(chrome.i18n.getUILanguage())`
7. JSON エクスポート/インポートのフォーマットは言語に依存させない
8. X の表示言語に依存しないこと (セレクタは `data-testid` のまま) を維持
9. `docs/MANUAL_TEST.md` に「Chrome の表示言語を英語/日本語に切り替えて確認」の項目を追加

## 完了条件
- `npm run typecheck`, `npm test`, `npm run build` がすべて通る
- 変更ごとにコミット (A と B を別コミット)
- 最終報告: 変更点、スクショの有無、実機確認が必要な項目
