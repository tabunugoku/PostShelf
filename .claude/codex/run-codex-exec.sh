#!/usr/bin/env bash
# 使い方: .claude/codex/run-codex-exec.sh <worktree> <prompt.md> <出力フォルダ> [effort]
# Claude Code の Bash の run_in_background で起動する。終わると通知が 1 回届く。
set -u
W="$1"; P="$2"; OUT="$3"; EFFORT="${4:-high}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
start=$(date +%s)
# 設定は -c で明示する (--ignore-user-config で ~/.codex/config.toml を読まず、ブラウザ操作の MCP なども立てない。ログインはそのまま使う)
codex exec --ignore-user-config \
  -m gpt-6.1-sol -c model_reasoning_effort="$EFFORT" \
  -c 'project_doc_fallback_filenames=["CLAUDE.md"]' \
  -c windows.sandbox=mxc \
  -s workspace-write -C "$W" \
  --output-schema "$HERE/commit-plan.schema.json" \
  -o "$OUT/last.json" --json \
  - < "$P" > "$OUT/events.jsonl" 2> "$OUT/stderr.log"
code=$?
echo "exit=$code sec=$(( $(date +%s) - start ))"
# worktree を参照して残ったプロセスの数 (0 であるはず)
powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { @('codex.exe','node.exe','esbuild.exe') -contains \$_.Name -and \$_.CommandLine -like '*$(basename "$W")*' }).Count" | tr -d '\r' | sed 's/^/leftover=/'
exit $code
