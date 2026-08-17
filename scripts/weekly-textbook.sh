#!/bin/bash
# launchd 用ラッパー: 週のしょ（WeeklyTextbook）を生成する（月曜09:00、ADR-0020）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# launchd はログインシェルの PATH (nvm/homebrew 等) を継承しないため明示する
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# `server-only` パッケージ利用モジュールを tsx 直接実行から解決可能にするため
export NODE_OPTIONS="--conditions=react-server"

LOG="$ROOT/scripts/weekly-textbook.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "---- $(date '+%Y-%m-%dT%H:%M:%S%z') ----"
  npx tsx "$ROOT/scripts/generate-weekly-textbook.ts"
} >>"$LOG" 2>&1
