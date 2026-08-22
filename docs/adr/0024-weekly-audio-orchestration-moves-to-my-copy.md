---
type: decision
status: accepted
date: 2026-08-22
tags: [audio, weekly-audio, multi-repo, repo-ownership]
source_refs: [docs/adr/0014-audio-meteofall.md, docs/adr/0023-release-video-canon-layered-split.md]
---

# ADR-0024: weekly-audio の起動オーケストレーションを my-copy へ移管する

## 背景

Applied Loop の他システムへの越境を棚卸しした結果(`~/tools/workbench` 側の
セッションで実施)、`scripts/weekly-audio.sh` が以下の形で他 repo へ越境
実行していると判明した:

- `TTS_BIN` で `~/tools/workbench/release-video/pipeline/bin/tts.mjs` を
  絶対パス起動(workbench は `triple-three-inc` org 外の個人リポジトリ)
- 出力先 `OUT_ROOT` が workbench の `.claude/release-video/out/` 配下に
  ハードコードされており、`find | head -n 1` フォールバックで
  **別ブランチの音声を silent に掴む** risk があった

ADR-0014 の時点では「音声化は release-video パイプライン側の責務」と
責務分離のみ決定しており、**起動元(オーケストレーション)がどちらの repo に
あるべきか**は論点になっていなかった。加えて調査で以下が判明した:

- `triple-three-inc/triple-release-video`(ADR-0023、org 横断の正典 pipeline
  repo)が既に存在し、`MY_COPY_RELEASE_VIDEO_REPO` 環境変数で参照する規約が
  `my-copy/skills/release-video/` に確立済み
- my-copy には決定論的パイプライン専用の宣言的 cron 型(`kind: python`、
  `~/.claude/scheduled-tasks/*/SKILL.md` の frontmatter が SSoT)が既にあり、
  週次 + vault 書き込みの前例(`weekly_review.py`)も存在する
- 実際の launchd 発火実績は 2026-08-14 設置後の 1 回のみ(2026-08-17、成功)。
  週ズレ(narration 生成時刻と月曜 10:00 固定 cron が噛み合わず直近週でなく
  2 週前の原稿を音声化)・冪等性なし(既存出力があっても再処理)という
  実害バグも同時に見つかった

## 決定

音声化の**起動オーケストレーション**を Applied Loop から my-copy へ移す。

- **削除**: `scripts/weekly-audio.sh`・`weekly-audio-auto.sh`・
  `com.applied-loop.weekly-audio.plist`
- **新設**: `~/tools/workbench/my-copy/scripts/weekly_audio.py`
  (bash からの逐語移植 + 複数週のキャッチアップ処理 + 冪等スキップを追加)。
  `~/.claude/scheduled-tasks/my-copy-weekly-audio/SKILL.md`
  (`kind: python`、月曜 10:00)で launchd 登録
- **TTS 参照は `MY_COPY_RELEASE_VIDEO_REPO` 経由に統一**し、
  `RELEASE_VIDEO_TARGET_REPO_ROOT` を都度使い捨てディレクトリへ明示指定する
  (workbench 汚染とブランチ取り違えの両方を解消)
- Applied Loop 側は ADR-0014 の責務分離のまま
  (`src/lib/audio-digest.ts` によるナレーション原稿生成、
  `OBSIDIAN_DIGEST_DIR/weekly/` への出力)に留める。
  **他 repo のコードは一切実行しない**

## 理由

- 越境の向きを逆転できる: 従来は Applied Loop → workbench(コード実行)
  だったが、変更後は my-copy が vault(既存の共有面)を読みに行くだけになり、
  Applied Loop は自己完結する
- my-copy 側に受け皿(`kind: python` cron・`MY_COPY_RELEASE_VIDEO_REPO`
  規約)が既にあり、新しい仕組みを増やさずに済む
- 週ズレ・冪等性のバグ修正は、どのみち逐語移植のタイミングでしか
  安全に直せない(bash の heredoc 込みで書き直すコストは移植コストと同等)

## 却下した案

- **release-video (triple-release-video) 側に bin として追加**:
  ADR-0023 が「org 横断・product 非依存」と明示した repo に、koki 個人の
  週次仕様(単一消費者向けオーケストレーション)を持ち込むと原則が崩れる。
  launchd の持ち主も定まらない(org repo は cron の主体になれない)
- **起動元だけ変えず Applied Loop に残す**: 越境の向きが変わらず、
  今回の目的(他 repo 実行の解消)を達成しない
- **パイプライン自体の作り直し(構造化・一般化)**: 実績 n=1 の機能に対して
  不相応。ADR-0014 の「パイプラインのブラッシュアップは本タスクのスコープ外」
  という立場を維持する

## 結果・トレードオフ

得るもの: Applied Loop が他 repo のコードを実行しなくなる。週ズレ・
冪等性バグの解消。my-copy 既存の doctor・kill switch・テスト規約に乗る。

意図的に失うもの: 音声合成ロジックが Applied Loop リポジトリから見えなく
なる(my-copy を見に行く必要がある)。ただし ADR-0014 が既に「release-video
パイプライン側の責務」と決めていた延長でしかなく、実質的な喪失ではない。

## 実装

- workbench commit: `weekly_audio.py` 新設・`config.py`/`doctor.py` 配線・
  `test_weekly_audio.py`(純関数のみ、node/ffmpeg/engine 呼び出しは
  triple-release-video 実体に対する手動検証で確認 — `RELEASE_VIDEO_TARGET_REPO_ROOT`
  を使い捨てディレクトリに向けて `tts.mjs` を実行し、`npm install` なしで
  4 セグメント生成に成功したことを確認済み)
- applied-loop commit: 本 ADR・ADR-0014 追記・`scripts/weekly-audio*`
  削除・`.env` の `AUDIO_OUTPUT_DIR` 削除
- launchd: `com.applied-loop.weekly-audio` を bootout・削除、
  `com.my-copy.weekly-audio` を同一セッション内で bootstrap
  (両方が同時に生きる週をまたがせない)

## 出典

- 2026-08-21〜22 実コード調査 + Opus 設計調査 2 本(境界棚卸し・
  移設先設計)、`~/tools/workbench` セッション
- 前例: ADR-0022(正典移動 + ポインタ化の型)、ADR-0023(層別分離の型)
