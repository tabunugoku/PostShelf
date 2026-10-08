# TASK v27: 自動取り込み中の「いま ○○ ごろの投稿です」を、直近の中央値にする

v26 が終わったあとに実施する。表示のしかたと、保存の項目を 1 つ足すだけ。新しい文言・権限は足さない。

## 決まっている方針 (ユーザーの判断)
| # | 項目 | 決定 |
|---|---|---|
| 1 | 実行中の「いま ○○ ごろの投稿です」 | 直近に読んだ 10 件の投稿日時の中央値。読むたびに更新 |
| 2 | 取り込み終了後・一時停止中の「いちばん古い投稿」(`acOldest`) | 今までどおり、最古のまま |

## 原因
- `src/content/autocollect.ts` の `readVisible()` が、`oldestSeenPostDate` を「読んだ中でいちばん古い日時」として更新し続ける。最小値なので戻らない。
- 古いポストをリポストされて、それをブックマークしていると、実行中の表示が、その古い日付のまま残る。ブックマーク一覧はブックマークした順なので、現在位置の目安として合わない。

## 直し方
1. `src/shared/settings.ts` の `CollectRunState` (371 行付近) に、`recentPostDate?: string` を足す (中央値の ISO)。`oldestSeenPostDate` は残す。サニタイズ (395 行付近) にも同じ形で足す。保存データの形は、この 1 項目の追加のみ。古い保存には無いので、無いときは未設定として扱う。
2. `src/content/autocollect.ts`:
   - `AutoCollector` に、直近の日時を持つ配列 (最大 10 件、先頭から捨てる。保存しない) を足す。
   - `readVisible()` で、`posted` があるポストを読むたびに配列へ入れ、中央値を `s.recentPostDate` に書く。偶数件のときは、小さい方から数えて真ん中の 2 件のうち、古い方 (小さい ISO) を使う。
   - `oldestSeenPostDate` の更新は、今までどおり残す。
   - `begin()` で `fresh` のとき (224 行付近) は、`recentPostDate` も未設定に戻し、配列を空にする。
   - 再読み込みの引き継ぎ (`adopt`) では、配列は空から始める。新しく読むまでは、保存されていた `recentPostDate` をそのまま出す。
3. `src/content/autocollectPanel.ts`:
   - 89 行付近 (実行中) は、`recentPostDate` を使う。無いときは今までの `acSubRunning`。
   - 162 行付近 (`acOldest`) は、変えない。
4. `docs/DATA_MODEL.md` の `collectRun` の項目に `recentPostDate?` を足す。

## 守ること
- 保存データの形は、`collectRun` に任意の項目を 1 つ足す以外、変えない。必須の権限は増やさない。外部通信もしない。
- 新しい文言は足さない (`acSubRunningDate` をそのまま使う)。
- CLAUDE.md の自動スクロールのルールを、広げない。

## テスト
- 古い日付のポスト 1 件が混ざっても、続く新しめのポストを読むと、`recentPostDate` が戻る。`oldestSeenPostDate` は古い方のまま。
- 10 件を超えたら、古く入れた分が捨てられ、中央値が追いつく。
- 偶数件 (2 件、10 件) の中央値が、決めたとおりになる。
- `fresh` で始め直すと、`recentPostDate` と配列がリセットされる。
- `adopt` の直後は、保存されていた `recentPostDate` が残り、新しく読むと更新される。
- パネル: 実行中は `recentPostDate` を表示し、終了後・一時停止中は `oldestSeenPostDate` を表示する (`test/autocollect-ui.test.tsx`)。
- 既存の `oldestSeenPostDate` のテスト (`test/autocollect.test.ts` 243 行付近) は、通ったまま。

## コミットの分け方
1. v27-A: `recentPostDate` の追加 (settings・autocollect・パネル)
2. v27-B: テスト、`docs/DATA_MODEL.md`、`docs/MANUAL_TEST.md` の v27 の節

## 実機で確認する項目 (`docs/MANUAL_TEST.md` に v27 の節を足す)
- 古いポストのリポストをブックマークした状態で自動取り込みを始める。実行中の日付が、そのポストを過ぎたあとに戻る。
- 終了後の「いちばん古い投稿」は、最古の日付を示す。

## 完了の条件
`npm run typecheck`、`npm test`、`npm run build`、`npm run release:check` がすべて通ること。必須の権限を増やさないこと。
