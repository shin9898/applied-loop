---
type: decision
status: proposed
date: 2026-08-26
tags: [harness, learning-loop, evaluation, cache, proposals, feature-off]
source_refs:
  [
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    docs/adr/0027-h-cycle-evidence-evaluation.md,
    docs/adr/0029-h-cycle-periodic-evaluation-contract.md,
    docs/adr/0033-h-cycle-generation-fenced-execution.md,
    src/lib/harness-cache-audit.ts,
    src/lib/loop-jobs/harness-evaluation/h-eval-policy-v1.ts,
  ]
---

# ADR-0035: ハーネス評価は cohort を混ぜず、証拠付きの次の打ち手だけを提案する

実装トラッキング: [GitHub Issue #53](https://github.com/shin9898/applied-loop/issues/53)
前提: ADR-0025 / ADR-0027 / ADR-0029 / ADR-0033、H-CYCLE A8-C3b/C3c

## 背景

Applied Loop には三つの別々の観測面がある。

1. **H-CYCLE**: Textbook Check から Gate / Capture / follow-up までの理解証拠。
2. **H-JOB / H-EVAL**: durable job と評価器自身の missed run、budget、finding precision。
3. **H-CACHE**: provider semantics で正規化した HarnessRun usage と stable-prefix 介入後の再利用率。

それぞれの projection や preview は存在するが、現時点では「この仕組みは改善しているのか」
「次に何をすべきか」を同じ安全境界で読めない。単一の総合スコアで三者を合算すると、
cache 構成比の変化を学習の改善と誤認したり、H-CYCLE の不足データを正常値に丸めたりする。

また、periodic evaluation を先に有効化しても、A8-C3b/C3c が未完なら、stale generation や
disable race に対する durable effect の安全性がない。評価器が提案を自動適用すると、
観測と権限が混ざり、cache token の節約という目的にも反する。

## 決定

### 1. 一つの report envelope に、独立した hypothesis verdict を並べる

`HarnessEvaluationReport v1` は H-CYCLE、H-JOB/H-EVAL、H-CACHE を数値的に合算しない。
各 cohort は自分の policy version、eligibility、metrics、verdict、reason を保ったまま
report の children になる。

```text
H-CYCLE projection ─┐
H-JOB / H-EVAL      ├─> deterministic report ─> 0..3 next-action proposals
H-CACHE cohorts  ───┘                                  │
                                                        └─> human review / explicit application
```

report 自体の verdict は `healthy | needs_attention | insufficient_evidence` の三値に限定する。
`healthy` は各 hypothesis が supported という意味ではなく、現在の evidence に stop condition が
無いことだけを表す。異なる cohort の相関や因果は主張しない。

### 2. cache 評価は matched cohort だけを比較する

H-CACHE の比較単位は、少なくとも次の tuple を固定する。

```text
(harness, model, repo, contextFingerprint, usageSemanticsVersion, collectorVersion)
```

stable-prefix の変更効果を比べる場合だけ、本人が記録した intervention の
`beforeFingerprint -> afterFingerprint` を用いる。harness/model/collector semantics が変わる、
sample が不足する、normalized usage が unavailable / invalid である、または application 記録が
無い場合は `inconclusive` とし、`review_stable_prefix` を出さない。代わりに
`collect_cache_baseline` または `record_and_reobserve` を出す。

H-CACHE は cache read 率だけで採否しない。fresh input / turn、cache write telemetry の有無、
H-CYCLE guardrail を併記し、学習 loop の悪化を cache 改善で相殺しない。

### 3. proposal は決定論的、redacted、非実行にする

v1 の proposal kind は固定し、最大三件を優先度順に返す。

| 優先 | kind | 条件 | 人間に求める次の一手 |
|---:|---|---|---|
| 1 | `pause_and_investigate` | privacy/data-loss/duplicate durable effect/stop condition | operation を止め、一次証跡を確認する |
| 2 | `complete_h_cycle_execution_fence` | A8-C3b/C3c が未完、または activation generation が不適格 | C3b/C3c を閉じ、runtime binding をしない |
| 3 | `collect_h_cycle_observation` | two manual observation、baseline、eligible window が不足 | read-only preview / self-run を実施する |
| 4 | `collect_cache_baseline` | cohort が不足・混在・usage が unavailable | collector / semantics を直し、同じ cohort を観測する |
| 5 | `review_stable_prefix` | valid matched cohort で cache guardrail 悪化 | harness-pack の**提案 diff**を確認し、採択後に再観測する |
| 6 | `record_and_reobserve` | intervention はあるが +7/+14 の評価窓が未完 | application と period を記録して待つ |
| 7 | `continue_observation` | stop condition がなく、判定がまだ provisional | policy を変えず次の window を観測する |

proposal は command、DB URL/path、prompt、answer、source revision hash、stack、secret を含まない。
`apply`、`enable`、`install`、`load`、`unload` の authority を持たず、UI / MCP / launchd / worker を
呼ばない。stable-prefix proposal の適用は harness-pack の既存 human-owned workflow に委ねる。

### 4. periodic execution は report kernel と分離する

段階を次のように固定する。

1. **A9-A manual preview**: pure report kernel と read-only query adapter を実装する。DB schema、
   queue、scheduler、LLM、write を追加しない。
2. **A8-C3b / C3c**: H-CYCLE の scoped enqueue/claim/recovery と atomic record/success fence を
   temporary SQLite で閉じる。A9-A はその結果を `complete_h_cycle_execution_fence` として読むだけ。
3. **A9-B durable report record**: `HarnessEvaluationRun` 等の schema / idempotency / privacy を
   別 ADR で決める。A8-C3c の証跡が無い間は開始しない。
4. **A8-C4 / A9-C opt-in schedule**: selected local DB、user launchd、heartbeat、kill switch、
   crash/sleep recovery、first record を個別承認の operation として扱う。
5. **A9-D outcome**: baseline と eligible windows を観測し、supported/rejected/inconclusive を
   report に固定する。LLM explanation は budget contract が別途実装されるまで呼ばない。

ページ訪問、morning briefing、`after()`、cache audit CLI は periodic scheduler の正本にしない。

### 5. report の input は aggregate-only の closed schema にする

manual preview が受け取る/adapter が作る evidence は、aggregate counts、period identity、
policy version、opaque cohort hash、redacted reason code だけにする。H-CYCLE record、H-EVAL
policy、cache audit の raw rows を JSON に複製しない。欠損・invalid・confounded は明示的な
`insufficient_evidence` とし、0 や成功へ丸めない。

v1 は LLM を呼ばない。token 効率は、(a) deterministic policy で routine evaluation を完結する、
(b) valid cohort だけを比較する、(c) recommendation を最大三件に抑える、ことで測る。

## 受入条件

1. report は cohort ごとの verdict/reason を保ち、異種 metrics を一つの score に変換しない。
2. closed input 以外、accessor/Proxy/extra key、invalid count/hash/week、混在 cohort は
   `insufficient_evidence` または redacted invalid result に fail closed する。
3. no-data、C3b/C3c pending、H-CYCLE baseline不足、cache usage unavailable、matched cache
   regression、stop condition、provisional healthy の各 fixture が deterministic な proposal を返す。
4. output は deeply immutable、最大三件、stable order、raw text/path/URL/secret/driver error を
   含まない。
5. read-only adapter は selected DB を作成・migrate・write せず、A7-C manual preview の contract
   を変えない。
6. production registry/handler、worker entrypoint、scheduler/launchd、UI/MCP、LLM、cache
   pre-warm、automatic intervention を追加しない。
7. cache stable-prefix recommendation は intervention と matched cohort が無ければ出ない。
8. typecheck、lint、full suite、historical dormant fences、temporary SQLite regression が通る。

## 非ゴールと停止条件

- H-CYCLE policy の outcome から Gate、Capture、Misconception、notification を自動作成しない。
- cache read 率だけで prefix 変更を推奨・適用しない。
- selected local DB、launchd、worker、heartbeat を自律有効化しない。
- LLM explanation、cache pre-warm、token budget reservation、provider API key を v1 に入れない。
- privacy/data-loss/duplicate durable effect、record integrity failure、manual preview write、
  cohort mix-up が一件でもあれば proposal を `pause_and_investigate` に固定し、次段階へ進まない。

## 代替案とトレードオフ

1. **総合スコアを出す**: cache や job health が learning evidence を打ち消す誤解を生むため採らない。
2. **LLM に次の一手を自由生成させる**: routine token 消費と再現不能な判断を増やすため採らない。
3. **recommendation から自動適用する**: observation と authority を混ぜるため採らない。
4. **A8-C3b/C3c を待って report の設計も止める**: data contract を後追いで混ぜるため採らない。
5. **cache audit の全 repo 合算で prefix を判断する**: composition shift を施策効果と誤認するため採らない。

## Rollout

1. この ADR と Issue を review し、A9-A report schema / proposal priority を freeze する。
2. A8-C3b を feature-off で実装し、C3c の前提を閉じる。
3. A9-A の pure kernel と read-only preview を独立 PR で実装する。
4. A8-C3c を実装し、manual H-CYCLE observation と P4/P1/P2 dogfood を並行で集める。
5. A8-C4/A9-C は per-operation approval と operational evidence が揃った時だけ提案する。
