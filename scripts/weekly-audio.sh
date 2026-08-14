#!/usr/bin/env bash
# 最新の週次ナレーション原稿を VOICEVOX 互換エンジン (release-video tts.mjs) で
# 音声化し、OBSIDIAN_DIGEST_DIR/weekly/ に wav / mp3 を配置する (ADR-0014 §1)。
# デフォルトは AivisSpeech Engine (VOICEVOX 互換 API、まお・おちつき)。
# 声質検証 (2026-08-14): pitchScale をデフォルト以外に変えるとノイズが乗る
# ("まお"ノーマルで -0.03/-0.08 とも再現)。声を落ち着かせたい場合は pitchScale
# を弄らず、スタイル自体を切り替える (おちつき=888753763) のが安全。
#
# 使い方:
#   ./scripts/weekly-audio.sh
#   OBSIDIAN_DIGEST_DIR=~/Knowledge/... ./scripts/weekly-audio.sh
#   VOICEVOX_SPEAKER=29 VOICEVOX_URL=http://127.0.0.1:50021 ./scripts/weekly-audio.sh
#
# 依存: node, curl。mp3 化には ffmpeg (任意)。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOICEVOX_URL="${VOICEVOX_URL:-http://127.0.0.1:10101}"
VOICEVOX_SPEAKER="${VOICEVOX_SPEAKER:-888753763}"
SPEED_SCALE="${VOICEVOX_SPEED_SCALE:-0.9}"
INTONATION_SCALE="${VOICEVOX_INTONATION_SCALE:-0.8}"

# tts.mjs の所在 (workbench の release-video パイプライン。改修しない)
TTS_BIN="${TTS_BIN:-$HOME/tools/workbench/release-video/pipeline/bin/tts.mjs}"
PIPELINE_DIR="$(cd "$(dirname "$TTS_BIN")" && pwd)/.."

resolve_digest_dir() {
  local env="${OBSIDIAN_DIGEST_DIR:-}"
  if [[ -n "$env" ]]; then
    if [[ "$env" == ~/* ]]; then
      echo "${HOME}/${env#~/}"
    else
      echo "$env"
    fi
  else
    echo "$ROOT/docs/digest"
  fi
}

DIGEST_DIR="$(resolve_digest_dir)"
WEEKLY_DIR="$DIGEST_DIR/weekly"

if [[ ! -f "$TTS_BIN" ]]; then
  echo "エラー: tts.mjs が見つかりません: $TTS_BIN" >&2
  echo "  TTS_BIN でパスを指定するか、~/tools/workbench/release-video を配置してください。" >&2
  exit 1
fi

# VOICEVOX 互換エンジン起動確認 (tts.mjs の assertVoicevox と同趣旨の分かりやすいメッセージ)
if ! curl -sf --max-time 3 "${VOICEVOX_URL}/version" >/dev/null; then
  echo "エラー: 音声合成エンジン (${VOICEVOX_URL}) に接続できません。" >&2
  echo "起動例 (AivisSpeech、デフォルト):" >&2
  echo "  open -a AivisSpeech" >&2
  echo "起動例 (本家 VOICEVOX):" >&2
  echo "  docker run --rm -d --name voicevox -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-latest" >&2
  echo "接続先を変える場合は VOICEVOX_URL を設定してください。" >&2
  exit 1
fi

if [[ ! -d "$WEEKLY_DIR" ]]; then
  echo "エラー: 週次原稿ディレクトリがありません: $WEEKLY_DIR" >&2
  echo "先に月曜 briefing で generateWeeklyNarration を実行してください。" >&2
  exit 1
fi

# 最新の *-narration.md を選ぶ
NARRATION="$(ls -1t "$WEEKLY_DIR"/*-narration.md 2>/dev/null | head -n 1 || true)"
if [[ -z "$NARRATION" ]]; then
  echo "エラー: ${WEEKLY_DIR} に *-narration.md がありません。" >&2
  exit 1
fi

BASENAME="$(basename "$NARRATION" .md)" # e.g. 2026-W31-narration
WEEK_KEY="${BASENAME%-narration}"
SAFE_BRANCH="applied-loop-${WEEK_KEY//+/-}" # branch は [a-z0-9-] 想定だが W は許容されるか確認
# manifest.mjs の ID_RE は feature id 用。branch は非空 string のみ。
SAFE_BRANCH="$(echo "$WEEK_KEY" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
FEATURE_ID="weekly-${SAFE_BRANCH}"

echo "原稿: $NARRATION"
echo "エンジン: $VOICEVOX_URL (speaker=${VOICEVOX_SPEAKER}, intonationScale=${INTONATION_SCALE})"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/applied-loop-weekly-audio.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

MANIFEST="$TMP_DIR/manifest.json"

# ナレーション本文から「ルミナ:」（旧「さやか:」）段落を抽出し、manifest の title シーンにする
python3 - "$NARRATION" "$MANIFEST" "$SAFE_BRANCH" "$FEATURE_ID" "$VOICEVOX_SPEAKER" "$SPEED_SCALE" "$INTONATION_SCALE" <<'PY'
import json, re, sys
from pathlib import Path

narration_path, manifest_path, branch, feature_id, speaker, speed, intonation = sys.argv[1:8]
text = Path(narration_path).read_text(encoding="utf-8")
# 見出し・引用を除き、話者プレフィックス段落または空行区切りの本文を取る
body_lines = []
for line in text.splitlines():
    s = line.strip()
    if not s or s.startswith("#") or s.startswith(">"):
        if body_lines and body_lines[-1] != "":
            body_lines.append("")
        continue
    body_lines.append(s)
# 段落結合
paras = []
buf = []
for line in body_lines:
    if line == "":
        if buf:
            paras.append(" ".join(buf))
            buf = []
        continue
    # 話者プレフィックスは TTS では読まない（ルミナ／旧さやか）
    line = re.sub(r"^(?:ルミナ|さやか)\s*[:：]\s*", "", line)
    buf.append(line)
if buf:
    paras.append(" ".join(buf))
paras = [p.strip() for p in paras if p.strip()]
if not paras:
    print("エラー: ナレーション本文を抽出できませんでした。", file=sys.stderr)
    sys.exit(1)

scenes = []
for i, p in enumerate(paras):
    scenes.append({
        "type": "title",
        "narration": p,
        "caption": f"段落{i+1}",
    })

manifest = {
    "branch": f"applied-loop-{branch}",
    "voice": {
        "speaker": int(speaker),
        "speedScale": float(speed),
        "intonationScale": float(intonation),
    },
    "subtitles": False,
    "features": [{
        "id": feature_id if re.match(r"^[a-z0-9][a-z0-9-]*$", feature_id) else "weekly-digest",
        "title": f"週次ダイジェスト {branch}",
        "scenes": scenes,
    }],
}
Path(manifest_path).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"段落数: {len(scenes)}")
PY

export VOICEVOX_URL
(
  cd "$PIPELINE_DIR"
  node bin/tts.mjs --manifest "$MANIFEST"
)

# tts 出力: workbench/.claude/release-video/out/<branch>/audio/<feature>/...
OUT_ROOT="$HOME/tools/workbench/.claude/release-video/out/applied-loop-${SAFE_BRANCH}"
# paths.mjs の REPO_ROOT は pipeline/../.. = workbench
AUDIO_DIR="$OUT_ROOT/audio/${FEATURE_ID}"
if [[ ! -d "$AUDIO_DIR" ]]; then
  # feature id が正規化された場合のフォールバック
  AUDIO_DIR="$(find "$OUT_ROOT/audio" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1 || true)"
fi
if [[ -z "${AUDIO_DIR:-}" || ! -d "$AUDIO_DIR" ]]; then
  echo "エラー: TTS 出力ディレクトリが見つかりません (想定: $OUT_ROOT/audio/...)" >&2
  exit 1
fi

mkdir -p "$WEEKLY_DIR"
WAV_OUT="$WEEKLY_DIR/${WEEK_KEY}.wav"
MP3_OUT="$WEEKLY_DIR/${WEEK_KEY}.mp3"

# セグメント wav を結合 (空 glob でも set -e で落ちないようにする)
SEGMENTS=()
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  SEGMENTS+=("$f")
done < <(find "$AUDIO_DIR" -maxdepth 1 -name 's*-seg*.wav' -print 2>/dev/null | sort || true)
if [[ ${#SEGMENTS[@]} -eq 0 ]]; then
  echo "エラー: wav セグメントがありません: $AUDIO_DIR" >&2
  exit 1
fi

if [[ ${#SEGMENTS[@]} -eq 1 ]]; then
  cp "${SEGMENTS[0]}" "$WAV_OUT"
else
  CONCAT_LIST="$TMP_DIR/concat.txt"
  : >"$CONCAT_LIST"
  for f in "${SEGMENTS[@]}"; do
    # ffmpeg concat demuxer
    printf "file '%s'\n" "$f" >>"$CONCAT_LIST"
  done
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" -c copy "$WAV_OUT" >/dev/null 2>&1
  else
    # ffmpeg 無し: 先頭セグメントのみコピーし警告
    cp "${SEGMENTS[0]}" "$WAV_OUT"
    echo "警告: ffmpeg が無いため最初のセグメントのみ ${WAV_OUT} に配置しました。" >&2
  fi
fi

echo "WAV: $WAV_OUT"

if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -i "$WAV_OUT" -codec:a libmp3lame -qscale:a 4 "$MP3_OUT" >/dev/null 2>&1
  echo "MP3: $MP3_OUT"
else
  echo "情報: ffmpeg が無いため mp3 はスキップしました (wav のみ)。"
fi

echo "完了: ${WEEK_KEY} の音声を ${WEEKLY_DIR} に配置しました。"
