#!/bin/bash
# launchd / cron 用ラッパー: ハーネス観測メタデータを増分送信する
set -euo pipefail

if [[ "$#" -ne 0 ]]; then
  echo "harness-collect.sh is reserved for unbounded scheduled collection" >&2
  echo "run collect-harness.mjs directly for snapshot/max-sends validation" >&2
  exit 64
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

readonly RENDERED_NODE_PATH="${APPLIED_LOOP_NODE_PATH:-}"
if [[ "$RENDERED_NODE_PATH" != /* || ! -x "$RENDERED_NODE_PATH" ]]; then
  echo "APPLIED_LOOP_NODE_PATH must be an executable absolute path; reinstall the collector" >&2
  exit 69
fi

# The collector itself reads only MCP_TOKEN and APPLIED_LOOP_URL from .env.
# Runtime ownership stays with the rendered LaunchAgent/wrapper: repository
# dotenv values cannot replace Node or turn a scheduled run into an unbounded mode.
export APPLIED_LOOP_NODE_PATH="$RENDERED_NODE_PATH"
export APPLIED_LOOP_COLLECT_RUN_MODE="scheduled"
export APPLIED_LOOP_COLLECT_RUN_BUDGET_MS="720000"

# exec preserves the collector exit code for launchd. Logs are owned by the
# rendered LaunchAgent under ~/.applied-loop/harness-collector/.
exec "$RENDERED_NODE_PATH" "$ROOT/scripts/collect-harness.mjs"
