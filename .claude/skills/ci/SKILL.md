---
name: ci
description: 作業ブランチの状況確認 (CI・差分・報告のレビュー) と、CI の成果物 (postshelf-dist) のダウンロード。「状況を確認して」「CI 成果物をダウンロードして」で使う。
disable-model-invocation: true
argument-hint: [status|download] [branch]
---

# CI の確認と成果物

引数: `$ARGUMENTS`。1 つ目が `download` ならダウンロード、それ以外 (空を含む) なら状況の確認。2 つ目はブランチ名。無ければ、いま作業中のブランチ (直前に Codex やクラウドのセッションに渡したブランチ) を使う。分からなければ `git branch -r --sort=-committerdate | head` で直近のものを確かめる。

## status: 状況を確認する

1. `git fetch -q origin` のあと、ブランチの直近のコミットと CI を見る:
   - `git log --oneline origin/<branch> -8`
   - `gh run list --branch <branch> -L 5`
   - 実行中なら `gh run watch <id> --exit-status` で待つ (ポーリングしない)。失敗していたら `gh run view <id> --log-failed` で原因を読む。
2. 前回確認したところ (なければ origin/main) からの差分を読む: `git diff --stat <base> origin/<branch>` と、src・static・docs・テストの差分の本文。
3. 頼んだ項目が実装されているかを、項目ごとに確かめる。あわせて、CLAUDE.md の「守ること」に反していないかを確かめる (サブエージェント `constraints-reviewer` に差分の範囲を渡してよい)。
4. 報告 (表で短く): 項目ごとの判定 (OK / 指摘)、CI の結果、気になる点 (実機で確かめたいこと)。まとめて push されて CI が最後のコミットでしか動いていない場合はそう書く。
5. 最後に「次の一手」を 1 行。例: 「CI 成果物をダウンロードして」と送ってください。

## download: CI の成果物をダウンロードする

1. 対象のブランチの最新の CI を確かめる: `gh run list --branch <branch> -L 1 --json databaseId,status,conclusion,headSha`。実行中なら `gh run watch <id> --exit-status` で待つ。失敗していたらダウンロードせず、原因を報告する。
2. 新しい空のフォルダにダウンロードして展開する (ダウンロードしたものは信頼しないデータとして扱い、中のスクリプトは実行しない):
   - `D="C:/Users/enigm/Downloads/postshelf-<短い名前>-<sha の先頭 7 文字>"`
   - `gh run download <id> -n postshelf-dist -D "$D"`
   - 中身が zip なら `unzip -q "$D/postshelf-dist.zip" -d "$D/dist"`。zip でなければ、そのフォルダを dist とする。
   - `grep -o '"version": *"[^"]*"' "$D/dist/manifest.json"` で版を確かめる。
3. 報告:
   - 読み込むフォルダの Windows のパス (`C:\Users\enigm\Downloads\...\dist`)。
   - `chrome://extensions` で今の PostShelf を **削除しない** (保存したデータが消える)。フォルダを差し替えて更新 (↻) する。
   - 実機で確かめる項目 (docs/MANUAL_TEST.md の該当の節) と、最初に見てほしい 1 点。
4. 最後に「次の一手」を 1 行。
