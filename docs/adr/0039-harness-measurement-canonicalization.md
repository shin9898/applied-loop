---
type: decision
status: proposed
date: 2026-08-26
tags: [harness, cache, measurement, privacy, feature-off]
source_refs:
  [
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    docs/adr/0035-harness-evaluation-next-action-proposals.md,
    src/lib/harness-usage-evidence.ts,
    src/lib/harness-stats.ts,
    scripts/collect-harness.mjs,
  ]
---

# ADR-0039: LLM usage measurement の canonical projection を固定する

実装トラッキング: GitHub Issue #53

## 背景

`HarnessRun` には Claude / Codex の raw usage counter が保存されているが、providerごとに
`tokensIn` の意味が異なる。特に Codex は `cached_input_tokens` が `input_tokens` の部分集合
なので、`cacheRead / (tokensIn + cacheRead + cacheCreate)` は cache read を二重計上する。
また、既存の repo dashboard はこの legacy 式を使い続けるため、正規化済み evidence と表示が
食い違っていた。

H-CACHE の matched cohort には `contextFingerprint` が必要だが、collector は会話本文や
prompt を読まない。hash を作るために本文を読むと、測定のためにプライバシー境界を広げる。

## 決定

### 1. collector-v3 は metadata-only fingerprint を送る

- 標準値は `harness-context-fingerprint-v1` と harness / model / repo の canonical tuple を
  SHA-256 化する。
- prefix介入を比較するときは、運用者が stable-prefix descriptor の hash を
  `APPLIED_LOOP_CONTEXT_FINGERPRINT=sha256:<64hex>` で明示する。prompt本文、tool callの引数、
  観測されたtool利用集合はhash入力にしない。
- 同一sessionの再収集では、collectorのstateに保存したfingerprintを再利用する。介入の境界が
  sessionファイルの成長で書き換わらないようにする。
- 不正なoverrideは採用せず、metadata-derived fingerprintへ戻す。値そのものをログへechoしない。

### 2. repo dashboard は normalized evidence のみを使う

`repoCacheReadRates` は `usageSemanticsVersion=harness-usage-v1` かつ
`usageNormalizationStatus=supported` の行だけを集計する。分子は `cacheReadTokens`、分母は
`inputTotalTokens` とし、legacy/null/invalid/unsupported 行を raw counterへフォールバックせず
観測から除外する。観測が薄い場合は保留として表示し、0%悪化へ丸めない。

`readSupportedStoredHarnessUsage` は derived fields の整合性（read + uncached + optional write =
total）を再検査し、壊れた行を rate denominator に入れない。

### 3. backfill と periodic evaluation は別境界にする

既存行の derived evidence は `harness:plan-usage-backfill -- --json` の read-only計画で件数と
除外理由を確認する。計画自体はDBを書き換えない。backfill write、selected DB、launchd、
scheduler、worker、A9-B writer、evaluation LLM はこの変更では開始しない。

## 受入条件

1. collectorのpayloadに会話本文なしでvalid `contextFingerprint` と collector-v3 が入る。
2. 同じ harness / model / repo は同じderived fingerprintになり、明示overrideは介入用に別値へ
   固定できる。
3. repo dashboard / module promptのcache rateはCodexのcached inputを二重計上しない。
4. legacy/null/invalid evidenceは観測不足として扱い、正常・0・悪化へ丸めない。
5. usage projectionとfingerprintのfocused test、typecheck、lintが通る。

## 非ゴール

- promptや会話本文からfingerprintを生成すること
- contextFingerprintだけでstable-prefix変更の因果を証明すること
- H-CACHEのbaseline/follow-up収集、A9-D1 classifier、durable write、schedulerを自動起動すること
- 評価器用LLM token budgetをこのsliceで追加すること

## Rollout

1. collector-v3を有効にし、selected local SQLiteへ新規metadataを蓄積する。
2. read-only backfill計画とW35のnormalized cache baselineを確認する。
3. prefix介入がある場合だけoverride hashを変更し、同じharness/model/repo/collector cohortの
   follow-upを採取する。
4. A9-D3 manual callerでH-CYCLE / H-EVAL / H-CACHEを別々のwindowへ渡し、隣接2窓が揃うまで
   periodic runtime bindingを保留する。
