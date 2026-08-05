#!/bin/bash
# launchd / cron 用ラッパー: ハーネス観測メタデータを増分送信する
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# .env から MCP_TOKEN / APPLIED_LOOP_URL を読む (存在すれば)
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export APPLIED_LOOP_URL="${APPLIED_LOOP_URL:-http://localhost:3100}"

LOG="$ROOT/scripts/harness-collect.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "---- $(date '+%Y-%m-%dT%H:%M:%S%z') ----"
  /usr/bin/env node "$ROOT/scripts/collect-harness.mjs"
} >>"$LOG" 2>&1
