---
type: decision
status: proposed
date: 2026-08-24
tags: [learning-loop, h-cycle, evaluation, schedule, privacy, durability]
source_refs:
  [
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    docs/adr/0027-h-cycle-evidence-evaluation.md,
    docs/adr/0028-h-cycle-manual-preview.md,
    src/lib/loop-jobs/state-machine.ts,
    src/lib/loop-jobs/worker-phase2.ts,
    src/lib/h-cycle-evidence-preview.ts,
  ]
---

# ADR-0029: H-CYCLE の durable evaluation record と opt-in periodic plan を分離する

実装トラッキング: [GitHub Issue #40](https://github.com/shin9898/applied-loop/issues/40)
親: [Harness P0 #24](https://github.com/shin9898/applied-loop/issues/24)
前提: ADR-0025 / ADR-0027 / ADR-0028、H-CYCLE evidence ledger (#34)

## 背景

ADR-0027 は、Textbook Check の logical source revision、Mastery、Gate の状態遷移、
failed Gate の Capture、accepted後のfollow-upを、本文なしのappend-only evidenceとして
残す。ADR-0028 は、その証拠を二つの隣接した完了JST週へ投影する、明示的な
read-only manual previewを定義した。

この二つにより、本人は「この二週に何を主張でき、何を主張できないか」を安全に読む
ことができる。しかしpreviewは意図的に結果を保存せず、schedulerも持たない。そのため、
次の問いにはまだ答えられない。

- どの完了週を、どのpolicy / projection versionで評価したか。
- Mac sleep / restart / duplicate deliveryの後に、どの週が未評価のままか。
- 同じ週を再実行したとき、historical claimが書き換わったのか、同じ観測を確認したのか。

既存のLoopJob substrateはlease、retry、dedupeの基盤を持つ一方、production registryと
handlerは空である。`harness:evaluate-preview` はstdinだけを読むdormant previewであり、
H-EVALのcontrol-plane healthを扱う。H-CYCLEの学習証拠、HarnessRun usage、cache指標を
この経路へ混ぜることは、仮説とcohortを壊す。

したがって「毎週評価する」を、A7-Cのread-only CLIをbackgroundで呼ぶこととして実装しては
ならない。まず、future executionが保存できる最小のaggregate recordと、opt-in scheduleの
identity / catch-up / stop conditionを固定する。

## 決定

### 1. A8を三段階に分ける

| slice | 責務 | このADR時点の状態 |
|---|---|---|
| A8-A | record / schedule / privacy / activation の契約をADRとIssueで固定する | **このADR**。docs-only |
| A8-B | temporary SQLiteだけで、dormantなrecord / planner / handlerをTDD実装する | 未着手。別branch / 別PR |
| A8-C | 本人が選んだlocal DBへopt-in schedulerを有効化し、実地観測する | 未承認。別の運用判断 |

A8-Aはschema、migration、LoopJob registry / handler、worker、scheduler、launchd、UI、MCP、
LLMを変更しない。A8-Bのコードが存在してもA8-Cのactivationを意味しない。

### 2. durable recordは二週のaggregateだけをappend-onlyに保存する

future A8-Bで検討する`HCycleEvaluationRecord`は、target completed weekとその直前週の
**一つのaggregate-only観測**である。A7-Cのmanual previewをwrite-capable commandへ変更せず、
別のhandlerだけがrecordを保存できるようにする。

recordの論理identityは次で固定する。

```text
h_cycle_evaluation_record_v1
  + policyVersion
  + projectionSchemaVersion
  + targetWeekKey
```

`previousWeekKey`、二つのJST period boundary、`asOf`は`targetWeekKey`から純粋に導出する。
callerがprevious weekやcurrent weekを選べない。policy / projection schemaを修正する場合は
versionを上げ、新しいrecordとして残す。既存recordをupdate / delete / replaceしない。

保存を許可するfieldは次だけである。

```text
id (opaque)
recordSchema = h_cycle_evaluation_record_v1
policyVersion
projectionSchemaVersion
previousWeekKey, targetWeekKey
previousPeriod { start, end, asOf }
targetPeriod   { start, end, asOf }
scheduledFor
evaluatedAt
triggerKind = scheduled | catch_up
timeliness = on_time | catch_up
aggregateEnvelopeJson (closed h_cycle_evidence_preview_v1 schema only)
aggregateEnvelopeSha256
recordSha256
createdAt
```

`aggregateEnvelopeJson`はA7-Cと同じ二週projectionとpolicyのclosed schemaを通った場合だけ
保存できる。個別ID、source revision hash、Gate / Capture / Misconception row、answer、question、
reference、diff、conversation、prompt、secret、DB URL、driver message、stackは含めない。

同じidentityのrecordが既にあるとき、retryは保存済み`aggregateEnvelopeSha256`と再計算値が
一致する場合だけ成功として扱う。不一致は`evaluation_record_integrity_failure`として止め、
既存recordを書き換えない。これにより、crashがrecord insert後・LoopJob成功更新前に起きても、
at-least-once deliveryはduplicate historyを作らない。

`asOf`はADR-0027どおり各weekのendに固定する。評価が後日に起きても、その後のmutable stateを
過去へ混入させない。後からbackdated evidenceが見つかりdigestが変わる場合も、都合よく上書き
せずintegrity failureとして調査する。

### 3. future LoopJob payloadには狭い`iso_week`型を使う

現行`LoopJob` registryのfield型は`opaque_id` / `enum` / `hash`だけであり、week keyを
reversibleに運べないhashだけをpayloadに置くとhandlerがtarget periodを再構成できない。A8-Bは
generic string fieldを足さず、calendar metadata専用の狭い`iso_week`型を追加する場合だけ、
次のclosed payloadを許可する。

```text
kind = h_cycle_evaluate
version = v1

payload = {
  hypothesis: h_cycle,
  cadence: weekly,
  targetWeekKey: YYYY-Www,
  policyVersion: h_cycle_evidence_v1,
  projectionSchemaVersion: h_cycle_evidence_preview_v1
}
```

すべてのfieldをdedupe projectionに含める。`previousWeekKey`とperiodはhandlerが導出する。
payloadへDB URL、raw evidence、record JSON、individual ID、answer / question / referenceを
入れない。current clockだけに依存するjob、free-form string、page visit / morning briefingを
scheduler sourceとする案は採らない。

### 4. schedule intentとcatch-upを明示する

future A8-Cのweekly due timeは、just-completed target weekに対する**月曜 08:15 JST**とする。
これはA7-Cのmanual invocation時間ではなく、schedulerが評価jobをenqueueしてよい最初の時刻である。

opt-in状態はfuture persistent activation logで持つ。enable eventは`activationFloorWeekKey`を
必ず含み、disable eventはその後のschedule scanを止める。activation floorより前のhistoryを
自動でbackfillしない。re-enableは新しいexplicit floorを持つ別eventとする。

schedule scanはactive floor以後のclosed target weekを古い順に探索し、**一回のscanで一件だけ**
enqueueする。これによりsleep / restart後もeventual catch-upはできるが、長期停止後に無制限の
backlogを一度に作らない。duplicate scan / deliveryは同じLoopJob dedupe keyに収束する。

recordは`scheduledFor`と実際の`evaluatedAt`を両方持つ。`evaluatedAt <= scheduledFor + 5分`を
`on_time`、それ以外を`catch_up`と分類する。late recordをon-timeに塗り替えず、weekを飛ばして
未実行を隠さない。catch-upが古い週の`inconclusive`を返しても、policyを緩めず観測として残す。

```text
operator explicit enable
        │ append-only activation floor
        ▼
opt-in schedule scan ── one oldest due week ──▶ LoopJob(h_cycle_evaluate)
                                                  │ at-least-once delivery
                                                  ▼
                                  isolated evidence snapshot + pure A7 projection
                                                  │ aggregate only
                                                  ▼
                                append-only HCycleEvaluationRecord

No edge: A7-C manual CLI → write
No edge: verdict → Gate/Capture/Misconception/notification/intervention
No edge: page visit / briefing / after() → schedule authority
```

### 5. read snapshotとrecord writeの責務を分ける

A7-Cはfresh readonly clientでevidence snapshotを読む。A8-B handlerはこのquery surfaceを
re-useしても、manual CLIをimport / invokeしない。read phaseはA7-Cと同じprivacy-minimized
five relationだけを投影し、pure functionとtwo-week policyを一回ずつ実行する。

record insertは別の狭いwrite boundaryで行う。成功時にだけaggregate recordをinsertし、
duplicate時はhash equalityを検証する。domain evidence、Gate、Capture、Misconception、review、
activation state以外の書込みは同一handlerから禁止する。query失敗、policy schema validation失敗、
hash mismatch、record insert failureは`LoopJob`のclassified failureになり、成功・0%・空recordへ
丸めない。

### 6. H-CYCLEのrecordはH-EVAL / cacheと別cohortに保つ

H-CYCLE recordが持つのは学習証拠の週次projectionだけである。H-EVALのscheduler health、
HarnessRun usage、H-CACHE reuse / fresh-input metrics、LLM evaluator budget、finding precisionを
recordへ混ぜない。H-CYCLE handlerはLLMを呼ばず、token budgetを予約せず、cache pre-warmや
prompt templateを変えない。

`baseline_collecting` / `inconclusive` / `supported` / `rejected`はrecordのpolicy observationであり、
automatic interventionの許可フラグではない。supported / rejectedであってもGate生成、Capture
triage、Misconception更新、review schedule変更、通知を起動しない。

## A8-B受入テスト

1. `iso_week`は実在するJST ISO weekだけを受け、invalid week / extra field / generic stringを
   registry decode前に拒否する。payloadとdedupe keyは同一inputでbyte-stableであること。
2. target weekからprevious weekと二つの`[start,end)` / `asOf=end`を導出し、年跨ぎでもcallerが
   任意のpairを選べないこと。
3. temporary SQLiteだけで、同一jobのduplicate delivery、record insert後のcrash、stale lease
   recovery、hash-equal retry、hash-mismatch retryを検証する。recordは一件のまま、mismatchは
   silent rewriteしないこと。
4. activation floorより前をenqueueしないこと。sleep / restartのcatch-upはoldest missing weekを
   一件だけenqueueし、on-time / catch-up分類を保持すること。
5. manual `harness:preview-cycle-evidence`はDB / sidecar不変のままであり、A8-Bがmanual CLIへ
   write edgeを追加しないこと。
6. record JSONとLoopJob payloadに、raw text、individual ID / hash、DB URL、driver stack、
   answer / question / reference / Capture本文が入らないこと。
7. A2/A3/A4/A5/A6/A7-B/A7-C coexistence fence、typecheck、lint、full suite、temporary SQLite
   Prisma validationを通す。worker / launchd / real DB / `.env` / LLMはtest外で起動しない。

## activation gateと停止条件

A8-Cは次をすべて満たすまで開始しない。

1. このADRとIssue #40のdocs-only PRがreview / mergeされている。
2. A8-Bのdormant implementationがtemporary SQLiteで上の受入テストを通し、production registryを
   無断で有効化していない。
3. worker heartbeat、disable / uninstall path、crash / sleep recoveryをA2の運用evidenceとして
   先に定義し、current empty registryをactivation済みと扱わない。
4. 本人が対象local DBと明示opt-in / disableを選び、少なくとも二つのA7-C manual observationを
   実地で確認している。
5. 最初のreal recordは観測として読み、policy自身のeligibilityより早くsupport / rejectや
   operational interventionを宣言しない。

privacy leak、duplicate domain side effect、record hash mismatch、pre-floor backfill、manual previewの
write、schedulerの無断install、LLM / token budgetの混入が一つでも起きたら、policyを緩めずA8-B/Cを
停止してADRへ戻る。

## 代替案とトレードオフ

1. **A7-Cのstdoutを保存する**: manual read-only契約を壊し、callerの任意DB URLをwriteへ広げるため
   採らない。
2. **H-EVALのEvaluationRunを使い回す**: control-plane healthとlearning evidenceのcohortを混ぜ、
   verdictの意味が壊れるため採らない。
3. **weekをhashだけでLoopJobへ渡す**: handlerがperiodを復元できず、current weekへの暗黙fallbackを
   誘発するため採らない。
4. **latest dashboard rowをupsertする**: late evidenceやretryでhistorical claimが無言に書き換わるため
   採らない。
5. **page load / morning briefing / `after()`をschedule sourceにする**: process終了後の実行保証と
   catch-upを持たないため採らない。
6. **最初から週次launchdを有効化する**: A2 operational evidence、kill switch、real DB choiceを
   先取りするため採らない。

## Rollout

1. A8-AとしてこのADRをdocs-only PRでreviewする。Issue #40はA8-B/Cが終わるまでopenのまま残す。
2. A8-Bは新しいisolated branchで、pure schedule identity / temporary SQLite record boundary /
   dormant fenceをRED→GREENで実装する。manual previewを変更しない。
3. A8-B PRがmainへ入ってもschedulerはdisabledのままとする。
4. A8-Cは本人がlocal target DB、enable、disable pathを明示承認した場合だけ、one-shot observability
   から開始する。Codexはlaunchd install、scheduler enable、real DB previewを自律実行しない。
