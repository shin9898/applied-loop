#!/bin/bash
# launchd 用ラッパー: Applied Loop の dev サーバーを常駐化する (Web :3100 / terminal WS :3101)。
# Claude Desktop 等の「手元」MCPクライアントは常に http://localhost:3100/api/mcp へ
# 接続する設計のため、サーバーが落ちていると answer_gate 等のツール呼び出しが
# 丸ごと失敗する（2026-08-17、Fable UXレビューを踏まえた常駐化）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# launchd はログインシェルの PATH (nvm/homebrew 等) を継承しないため明示する
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

exec npm run dev:all
