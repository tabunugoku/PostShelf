# 追加タスク (v3): X 連動モード / 言語追加 / CI

前提: v2 (外観 + 日英 i18n) は `claude/serene-johnson-j5tpe7` で実装済み。続きで作業する (最初に `origin/main` をマージ)。

## 現状の整理 (変更しない前提)
- PostShelf のフォルダ保存は X 本来のブックマークとは独立。同期なし
- `/i/bookmarks` の取り込みは、ユーザーがボタンを押したとき、画面に表示中のポストだけを読む。自動スクロールや非公開 API は使わない (この方針は維持)
- 設定画面は未実装 (popup の「設定」は manager を開くだけ)

## A. 連動モード (設定でオン/オフ、既定オフ)
目的: フォルダに保存したとき、X 本来のブックマークも同時に付ける / 外す。

1. 設定ストア: `src/shared/settings.ts` (`chrome.storage.local` の別キー)。`syncNative: boolean` (既定 false)
2. 設定画面: manager 内に「設定」ビュー (popup の「設定」からここへ遷移)。項目は連動モードのスイッチと説明文 (ja/en)
3. 動作 (`src/content/popover.ts` と `src/shared/selectors.ts`)
   - 連動オン、かつポストが未ブックマーク (`bookmarkButtonSelector` が `bookmark`) でフォルダを 1 つ以上チェックした → ネイティブのブックマークボタンを 1 回 click する
   - 連動オン、かつ全フォルダのチェックを外した (PostShelf 側のブックマークが消える) → ネイティブが `removeBookmark` ならそのボタンを 1 回 click して解除する
   - 連動オフ → 今までどおり X には触らない
   - クリック前に必ずボタンの現在状態 (`bookmark` / `removeBookmark`) を読み、すでに目的の状態なら何もしない (二重トグル防止)
   - ボタンが見つからない場合は何もせず、エラーを出さない (X の DOM 変更に備える)
4. ネイティブ側の操作は 1 ポストにつきユーザーの 1 操作から 1 回だけ。ループ、一括実行、タイマー実行は禁止
5. `docs/MANUAL_TEST.md` に連動オン/オフの実機確認項目を追加 (X 側のブックマークが付く/外れる、オフでは付かない)
6. fixture テスト: jsdom 上で、状態ごとにクリックされる/されないことを検証

## B. 言語追加 (第 1 弾)
`static/_locales/<lang>/messages.json` を追加する。コード変更は原則不要。

| 言語 | ディレクトリ |
|---|---|
| 中国語 (簡体字) | `zh_CN` |
| 中国語 (繁体字) | `zh_TW` |
| 韓国語 | `ko` |
| スペイン語 | `es` |
| ポルトガル語 (ブラジル) | `pt_BR` |
| フランス語 | `fr` |

1. キー集合は `en` と完全一致 (既存のキー一致テストを全言語に拡張)
2. プレースホルダ (`$1` など) と複数形・語順を壊さない
3. 日付表示は `Intl.DateTimeFormat(chrome.i18n.getUILanguage())` のまま
4. 文字数が増える言語 (es, fr, pt_BR) でボタン・ポップオーバーが崩れないよう、必要なら CSS を調整 (固定幅を避ける)
5. 翻訳は AI 訳。`docs/I18N.md` に「ネイティブ校正が必要」「言語追加の手順」を書く
6. 第 2 弾 (de, ru) と右から左の言語 (ar, he) は対象外。`docs/I18N.md` に今後の課題として記載

## C. GitHub Actions
`.github/workflows/ci.yml`:
1. `push` と `pull_request` で起動
2. Node LTS、`npm ci`、`npm run typecheck`、`npm test`、`npm run build`
3. `dist/` を zip にして `actions/upload-artifact` で `postshelf-dist` として保存 (Node.js なしで `chrome://extensions` に読み込めるようにする)
4. README に「CI の成果物から zip を取得して読み込む」手順を追記 (日本語)

## 完了条件
- `npm run typecheck`, `npm test`, `npm run build` がすべて通る
- A / B / C を別コミットにする
- 最終報告: 変更点、実機確認が必要な項目、`MANUAL_TEST.md` に足した項目
