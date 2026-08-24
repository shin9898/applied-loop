---
type: operation-template
status: draft
date: 2026-08-24
tags: [learning-loop, h-cycle, activation, opt-in, operations, safety]
source_refs:
  [
    docs/adr/0029-h-cycle-periodic-evaluation-contract.md,
    docs/adr/0032-h-cycle-activation-readiness-contract.md,
    src/lib/loop-jobs/worker-phase1.mjs,
    src/lib/loop-jobs/worker-phase2.ts,
  ]
---

# H-CYCLE real activation packet v1

実装トラッキング: [GitHub Issue #40](https://github.com/shin9898/applied-loop/issues/40)

> **これは template であり、activation の承認でも設定ファイルでもない。**
> 実際の packet は operator が private に保持し、DB URL / path、secret、実行 command、raw
> preview は repository・PR・Issue・LoopJob payload・record に書かない。

## 目的

ADR-0032 が固定した `featureState: off` の readiness と、実際に local SQLite へ
H-CYCLE evaluation を記録して定期観測する operation を混同しない。

この packet は、A8-C の一つの人間所有 decision を再現可能にする。対象 DB、開始週、
scheduler、停止経路を一緒に決めるため、たとえば「scheduler だけ先に置く」または
「readiness が attested だから有効」といった暗黙 activation を防ぐ。

```text
operator-held private packet
        │ explicit approve / reject
        ▼
bounded implementation PR ── CI + independent review ──▶ explicit run approval
        │                                                    │
        │ no install / no DB write                            ▼
        └─────────────────────────────▶ local opt-in observation only

No edge: readiness attested → enabled
No edge: policy verdict → intervention or notification
```

## 現在の境界

- A8-B の aggregate-only record、closed job identity、planner、dormant handler は main にある。
- A8-C0 は pure `featureState: off` contract のみで、real DB、registry/handler、scheduler、
  launchd、CLI、LLM、cache/token behavior を有効化しない。
- current production worker の registry と handlers は empty である。`--once` と worker env の
  既存契約は H-CYCLE activation authority ではない。
- H-CYCLE 用の installed scheduler や canonical local DB target は、この template から推測しない。

## operator が一回だけ決める packet

次の四項目を **同じ approval** で選ぶ。どれか一つでも空、曖昧、または後から差し替わるなら
packet は `PENDING` のままとし、A8-C implementation を始めない。

| 項目 | private packet に必要な値 | repository に残してよい証跡 |
| --- | --- | --- |
| target | concrete local SQLite target。file URI と実 path は private | target が local SQLite であるという attestation だけ |
| floor | exact `YYYY-Www` の activation floor | week key。floor より前を backfill しない assertion |
| scheduler | opt-in mechanism と owner | mechanism class と owner。plist label / command は private |
| stop | disable と uninstall の復旧可能な route | stop route が tested という attestation。実 command は private |

approval statement の最小形は次である。

```text
I approve / reject this H-CYCLE activation packet as one unit:
target=<private local SQLite reference>; floor=<YYYY-Www>;
scheduler=<private opt-in mechanism>; stop=<private disable/uninstall route>.
```

`approve` は A8-C implementation scope の owner decision であり、実際の DB write、scheduler
install、first run を自動で実行する許可ではない。それぞれの irreversible / externally observable
operation の直前に、対象と rollback route を再掲して operator の実行承認を得る。

## 技術 evidence gate

approval 済み packet でも、次を満たすまで scheduler の install や first real record を行わない。

1. **manual observation**: operator 承認済みの A7-C manual read-only observation が二件ある。
   repository に残すのは日時、target week、aggregate-only outcome classification、command が
   read-only だったことだけである。stdout、raw evidence、ID、answer、question、reference は残さない。
2. **worker heartbeat**: enabled / disabled を区別でき、期待しない process / job を発見できる。
   heartbeat は data content や DB URL を出力しない。
3. **kill switch**: disable/uninstall 後に scan、enqueue、delivery、record write が起きないことを
   disposable SQLite で再現し、local target では read-only observation で確認する。
4. **crash and sleep recovery**: record insert 後の retry は same digest のみを受け、mismatch は
   `evaluation_record_integrity_failure` で停止する。restart / sleep は最古の missing week を一件だけ
   catch-up し、pre-floor history を backfill しない。
5. **first record interpretation**: first real record は運用 observation である。`supported` / `rejected`
   を intervention、Gate、Capture、Misconception、notification、LLM call、cache/token action に
   変換しない。

## A8-C implementation contract

packet が approved になった後の PR は、次の観測可能な behavior に限定する。

- packet の floor 以後だけを old-to-new で一 scan あたり最大一件 enqueue する。
- record は aggregate-only append-only identity で保存し、same digest retry だけを idempotent とする。
- production registry / handler binding は selected local target と explicit opt-in の組だけで到達可能にする。
- scheduler definition を repository に置いても、install / load は operator 操作に留める。
- disable/uninstall は enqueue 前、delivery 前、record write 前に fail closed し、already-queued work の
  behavior を明示的に test する。

次は A8-C の non-goal である。

- global default enable、page visit / `after()` / morning briefing を schedule authority にすること
- A7-C manual CLI を write-capable にすること
- target DB を `.env`、repository、Issue、PR body、payload、record、log に保存・echo すること
- policy verdict をユーザーへの自動介入に接続すること
- H-CYCLE record を H-EVAL health、HarnessRun、H-CACHE reuse、LLM token budget と同一 cohort にすること

## 評価と次の一手

first real record の後、operator は次の三つだけを evidence として評価する。

| 観測 | 成功条件 | 失敗時の次の一手 |
| --- | --- | --- |
| schedule | floor 以後の最古の一週だけが intent 通り処理される | disable し、queue identity / due calculation を調査する |
| durability | retry が同じ record を確認し、mismatch を上書きしない | disable し、integrity failure を調査する |
| stop | disable/uninstall 後に新しい write がない | scheduler / worker binding を撤去し、再有効化を新 packet とする |

一回の観測で learning-loop の有効性、token 節約、または policy の support / reject を結論づけない。
`仮説 → 変更 → 検証 → 評価 → 次の一手` の record を append-only に残し、定期的な再評価は
packet と stop route が有効な間だけ行う。

## Decision log（operator が private packet から redacted に転記する欄）

| Field | Value |
| --- | --- |
| packet status | `PENDING` / `APPROVED` / `REJECTED` / `REVOKED` |
| approval evidence | operator-owned reference。DB URL / path / command を含めない |
| floor week | `YYYY-Www` または `not approved` |
| scheduler class | `not approved` または redacted mechanism class |
| stop-route evidence | `not tested` / redacted tested reference |
| manual observations | `0` / `1` / `2+`。raw output を含めない |
| heartbeat and kill-switch | `not tested` / redacted evidence reference |
| first record observation | `not run` / aggregate-only record reference |

この log は `APPROVED` を現物の activation proof に昇格させない。運用後の timestamped
observation と stop evidence がそろって初めて、次の packet revision を検討できる。
