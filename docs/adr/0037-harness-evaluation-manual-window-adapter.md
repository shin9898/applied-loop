---
type: decision
status: proposed
date: 2026-08-26
tags: [harness, learning-loop, evaluation, cache, observation, feature-off]
source_refs:
  [
    docs/adr/0035-harness-evaluation-next-action-proposals.md,
    docs/adr/0036-harness-evaluation-durable-run-record.md,
    src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.ts,
    src/lib/harness-evaluation-run-v1.ts,
  ]
---

# ADR-0037: manual preview report を A9-D1 observation window に写像する

実装トラッキング: [GitHub Issue #53](https://github.com/shin9898/applied-loop/issues/53)
前提: ADR-0035 / ADR-0036、A9-A manual preview、A9-D1 classifier

## 背景

A9-A は H-CYCLE / H-EVAL / H-CACHE を混ぜずに評価する aggregate-only report を返し、
A9-D1 は同一 cohort の completed window を二つ並べて baseline / inconclusive / eligible を
決定する。しかし両者の間に、手動 preview の一回分の結果を「一つの観測窓」として渡す境界が
まだ無かった。

report 全体をそのまま A9-D1 に渡すと、異なる cohort の verdict や proposal が一つの outcome
に潰れ、raw source を durable key に持ち込む余地も生じる。反対に、窓の収集や記録を adapter
へ入れると、manual preview と scheduler / writer の権限境界が混ざる。

## 決定

### 1. 入力は単一 cohort を指定した closed request に限定する

adaptHarnessEvaluationReportToWindowV1 は次の closed request だけを受け取る。

~~~text
manual report + (cohort, policyVersion, opaque scopeHash, cadence, numeric period)
                           │
                           └─> one A9-D1 window source
~~~

入力は structuredClone と exact-key 検証を通し、report は
normalizeHarnessEvaluationReportV1 で再検証する。scopeHash、period identity、policy version は
A9-D1 normalizer に再度渡し、raw week key、repo/path、prompt、answer、usage row は入力・出力に
許可しない。

### 2. cohort の verdict だけを窓の outcome に変換する

| report cohort verdict | window outcome | decision stage |
|---|---|---|
| healthy | supported | cohort 固有の確定規則 |
| needs_attention | rejected | cohort 固有の確定規則 |
| insufficient_evidence | inconclusive | 常に provisional |

H-EVAL は report が持つ decisionStage を保持する。H-CYCLE は supported / rejected reason
だけを final とし、execution fence や record reconcile の未完了は provisional に留める。
H-CACHE は matched comparison の supported / rejected だけを final とする。これにより、
不足証拠や未完了の運用状態が二つの窓の eligible 判定へ昇格しない。

report の integrity stop condition または選択 cohort の invalid_aggregate は窓を生成せず、
redacted failure を返す。stop condition を rejected の正常な観測として記録しない。

### 3. adapter は read-only / feature-off の純粋境界に留める

adapter は clock、DB、Prisma、scheduler、worker、launchd、LLM、cache pre-warm、writer、
automatic intervention を持たない。成功結果は A9-D1 の opaque window のみを返し、A9-B
evaluationKeyHash の導出・durable write は明示的 caller の責務とする。

通常の窓判定は deterministic なので token を消費しない。manual preview の同じ入力は同じ窓
identity になり、後続の A9-D1 classifier と A9-B digest fenceへ収束する。

## 受入条件

1. H-EVAL / H-CYCLE / H-CACHE の各 cohort を単独で一窓へ写像できる。
2. supported、rejected、inconclusive と provisional / final の組み合わせが上表どおり
   deterministic に固定される。
3. exact-key、Proxy / accessor、invalid hash / period / policy、integrity stop、invalid aggregate
   は raw data を返さず fail closed する。
4. 成功結果は deeply immutable で、report、proposal、source label を含まない。
5. source file に DB、scheduler、worker、launchd、LLM、write authority が無く、A9-A preview
   の contract と A9-B writer を変更しない。
6. focused test、typecheck、lint、historical scope fence を通過する。

## 非ゴールと停止条件

- 複数 cohort を一回の入力で混ぜて一つの outcome にしない。
- adapter から A9-D1 の複数窓を収集しない。
- adapter から A9-B writer、scheduler、worker、launchd、UI / MCP、Gate、Capture、
  notification、stable-prefix の変更を呼ばない。
- integrity stop、manual preview write、raw-looking identity、closed-schema violation が
  発生したら窓を生成せず、次段階へ進まない。

## 代替案とトレードオフ

1. **report 全体から一窓を作る**: cohort を混ぜるため採らない。
2. **cohort ごとの decision stage を自由入力にする**: manual assertion が eligibility を
   早めるため採らない。
3. **adapter 内でDBを読む**: read-only query と窓写像の責務が混ざり、選択DB・権限境界を
   広げるため採らない。
4. **stop condition を rejected として保存する**: integrity failure を正常な仮説 outcome と
   誤認するため採らない。

## Rollout

1. A9-D2 adapter を feature-off のまま review する。
2. 明示的な manual preview caller から H-EVAL / H-CYCLE / H-CACHE を別々に窓化する。
3. 二つの adjacent window が揃うまで A9-D1 classifier を baseline_collecting /
   inconclusive に留める。
4. 実観測と user-owned operational evidence が揃った後にのみ、A9-B durable write と
   A8-C4 / A9-C operation を別承認で検討する。
