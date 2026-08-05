#!/bin/sh
# Applied Loop post-commit hook (ADR-0006 §1)
# ~/.applied-loop/hooks/post-commit にインストールされ、各リポジトリの
# .git/hooks/post-commit から呼ばれる。失敗しても git 操作は妨げない。

# 認証情報は ~/.applied-loop/env から読む (setup-git-hook.sh が生成)
[ -f "$HOME/.applied-loop/env" ] && . "$HOME/.applied-loop/env"

APPLIED_LOOP_URL="${APPLIED_LOOP_URL:-http://localhost:3100}"
QUEUE="$HOME/.applied-loop/event-queue.jsonl"

build_payload() {
  sha=$(git rev-parse HEAD 2>/dev/null) || return 1
  repo_path=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  repo=$(basename "$repo_path")
  summary=$(git log -1 --pretty=%s 2>/dev/null | sed 's/"/\\"/g' | head -c 200)
  printf '{"kind":"commit","repo":"%s","repoPath":"%s","ref":"%s","summary":"%s"}' \
    "$repo" "$repo_path" "$sha" "$summary"
}

send() {
  curl -s --fail -o /dev/null -m 5 -X POST "$APPLIED_LOOP_URL/api/events" \
    -H "Authorization: Bearer ${MCP_TOKEN:-}" \
    -H "Content-Type: application/json" \
    -d "$1"
}

mkdir -p "$HOME/.applied-loop"

# オフライン等で溜まったキューを先に flush。送れなかった分はキューに戻す
if [ -f "$QUEUE" ]; then
  tmp="$QUEUE.sending.$$"
  mv "$QUEUE" "$tmp"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    send "$line" || echo "$line" >> "$QUEUE"
  done < "$tmp"
  rm -f "$tmp"
fi

payload=$(build_payload) || exit 0
send "$payload" || echo "$payload" >> "$QUEUE"
exit 0
