---
type: decision
status: proposed
date: 2026-08-26
tags: [harness, learning-loop, evaluation, observation, feature-off]
source_refs:
  [
    docs/adr/0035-harness-evaluation-next-action-proposals.md,
    docs/adr/0036-harness-evaluation-durable-run-record.md,
    docs/adr/0037-harness-evaluation-manual-window-adapter.md,
    src/lib/loop-jobs/harness-evaluation/harness-evaluation-source-preview-cli.ts,
    src/lib/loop-jobs/harness-evaluation/harness-evaluation-window-adapter-v1.ts,
  ]
---

# ADR-0038: source preview から単一 observation window へ渡す manual caller

実装トラッキング: [GitHub Issue #53](https://github.com/shin9898/applied-loop/issues/53)
前提: ADR-0035 / ADR-0036 / ADR-0037、A9-A source preview、A9-D1 classifier

## 背景

A9-A の source preview は、H-CYCLE / H-EVAL / H-CACHE の aggregate-only source を
一つの redacted report に閉じる。A9-D2 は、その report と明示的な cohort・期間メタデータを
一つの A9-D1 window source に写像する。しかし、source → report → adapter を手動でつなぐ
caller がないと、実窓観測は個別の実装呼び出しに分散し、どの cohort を読んだかを再現できない。

ここで三つの cohort を一つの outcome に合算したり、caller が二つの窓を収集したりすると、
H-CYCLE の不足証拠と H-CACHE の改善を相殺する危険がある。反対に、caller に DB query、
durable writer、scheduler を持たせると、manual observation と runtime authority が混ざる。

## 決定

### 1. stdin-only の一窓 caller を追加する

`harness:evaluate-window-preview -- --stdin` は次の closed request を一件だけ受け取る。

```text
source evidence + (cohort, policyVersion, opaque scopeHash, cadence, numeric period)
       │
       ├─> A9-A evidence builder
       ├─> deterministic report kernel
       └─> A9-D2 single-cohort adapter
                    │
                    └─> one harness_evaluation_window_source_v1
```

入力の root は exact-key と `structuredClone` で閉じ、source evidence は既存の
`buildHarnessEvaluationEvidenceV1` に委ねる。report 全体や source raw data は出力せず、成功時は
opaque identity と aggregate outcome だけの一窓を一行で返す。

### 2. cohort は caller 単位で一つに固定する

caller は `h_cycle` / `h_eval` / `h_cache` のいずれか一つと、その cohort 固有の policy version
だけを A9-D2 adapter に渡す。三 cohort の report は source の正規化に必要だが、出力には選択
cohort の一窓だけを残す。二つ目の期間や A9-D1 classifier は caller の責務に含めない。

この形により、同じ source と同じ period の再実行は同じ閉じた窓になり、manual operator は
各 cohort の隣接窓を別々に採取できる。routine の report / window 判定は deterministic なので
LLM token を消費しない。

### 3. feature-off / read-only 境界を維持する

caller は DB、Prisma、clock、scheduler、worker、launchd、LLM、cache pre-warm、A9-B writer、
UI / MCP、Gate、Capture、notification、automatic intervention を呼ばない。stdin の明示的な
`--stdin` が無い場合は入力を取得せず、failure line を返す。入力上限は 65,536 bytes とし、
invalid JSON / source evidence / window、integrity stop、invalid cohort aggregate は redacted
failure にして窓を返さない。

## 受入条件

1. 三 cohort を個別に source → report → 一窓へ写像できる。
2. 同じ入力は同じ一行の output となり、week key、hash 以外の source identity、raw usage、
   prompt、answer、path、URL、secretを出力しない。
3. exact-key、invalid policy / hash / period、source extra key、integrity stop は fail-closed。
4. stdin authorization、input bound、single-line output、writer failure、CLI smoke、
   non-authority static fence を focused test で確認する。
5. A9-D1 の二窓 classifier、A9-B durable writer、scheduler、worker、launchd は起動しない。

## 非ゴールと停止条件

- caller で複数窓を保持・ソート・eligible 判定しない。
- 三 cohort を一つの verdict / score に潰さない。
- real local DB、selected DB、runtime activation、launchd、notification、Gate、Capture を
  自動発火しない。
- integrity stop、manual preview write、raw-looking identity、closed-schema violation が
  発生したら窓を生成せず、A9-D1 / A9-B へ渡さない。

## 代替案とトレードオフ

1. **既存 source preview の stdout を別プロセスで pipe する**: 二重 JSON parse と stderr / exit
   code の境界が増え、failure の redaction を一箇所で保証できないため採らない。
2. **caller で二つの窓を集めて classifier まで呼ぶ**: manual observation と outcome decision
   の承認が混ざり、baseline 不足を caller が隠せるため採らない。
3. **report 全体を output する**: token と raw-looking aggregate surface を増やすため採らない。
4. **DB query を caller に追加する**: selected DB と実行主体の承認境界を広げるため採らない。

## Rollout

1. A9-D3 caller を feature-off のまま review する。
2. 本人が選んだ read-only source evidence と期間で、H-CYCLE / H-EVAL / H-CACHE を別々に一窓化する。
3. 各 cohort の adjacent window を手動で揃え、A9-D1 classifier の `baseline_collecting` /
   `inconclusive` / `eligible` を別途観測する。
4. user-owned operational evidence と per-operation approval が揃うまで、A9-B writer と
   A8-C4 / A9-C runtime binding は開始しない。
