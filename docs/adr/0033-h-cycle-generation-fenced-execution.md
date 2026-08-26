---
type: decision
status: proposed
date: 2026-08-26
tags: [learning-loop, h-cycle, activation, queue, recovery, safety, sqlite]
source_refs:
  [
    docs/adr/0029-h-cycle-periodic-evaluation-contract.md,
    docs/adr/0032-h-cycle-activation-readiness-contract.md,
    src/lib/loop-jobs/state-machine.ts,
    src/lib/loop-jobs/delivery.ts,
    src/lib/loop-jobs/worker-phase2.ts,
    src/lib/h-cycle-evaluation-record.ts,
  ]
---

# ADR-0033: H-CYCLE の execution は activation generation で fence する

実装トラッキング: [GitHub Issue #40](https://github.com/shin9898/applied-loop/issues/40)
設計 freeze: [Issue #40 comment](https://github.com/shin9898/applied-loop/issues/40#issuecomment-5419537364)
前提: ADR-0029 / ADR-0032、A8-C1 control ledger、A8-C2 kind-isolated one-shot

## 背景

A8-C1 は append-only control ledger に root sequence を持たせ、disable / re-enable を
順序付きで導出する。しかし現在の `LoopJob` は generation を持たず、A8-C2 の
`claimKind` / `runOneKindDelivery` は kind だけを隔離する。global
`recoverExpired()`、generic owned mutation、record の duplicate reconciliation には
current control state の fence がない。

このまま H-CYCLE を worker / registry / scheduler へ接続すると、G1 claim 後の
disable、G1 disable 後の G2 re-enable、同じ target の stale queue dedupe、generic
recovery、record write のいずれも「stop 後に durable effect を出さない」ことを
証明できない。これは run-time activation の前に閉じるべき substrate の欠落である。

## 決定

### 1. generation は payload ではなく internal execution metadata に置く

future C3b は `LoopJob.executionGenerationSequence` を nullable internal metadata として
追加し、`HCycleActivationEvent.sequence` への FK を持たせる。foreign job と既存 job は
null を維持し、legacy null H-CYCLE row は永久に inert とする。

H-CYCLE scoped enqueue は current active root から generation を DB transaction 内で
導出する。caller は generation を入力できない。closed five-field payload、registry dedupe
projection、record identity、payload/record JSON、public output は変えない。

G1 stale row が G2 same-target row を妨げないよう、new H-CYCLE row の **internal execution
dedupe key** だけは root sequence を suffix とする。これは payload / record identity の
変更ではない。G1 がすでに record を commit 済みなら、G2 は same digest だけを guarded
reconcile でき、second record や overwrite は作れない。

### 2. generic path と H-CYCLE scoped path を分離する

`h_cycle_evaluate` は reserved kind とする。factory-created generic queue / worker の enqueue,
claim, recovery, renew, succeed, fail, generic delivery は H-CYCLE row を claim / mutate
できない。production registry と handlers は空のまま、`worker-phase2.ts` は byte-protected
のままである。

H-CYCLE row を touch できるのは scoped family だけである。enqueue / claim / renew / success /
failure / recovery は次を durable mutation の時点で証明する。

```text
semantically valid current control history
active root sequence = execution generation
kind = h_cycle_evaluate
target week >= active root activation floor
```

renew / success / failure は matching unexpired lease を、expired recovery は exact observed
`running` token-and-expiry snapshot を outer mutation でも再確認する。semantic-invalid
control history、legacy/null、stale、disabled、superseded、malformed、pre-floor row は
`execution_fenced` で no-mutation とする。

generic delivery の injected structural queue は application code として trusted であり、
その `claim()` callback 自身の任意 mutation までは security boundary に含めない。ただし
returned H-CYCLE job は decode / handler / retry / success / failure の前に closed failure で
止める。`runOneKindDelivery(kind = h_cycle_evaluate)` は queue invocation 前に reject する。
H-CYCLE executor は generic delivery を利用しない。

### 3. claimed target と durable record を同じ capability に束ねる

scoped claim は stored `payloadJson` / `payloadHash` を exact five-field H-CYCLE identity として
validate し、job id、lease token、generation、payload hash、target week、policy/projection
versionを持つ opaque capability を生成する。post-claim caller は generation / target / record
identity を選べない。

C3c の writer は one proven SQLite write transaction の中で、current root、matching lease、
floor、payload hash、target、policy/projection を同時に照合し、guarded insert、same-digest
reconciliation、success mutation を行う。duplicate error 後の unguarded `findUnique()` は
禁止する。disable が先に commit すれば zero row、writer が先なら immutable pre-disable
record だけが残る。

pure evaluator は closed snapshot value だけを受ける。snapshot acquisition は別の injected
read-only adapter であり、pure evaluator に DB callback、queue mutator、LLM、cache、notification,
scheduler capability を渡さない。

### 4. transaction primitive は C3p で先に実測する

C3b/C3c は transaction semantics を仮定しない。A8-C3p は disposable SQLite 上の二つの
Prisma/better-sqlite3 client で、same physical connection に bound された injected
write-transaction helper を検証する。

この probe は actual disable append path との writer-first / disable-first barrier、FK enforcement,
`BEGIN IMMEDIATE` または named equivalent、`SQLITE_BUSY` の redaction/no-mutation、guarded
`INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` を実測する。probe が通らなければ
C3b/C3c は開始せず、fallback を黙って実装しない。

### 5. A8-C2 の protection を C3 で置換しない

C3 は C2 の H-CYCLE instantiation だけを supersede し、non-reserved kind の kind isolation は
維持する。C3 addition は literal `A8-C3 BEGIN/END` marker で囲む。C2 guard は marker が
actual comment token であることを確認し、exact C3 region を SHA verify して strip した
**C3 projection** に対して、既存五つの C2 snippet hash、forbidden-edge scan、pre-C2 byte
reconstruction を実行する。

existing C2 behavioral fixture は exact non-reserved `c3_scoped_probe` へ移行する。C3-only test
が reserved-kind pre-claim rejection を確認する。C3a の support artifact は local review
worktree で only if present に exact SHA verify し、clean CI では absence を正とする。別の
historical guard は ADR bytes と manifest / C2 projection marker を independent に cross-check
する。

## 受入条件

1. C3a は ADR-0033 と chained static fence だけを実装し、C3p/C3b/C3c の runtime code を
   含めない。
2. C3p は exact helper の connection-bound lock / rollback behavior を actual two-client
   disposable fixture で証明してから C3b/C3c design を freeze する。
3. C3b/C3c は migration table rebuild の rows, unique key, indexes, FK/check/trigger を
   `sqlite_master` と every test client の FK behavior で検証する。
4. generic worker regression は expired H-CYCLE row を seed し、generic recovery と delivery が
   byte-for-byte non-mutation であることを証明する。
5. all public results remain redacted and `featureState: off`; generation, DB path/URL, payload,
   record body, SQL/driver error, stack を出さない。

## 非ゴール

- selected local SQLite への schema apply / migration / attestation / evidence / record write
- production registry / handler binding、worker entrypoint変更、scheduler / launchd definition,
  install, load, unload、first run、periodic execution
- heartbeat、manual observation、crash/sleep observation、cache/token behavior、LLM call、policy
  intervention
- payload v2、record identity への generation 追加、retention/cancellation/deletion policy
- 14-day readiness freshness を periodic execution の自動 stop authority にすること

## Rollout

1. A8-C3a の ADR/static-fence PR を review / CI / owner merge する。
2. merge 後に main を read-only re-observe する。
3. A8-C3p を separately freeze し、temporary SQLite transaction primitive を one-test
   RED→minimum GREEN で測定する。
4. C3p の evidence がある場合だけ C3b、続いて C3c を separately design review / freeze する。
5. runtime binding は A8-C4 の separate operator decision まで行わない。

## 代替案とトレードオフ

1. **generation を payload / record identity に入れる**: retry / dedupe / historical identity を
   変え、re-enable 時に同じ週の second record を許すため採らない。
2. **stale job を cancel/delete する**: disable 後の queue mutation を stop proof と混同し、
   retention policy を先取りするため採らない。
3. **generic recovery を H-CYCLE path として使う**: kind/generation/lease fence がなく、
   foreign / stale row を mutation できるため採らない。
4. **control state を read して後で write する**: disable race を残すため採らない。
5. **C2 guard の hash を更新する**: earlier isolation proof を失うため採らない。C3 projection
   による nested reconstruction を採る。
