---
type: decision
status: proposed
date: 2026-08-24
tags: [learning-loop, h-cycle, activation, opt-in, safety, readiness]
source_refs:
  [
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    docs/adr/0029-h-cycle-periodic-evaluation-contract.md,
    src/lib/loop-jobs/worker-phase1.mjs,
    src/lib/loop-jobs/worker-phase2.ts,
    src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts,
  ]
---

# ADR-0032: H-CYCLE の activation readiness は権限を持たない feature-off contract とする

実装トラッキング: [GitHub Issue #40](https://github.com/shin9898/applied-loop/issues/40)
A8-C0 source-of-truth addendum: [Issue #40 comment](https://github.com/shin9898/applied-loop/issues/40#issuecomment-5390993285)
前提: ADR-0025 / ADR-0027 / ADR-0028 / ADR-0029、A8-B1 / A8-B2

## 背景

ADR-0029 は A8 を三段階へ分離した。A8-B は temporary SQLite だけで、append-only
HCycleEvaluationRecord、closed LoopJob identity、activation floor を受け取る pure planner、
injected dormant handler を実装した。A8-C は、本人が選んだ local DB に対して opt-in
scheduler を有効化し、実地観測する別の運用判断である。

現在の production worker は空の registry と空の handlers を持つ。worker phase 1 は --once、
LOOP_JOB_WORKER_ENABLED=1、canonical existing SQLite URL をすべて要求するが、これは
H-CYCLE を有効にする authority ではない。A8-B2 の planner と handler も、DB、worker、
scheduler、manual A7-C CLI を開かない dormant substrate である。

この段階で readiness の「条件が揃ったら有効」と解釈できるコードを置くと、対象 DB、
activation floor、scheduler の所有者、disable/uninstall 経路を本人が決める前に
activation authority を作ってしまう。そこで、最初の A8-C slice は readiness を
観測可能な閉じた contract に限定し、featureState を常に off にする。

## 決定

### 1. A8-C0 は pure readiness contract だけを実装する

新規 module path は src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts
に固定する。default export と runtime entrypoint からの re-export は禁止し、次の named
public symbols だけを提供する。

    H_CYCLE_PERIODIC_SCHEDULE_INTENT_V1
    assessHCycleActivationReadinessV1(input)
    HCycleActivationReadinessInputV1
    HCycleActivationReadinessResultV1

module は pure function であり、DB、filesystem、environment、process arguments、clock、
network、global mutable state を読まない。planner、dormant handler、delivery、worker、
Prisma、A7-C preview query / CLI、scheduler を import しない。

### 2. schedule intent は固定 metadata であり scheduler authority ではない

    version: h_cycle_weekly_monday_0815_jst_v1
    timeZone: Asia/Tokyo
    cadence: weekly
    weekday: monday
    localTime: 08:15
    onTimeGraceMinutes: 5
    maxEnqueuePerScan: 1

これは ADR-0029 の月曜 08:15 JST、5分 grace、oldest one catch-up を重複なく表示する
metadata である。A8-C0 は scan、enqueue、dispatch、record write を一切行わない。

### 3. input は closed attestation だけを受ける

入力 schema は h_cycle_activation_readiness_v1 とし、exact keys の plain object のみを受ける。

    schema: h_cycle_activation_readiness_v1
    targetDatabaseBinding: missing | externally_attested
    schedulerBinding: missing | externally_attested
    activationFloorWeekKey: null | valid JST ISO week
    disableUninstallEvidence: missing | accepted
    workerOperationalEvidence: missing | accepted
    manualObservationEvidence:
      none | one_observed | at_least_two_observed

externally_attested は URL、path、plist 名、secret、command を表せない固定語である。
externally_attested と accepted は unverified technical attestation であり、authorization
でも real binding の証明でもない。operator authorization、approval state、operator identity
は input type と runtime input のどちらにも存在しない。non-null floor は既存 strict JST
ISO week validation と同じ calendar semantics を満たす必要があるが、planner を呼んでは
ならない。

### 4. output は常に featureState = off

input が不正なら、出力は次だけとする。

    ok: false
    featureState: off
    code: invalid_activation_readiness_input

input が有効なら、出力は次を持つ。

    ok: true
    schema: h_cycle_activation_readiness_v1
    featureState: off
    technicalReadiness: blocked | attested
    scheduleIntent: fixed schedule metadata
    blockers: ordered closed blocker codes

blocker codes は重複なく、次の順序で出す。

1. target_database_binding_missing
2. scheduler_binding_missing
3. activation_floor_missing
4. disable_uninstall_evidence_missing
5. worker_operational_evidence_missing
6. manual_observation_evidence_missing

入力が技術的に完全なら blockers は空になり technicalReadiness は attested になるが、
featureState は off のままである。attested は authorization、binding、health、future
activation の許可を意味しない。off 以外の state、plan、payload、job、handler、record、
command、activation event は返さない。入力値や sentinel を output、error、log に echo
しない。

### 5. 実 activation は一つの operator decision に束ねる

real activation を妨げる人間所有の判断は次の一件だけである。

> concrete local SQLite target、activation-floor week、scheduler mechanism、accepted
> disable/uninstall route を束ねた complete packet を、operator が有効化するか。

これらは別々の黙示承認ではなく、一つの yes/no authorization の parameter である。
この human decision は A8-C0 の input / result / type に表現せず、separate real-activation
workflow が所有する。この承認がない間、persistent activation state、DB
migration/application、registry/handler wiring、real one-shot run、scheduler installation、
periodic execution は開始しない。

二件の manual A7-C observation、worker heartbeat / kill-switch / crash-sleep recovery の
受入証跡、最初の real record の非介入観測は、この一件の decision とは別の technical
evidence gate として残る。A8-C0 の manualObservationEvidence はこの evidence の量だけを
表し、誰の approval も表さない。

## 受入条件

1. valid closed v1 input は deeply immutable かつ structural equality が安定した off output を返す。
2. complete technical attestation でも active、enabled、armed、authorized を返さず、
   technicalReadiness: attested と featureState: off を返す。
3. input type と runtime input に authorization、approval state、operator identity が存在しない。
4. extra keys、accessor、symbol、prototype poison、throwing Proxy、invalid JST ISO week、URL、
   path、secret-looking text は exact invalid off result に fail closed する。
5. success と invalid の nested scheduleIntent / blockers を含むすべての output object は
   deeply immutable で exact-key closed である。
6. blockers は unique で上の frozen order を守る。complete input は empty blockers を返す。
7. output は input の URL、path、secret-looking text、attestation detail を含まない。
8. implementation surface は次の四ファイルだけである。

       src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts
       src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.test.ts
       src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts
       src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts

   前二者は追加、後二者は exact historical scope fence の最小更新だけを許す。
   module は named exports だけで、runtime entrypoint から re-export しない。
9. package.json、scripts、plist、schema、migration、worker、delivery、manual preview、
   planner、dormant handler は A8-C0 で変更しない。production registry と handlers は空のまま。
10. UI、MCP、environment variable、CLI、launchd definition、LLM、cache/token behavior、
    automatic intervention を追加しない。
11. static fence は changed-path scope、named exports、forbidden import / require /
    createRequire / re-export token、worker / schema / migration / package scripts / manual preview /
    planner / dormant handler の immutable hash を検証する。
12. typecheck、lint、full suite、historical scope fence、temporary SQLite regression が通る。
    A8-C0 自身の test は DB を必要としない。

## TDD concept map

### A8C0-CG1: closed feature-off input boundary

- Classification: KNOWLEDGE_ONLY
- Boundary: trust
- Test: A8C0-CG1-T1
- Guarantee: valid / invalid のいずれでも featureState は off であり、input type と runtime
  input のどちらからも権限を表現できない。
- Non-guarantee: operator authorization、DB access、scheduler install は実装しない。

### A8C0-CG2: readiness and schedule metadata

- Classification: KNOWLEDGE_ONLY
- Boundary: state
- Test: A8C0-CG2-T1
- Guarantee: blocker order と fixed schedule intent を再現し、complete attestation を
  authorization、binding、health と混同しない。
- Non-guarantee: due scan、catch-up、enqueue の実行は実装しない。

### A8C0-CG3: non-activation surface fence

- Classification: KNOWLEDGE_ONLY
- Boundary: trust
- Test: A8C0-CG3-T1
- Guarantee: four-file scope 以外を変更せず、新 module が prohibited runtime surface を
  import / require / re-export / mutate せず、existing production worker / schema /
  entrypoints を変えない。
- Non-guarantee: future A8-C activation contract の safety を証明しない。

high-risk TDD は test 一件ずつ RED、minimum GREEN、green refactor の順で進める。

## Non-goals

- persistent activation log または re-enable identity の保存
- Prisma schema / migration / real/local DB の変更・適用
- production registry / handler の有効化
- LoopJob enqueue / delivery / one-shot worker の H-CYCLE wiring
- scheduler、launchd、heartbeat、kill switch、uninstall command
- manual A7-C preview の write edge
- UI、MCP、package script、environment variable
- LLM call、cache pre-warm、token accounting、verdict からの自動介入

## Failure policy

technical readiness が complete に見えても featureState を off のまま保つ。input validation
failure、privacy leak、prohibited import / require / re-export、production worker wiring、
schema/migration change、pre-floor backfill、A7-C write edge のいずれも scope failure として
A8-C0 を止め、ADR-0029 と Issue #40 に戻る。

## Rollout

1. A8-C0 の ADR / tests を独立 review して feature-off contract を FROZEN にする。
2. isolated worktree の TDD により pure module と static fence を実装する。
3. CI と sealed code review を通した PR を作成する。merge は本人のみ。
4. merge 後も A8-C0 は off のまま。real activation は operator decision と technical
   evidence gates が揃った別 Issue / branch / PR でだけ扱う。

## 代替案

1. readiness から DB URL / scheduler identifier を受ける: privacy leak と confused-deputy
   boundaryを作るため採らない。
2. readiness complete を enabled と扱う: attestation と operator authority を混同するため
   採らない。
3. A8-B planner を呼んで plan を返す: read-only readiness に execution meaning を混ぜるため
   採らない。
4. 直ちに activation event を persist する: target DB / migration acceptance 前に durable
   operation を始めるため採らない。
5. existing worker registry に H-CYCLE だけ追加する: empty handler map が retry/dead stateを
   mutateし得るため採らない。
