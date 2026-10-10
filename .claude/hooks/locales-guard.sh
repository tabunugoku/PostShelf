#!/usr/bin/env bash
# PreToolUse: static/_locales の文言を編集する前に、ユーザーの確認を求める。
# 文言は、ユーザーが 1 件ずつ選んだものだけ変える決まり (CLAUDE.md / 運用の決定)。
input=$(cat)
if printf '%s' "$input" | grep -Eq '"file_path"[[:space:]]*:[[:space:]]*"[^"]*_locales'; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"_locales の文言は、ユーザーが 1 件ずつ選んだものだけ変える決まりです。この変更が選ばれたものか確かめてください。"}}'
fi
exit 0
