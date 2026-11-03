---
name: codex-workflow
description: PostShelf の作業を Codex に渡すときの手順 (worktree の作成、codex exec の起動と設定、コミット計画の適用、adversarial-review、後片付け、Windows の注意)。Codex で実装を進めるときに読む。
---

# Codex に作業を渡す手順

役割の分担・料金・コミットと push・並行の決まりは CLAUDE.md の「Codex との分担」にある。ここは Opus が進めるときの手順だけを書く。

- **流れ** (作業 5 で確かめた形):
  1. 要件の確認 (`docs/PLAN.md`、必要ならモックアップ)
  2. `git worktree add ../PostShelf-wt/<名前> -b codex/<名前> origin/main` で作業のフォルダを作り、そこで `npm ci`
  3. `/codex-prompt` でプロンプトを書く。項目ごとに触ってよいファイルを決め、項目の間でファイルを重ねない。各項目に「受け入れ条件 (テストで確かめる)」と「競合・境界の観点」を書き、最後の応答をコミット計画の JSON にさせる
  4. `.claude/codex/run-codex-exec.sh <worktree> <プロンプト> <出力フォルダ>` を、Bash の `run_in_background` で起動する。終わると通知が 1 回届くので、待つ間に状態を見に行かない (ポーリングしない)
  5. 出力フォルダの `last.json` (コミット計画・チェックの結果・notes・manual_test) と差分を読み、ローカルで typecheck・test・build を通す
  6. `node .claude/codex/apply-commit-plan.mjs <worktree> <出力フォルダ>/last.json` で、項目ごとにコミットする (先に `--dry-run` で確かめる)。複数の項目が触ったファイルや、計画に無い変更があれば止まるので、そのときは手で分ける。push して PR を作る
  7. `/codex:adversarial-review` で見る。フォーカスの文に「指摘ごとに、マージを止めるものか後回しでよいものかを書く」「遅れても最後に正しくなるもの、origin/main と同じふるまいのもの、ごくまれな推測だけのものは指摘しない」を入れる。このレビューは読み取り専用のサンドボックスで動き、テストを実行できないので、テストはローカルと CI で確かめる
  8. マージを止める指摘だけを直す (やり取りは 2 往復まで)。後回しの指摘は `docs/MANUAL_TEST.md` か、次の作業の候補に回す。採るかどうかの最後の判断は Opus が行う
  9. main へのマージ (ユーザーが指示したときだけ) → worktree とブランチを消す → リリース
- **codex exec の設定** (`run-codex-exec.sh`): `--ignore-user-config` で `~/.codex/config.toml` を読まず、モデル・推論の強さ・`project_doc_fallback_filenames`・サンドボックスを `-c` で渡す (ログインはそのまま使う)。サンドボックスは `workspace-write` と `windows.sandbox=mxc`。MXC では esbuild と vitest が動き、外部への通信と worktree の外への書き込みは止められる。以前の `elevated` では esbuild が親フォルダを読めず、build が通らなかった。最後の応答は `--output-schema` (`commit-plan.schema.json`) の形にそろえる
- **後片付け**: `run-codex-exec.sh` は、終わったあとに worktree を参照するプロセスの数 (`leftover=`) を出す。0 でなければ、その worktree を参照するプロセスだけを止める。adversarial-review のあとは、プラグインが worktree ごとに残す常駐のプロセスを、プラグインの `session-lifecycle-hook.mjs SessionEnd` に `{"cwd":"<worktree>"}` を渡して止める (`CLAUDE_PLUGIN_DATA` にプラグインのデータのフォルダを指定する)。これをしないと worktree を消せない
- **Windows の注意**: Git Bash から `cmd.exe /d /c` などを渡すと、MSYS が `/d` をパスに変える。`codex sandbox` で試すときは PowerShell から呼ぶ。`codex-companion.mjs task --background` で渡す方法は、プロセスが残りやすく `/codex:cancel` も効かないことがあるので使わない
