#!/usr/bin/env bash
# 週次ナレーション音声化の完全自動版。AivisSpeech Engine を必要なら headless
# 起動し、weekly-audio.sh を実行して、自分で起動した分のエンジンだけ後片付けする。
# launchd (com.applied-loop.weekly-audio.plist) から呼ばれる想定。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_BIN="${AIVISSPEECH_ENGINE_BIN:-/Applications/AivisSpeech.app/Contents/Resources/AivisSpeech-Engine/run}"
ENGINE_PORT="${AIVISSPEECH_ENGINE_PORT:-10101}"
ENGINE_URL="http://127.0.0.1:${ENGINE_PORT}"

# launchd はログインシェルの PATH (nvm/homebrew 等) を継承しないため明示する
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ ! -x "$ENGINE_BIN" ]]; then
  echo "エラー: AivisSpeech Engine が見つかりません: $ENGINE_BIN" >&2
  echo "  AIVISSPEECH_ENGINE_BIN でパスを指定するか、AivisSpeech.app をインストールしてください。" >&2
  exit 1
fi

STARTED_HERE=0
ENGINE_PID=""

cleanup() {
  if [[ "$STARTED_HERE" -eq 1 && -n "$ENGINE_PID" ]]; then
    kill "$ENGINE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if ! curl -sf --max-time 3 "${ENGINE_URL}/version" >/dev/null 2>&1; then
  echo "AivisSpeech Engine (headless) を起動します: $ENGINE_BIN --port $ENGINE_PORT"
  "$ENGINE_BIN" --host 127.0.0.1 --port "$ENGINE_PORT" >"$ROOT/scripts/weekly-audio-engine.log" 2>&1 &
  ENGINE_PID=$!
  STARTED_HERE=1

  READY=0
  for _ in $(seq 1 60); do
    if curl -sf --max-time 2 "${ENGINE_URL}/version" >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 2
  done
  if [[ "$READY" -ne 1 ]]; then
    echo "エラー: AivisSpeech Engine が時間内 (2分) に起動しませんでした" >&2
    echo "  ログ: $ROOT/scripts/weekly-audio-engine.log" >&2
    exit 1
  fi
else
  echo "既存の AivisSpeech Engine ($ENGINE_URL) を使用します"
fi

VOICEVOX_URL="$ENGINE_URL" "$ROOT/scripts/weekly-audio.sh"
