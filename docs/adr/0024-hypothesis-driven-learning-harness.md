---
type: decision
status: proposed
date: 2026-08-21
tags: [harness, learning-loop, evaluation, prompt-cache, jobs, observability]
source_refs:
  [
    docs/product-brief.md,
    docs/adr/0006-comprehension-gate.md,
    docs/adr/0009-harness-comprehension.md,
    docs/adr/0017-prompt-cache-savings-pack.md,
    docs/adr/0020-daily-retro-knowledge-loop.md,
    docs/adr/0022-harness-pack-canon-moves-to-llm-config.md,
    src/lib/gate.ts,
    src/lib/gate-answer.ts,
    src/lib/harness-stats.ts,
    src/lib/harness-patterns.ts,
    scripts/collect-harness.mjs,
  ]
---

# ADR-0024: 仮説駆動・cache-aware な学習ループハーネスと定期自己評価

実装トラッキング: [GitHub Issue #24](https://github.com/shin9898/applied-loop/issues/24)
（roadmap [#18](https://github.com/shin9898/applied-loop/issues/18) のsub-issue）

## 背景

Applied Loop は、commit の材料化、Gate、日次教科書、Capture、Misconception、
HarnessRun という部品を既に持つ。一方、2026-08-21 のコード・live DB 調査では、
「材料が届く」ことと「理解確認から再出題・適用まで閉じる」ことが分離していた。

read-only 観測スナップショット:

| 観測 | 値 | 含意 |
|---|---:|---|
| DevEvent | 641 | commit 材料の入口は動作 |
| `skipReason=backlog` | 592 | 即時 Gate は実質的に恒久停止しうる |
| 2026-08-21 の DevEvent | 45、全件 backlog | 当日の即時 Gate 発火 0 |
| pending Gate | 10（cap は 5） | 古い initial/module が全体を塞ぐ |
| Daily / Weekly Check | 76、回答済み 0 | 日次本線が習慣として閉じていない |
| open Misconception | 6 | 全件 `nextReviewAt=null`、5件は active Gate なし |
| turns>=2 の HarnessRun | 498 | briefing 利用 3、capture 1、application 0 |

ここから導けるのは完成判断ではなく仮説である。即時 Gate を毎 commit に戻すことも、
永続 worker を入れれば自動的に学びが深まることも、まだ証明されていない。

また、cache 観測には評価前提を壊す provider 差があった。

- Claude の `input_tokens` は cache read / creation と別カウンタであるため、既存式
  `cacheRead / (tokensIn + cacheRead + cacheCreate)` で全入力を再構成できる。
- Codex collector は total `input_tokens` を `tokensIn` に保存し、その部分集合である
  `cached_input_tokens` も `cacheRead` に保存する。既存式は cached input を二重加算する。
- 同じ2026-W34データを provider semantics で正規化すると参考値は
  Claude 98.231%、Codex 96.162% だが、既存式では Codex 49.022% になる。

したがって「cache 改善」を評価する前に、usage の意味論・collector version・
比較segmentを固定しなければならない。単一の全体cache率をKPIにすると、client/model
構成比の変化を施策効果と誤認する。

## 決定

本ADRを、最終方式の確定ではなく **versioned experiment charter** として採択候補にする。
以下を順に実装し、反証可能な評価を定期実行する。仮説が支持されるまでは
ADR status を `proposed` のままにする。

### 1. 設計原則

1. 開発作業は止めない **fail-open**、学習債務と評価失敗は消さない **fail-loud**。
2. agentはユーザーの理解度回答を代行しない。自動化は発火・配信・回復・評価まで。
3. 会話本文を読まない。保存するのはmetadata、構造化されたユーザー承認候補、hashのみ。
4. 数値計算・不変条件検査はdeterministicに行い、LLMは解釈が必要な差分だけに使う。
5. static prefixを先頭、repo・日時・diff・回答などのdynamic payloadを末尾に置く。
6. cache率だけを最適化しない。学習loopのclosureと品質をguardrailにする。
7. page visit、morning briefing、次回commitをschedulerやqueue drainの正本にしない。

### 2. 検証する仮説

閾値は初期仮説であり、`policyVersion`を上げずに書き換えない。

| ID | 仮説 | 支持条件 | 反証・停止条件 |
|---|---|---|---|
| H-JOB | durable outbox + worker なら生成・採点・復習がprocess境界を越えて回復する | eligible 2週連続でjob成功率>=99%、p95完了<=5分、orphan=0 | crash/restartで仕事が消える、同一副作用が重複、orphanが1件でも再発 |
| H-CYCLE | Textbook Checkをrubric採点可能なGateへ接続すれば自己申告より理解証拠が増える | 2週連続でgraded check回答率>=50%、failed checkの100%にtriage/次回予定、cycle close率が基準週より改善 | 回答率/closureが基準より10pp以上悪化、回答なしでclear可能、stuck導線が孤立 |
| H-ADAPTER | 実行可能なsession start/end adapterならprompt依存よりloop接続率が上がる | supported clientでstart ACK>=95%、close ACK>=90%、重複briefing=0 | sentinelだけ進む、未ACKを成功扱い、session開始latency p95が500ms超悪化 |
| H-CACHE | byte-stable prefix + versioned prompt templateならharness追加後もcache再利用を維持しfresh inputを抑えられる | baseline>=90% cohortはcache率-1pp以内かつfresh input/turn悪化<=5%。baseline<90% cohortは+5ppまたはfresh input/turn 10%以上改善 | cache writeだけ増えreadが増えない、prefix hashが意図なく変化、学習guardrail悪化 |
| H-EVAL | deterministic-first評価なら低tokenで異常を早期検出できる | daily/weeklyのon-time実行>=99%、sleep後catch-upを含む最終未実行=0、LLM評価<=5call/週かつfresh input<=50k/週 | 評価job自身が滞留、同一finding乱造、budget超過、判定済みfindingが4件以上でaccept precision<50% |

H-CACHEが反証されてもH-JOBの耐久化を撤回しない。各仮説のdecisionを分離し、
cache指標だけで学習loop全体を採否しない。

### 3. 目標アーキテクチャ

```text
 Claude / Codex / Cursor / Windsurf
              │
              │ start / close / commit / answer
              ▼
 ┌──────────────────────────────────────────┐
 │ Command API / MCP                        │
 │ sync_learning_loop / close_session       │
 │ answer_gate / record_intervention        │
 └──────────────────┬───────────────────────┘
                    │ domain write + enqueue（同一tx）
           ┌────────┴─────────┐
           ▼                  ▼
 ┌────────────────┐   ┌────────────────────┐
 │ Domain State   │   │ LoopJob Outbox     │
 │ Material       │   │ queued / running   │
 │ LearningCycle  │   │ retry_wait / dead  │
 │ Gate           │   │ succeeded          │
 │ Misconception  │   └─────────┬──────────┘
 │ Intervention   │             │ lease / retry
 │ EvaluationRun  │<────────────┤
 └───────▲────────┘             ▼
         │              launchd Loop Worker
         │                       ▲
         └──────── hourly Watchdog┘
                  （LLMなし・missed run検出）
```

watchdog はworkerと別processにする。workerが停止した時にworker自身へ復旧を期待しない。
Macのsleep/停止中に期限を過ぎた場合は、起動後にperiod dedupe keyで1回だけcatch-upする。

### 4. 状態とデータモデル

#### `LoopJob`

- `kind`
- `dedupeKey @unique`
- `payloadJson`
- `status`: `queued / running / retry_wait / succeeded / dead`
- `attempts / maxAttempts / nextRunAt`
- `lockedAt / lockedBy / lastError`
- `createdAt / completedAt`

生成、採点、capture scoring、due review、daily textbook、evaluation、reconcileを対象にする。
Next `after()`は任意のwake-upに降格し、耐久性の正本にしない。

#### `HarnessRun` usage normalization

raw値を残したまま、次を追加または同等のderived layerで固定する。

- `inputTotalTokens`
- `inputUncachedTokens`
- `cacheReadTokens`
- `cacheWriteTokens`（sourceに無い履歴は`null`。0と断定しない）
- `usageSemanticsVersion`
- `collectorVersion`
- `contextFingerprint`（global/repo prefix・tool manifest・template versionのhash。本文なし）

変換規則。`inputUncachedTokens`は、writeが観測できる場合はreadにもwriteにも属さない
通常inputを表す。write telemetryが無いsourceでは`total - read`を保守的に格納し、
`cacheWriteTokens=null`と`usageSemanticsVersion`で「write内訳不明」を明示する。

| source | total | uncached | read | write |
|---|---|---|---|---|
| Claude | `input + cacheRead + cacheCreate` | `input` | `cacheRead` | `cacheCreate` |
| Codex/OpenAI、write既知 | `inputTotal` | `total-read-write`（負ならinvalid） | `cachedInput` | `cacheWriteTokens` |
| Codex/OpenAI、write不明 | `inputTotal` | `total-read`（負ならinvalid） | `cachedInput` | `null` |

差分が負になるrowは0へclampせず、usage semantics違反として集計から除外し、理由を残す。

#### `HarnessIntervention`

- `kind`: `stable_prefix / tool_manifest / prompt_template / adapter / other`
- `repo / harness / modelScope`
- `applicationId?`
- `beforeFingerprint / afterFingerprint`（内容は保存しない）
- `appliedAt / policyVersion`
- `status`: `planned / active / rolled_back / completed`

適用後+7日、+14日のevaluation jobをenqueueする。介入記録が無い前後比較は
因果推論せず`inconclusive`にする。

#### `HarnessEvaluationRun`

- `hypothesisKey / scopeType / scopeKey`
- `baselineStart / baselineEnd / observationStart / observationEnd`
- `policyVersion / collectorVersion / inputSnapshotHash`
- `sampleSize / metricsJson / guardrailsJson`
- `verdict`: `supported / rejected / inconclusive`
- `decisionStage`: `provisional / final`
- `reasonCode`
- `evaluatorMode`: `deterministic / llm_assisted`
- `promptTemplateVersion / promptPrefixHash`
- `freshInputTokens? / cacheReadTokens? / cacheWriteTokens?`
- `outputTokens? / usageAttribution`: `observed / estimated / unavailable`
- `scheduledFor / startedAt / completedAt`

`hypothesisKey + scopeKey + observationEnd + policyVersion`をdedupe単位にする。

#### `HarnessEvaluationBudget`

- `weekKey @unique`
- `callLimit / freshInputLimit`
- `callsReserved / freshInputReserved`
- `callsObserved / freshInputObserved / outputObserved`
- `updatedAt`

LLMをspawnする前に1 call分と保守的なinput上限をtransaction内で予約し、結果のusageで精算する。
現行`headless-llm`は本文しか返さないため、Claude `--output-format json`とCodex `--json`を
provider別にparseしてusageを構造化する。usageを取得できないprovider/modelでは
`usageAttribution=unavailable`とし、token条件をsupported判定に使わない。

#### `RuntimeHeartbeat`

worker、watchdog、collectorごとに`lastSeenAt / lastSuccessAt / lastError`を持つ。
「plistが存在する」ではなく期限内heartbeatを稼働判定にする。

### 5. 評価指標の定義

provider、model、repo、`contextFingerprint`、`collectorVersion`を跨いで単純合算しない。
窓内の集計segmentは原則
`(harness, model, repo, contextFingerprint, usageSemanticsVersion, collectorVersion)` とする。
prefix介入ではfingerprint自体が変わるため、`HarnessIntervention`に記録した
`beforeFingerprint → afterFingerprint`だけをmatched cohortとして比較する。

| 指標 | 定義 |
|---|---|
| `cacheReuseRate` | `cacheReadTokens / inputTotalTokens` |
| `freshInputRate` | `(inputTotalTokens - cacheReadTokens) / inputTotalTokens`。write既知時は`(ordinary uncached + write) / total`と一致 |
| `freshInputPerTurn` | fresh input / turns。turns=0は別segment |
| `cacheWriteShare` | writeが既知の時だけ `write / (read + write)`。単独ではwasteと断定しない |
| `unreusedCacheWrite` | 同一provider/model/prefixのTTL窓で後続readに回収されなかったwrite。request-level対応が可能な場合だけ算出 |
| `jobSuccessRate` | terminal jobの`succeeded / (succeeded + dead)` |
| `jobLatencyP95` | `createdAt → completedAt` |
| `orphanMisconceptions` | open/regressedで`nextReviewAt`もactive Gateも無い件数 |
| `verifiedCheckRate` | graded Daily/Weekly Check / 全Check（parked除外も併記） |
| `cycleCloseRate` | close条件を満たしたLearningCycle / due Cycle |
| `adapterAckRate` | ACK済みstart/close / 検出session |
| `evaluationFreshTokens` | evaluatorが新規処理したinput。read/writeを別記 |

モデル変更、collector semantics変更、prefix介入以外の大規模tool変更、sample不足は
confounderとして記録し、無理にpass/failへ落とさない。

### 6. 判定ロジック

```text
 due EvaluationRun
       │
       ▼
 [eligibility]
 sample / semantics / segment / intervention を確認
       │
       ├──不足・confounded──> inconclusive（LLMなし）
       ▼
 [deterministic metrics + guardrails]
       │
       ├──変化なし/正常────> verdict保存（LLMなし）
       └──閾値越え/説明必要
                         │ token budgetを予約
                         ▼
              週次batch LLM（最大5 scopeを1回）
                         │
                         ▼
          evidence付きCapture候補 / verdict補足
```

LLMに数値判定を委ねない。LLM出力でdeterministic verdictを上書きしない。
LLMは「考えられる原因」「確認すべき設定」「一次情報へのポインタ」の補足だけを行う。

判定は1窓でADRを`accepted`にしない。原則としてeligibleな2連続窓で
`decisionStage=final`のsupported/rejectedへ昇格し、1窓目は
`decisionStage=provisional`として保存する。ただしデータ消失、重複副作用、privacy違反、
budget超過は1回で停止条件とする。

#### 実験プロトコル

1. provider semanticsを正規化した14日baselineを作る。変換不能な履歴を0埋めせず除外理由を残す。
2. worker/evaluatorを最初の7日間はshadow modeで動かし、既存UXを変えずjob・miss・tokenだけ測る。
3. cache介入は一度に1つのrepo/harness cohortへ適用し、可能なら未介入cohortを同期間controlにする。
4. +7日は安全性、+14日は効果を見る。曜日を揃え、sample不足・model変更・collector変更は
   `inconclusive`にする。
5. guardrail悪化または停止条件で自動適用を止める。設定のrollback自体は本人承認後に行う。

single-userのpre/post観測なので強い因果を主張しない。支持条件は「この環境で次のsliceへ
進む根拠」、反証条件は「方式を再設計する根拠」として扱う。

### 7. 定期発火

| cadence | 実行 | LLM |
|---|---|---|
| worker heartbeat | 1分以内 | なし |
| watchdog | 1時間ごと + 起動時catch-up | なし |
| daily | 08:05 JSTまたは当日最初のsyncでcatch-up。job/invariant/adapter/collector確認 | なし |
| weekly | 月曜08:15 JST。cache・closure・job・adapterを前週と比較 | anomaly時のみ、最大5 scopeを1 batch call |
| intervention | 適用+7日、+14日 | 7日は原則なし、14日は説明必要時のみ |
| monthly meta-eval | 第1月曜。miss率、finding accept率、budget、閾値churnを評価 | 最大1call |

同一期間のdedupe key例は`evaluate:h-cache:repo:2026-W34:v1`とする。
morning briefingが呼ばれなくても発火し、briefingは結果を読むだけにする。

### 8. cache-aware prompt contract

OpenAI/Anthropicの一次資料はいずれも、cache hitにはexact prefix matchが必要で、
static instructions/tools/schemaを先頭、variable contentを末尾に置くとしている。

Applied Loop内のGate生成、採点、harness評価promptを次の形へ統一する。

```text
 ┌─────────────────────────────────────┐
 │ stablePrefix                        │
 │ role / rules / rubric / JSON schema │ ← byte-stable + version + SHA-256
 │ examples / safety constraints       │
 ├──────────── cache boundary ─────────┤
 │ dynamicSuffix                       │
 │ requirements / goals / repo / date  │
 │ diff / question / answer / metrics  │
 └─────────────────────────────────────┘
```

- templateは`templateId + version`で管理し、stable prefix hashのgolden testを持つ。
- timestamp、Gate ID、repo、active goals、requirementsをstable prefixより前へ置かない。
- tools/schemaの順序も固定する。
- CLI providerではexplicit breakpoint/keyを制御できると仮定しない。
  capabilityを`unknown / implicit / explicit`で記録し、実測で判定する。
- direct API adapterはopt-inの後続案。API keyや従量課金をcore前提にしない。
- cache pre-warmは既定で行わない。TTL内の再利用見込みとwrite/read比が無いpre-warmは
  token消費を増やすため禁止する。
- cacheable最小長に届かせる目的だけでpromptをpaddingしない。追加tokenを上回る実測利益が
  無い限り、短いpromptは短いままにする。
- 週次/月次evaluatorはproviderの通常TTLを越えるため、前回評価からのcache reuseを前提にしない。
  evaluatorの第一の節約策はLLMを呼ばないこと、第二は全anomalyを1回にbatchすることとする。
- LLM budgetは週key単位でtransactionalに予約する。枯渇時はdeterministic verdictだけを保存し、
  `budget_exhausted`をreasonとしてfail-loudに残す。
- 共有AGENTS/CLAUDE/Cursor prefixはADR-0022の正典を参照し、Applied Loopから
  force-writeしない。介入は提案→本人適用→fingerprint記録→再評価の順にする。

### 9. 学習loopへの接続

ADR-0020の日次中心方針は維持する。即時Gateを全commitへ戻さない。

```text
 commit / close_session
        │
        ▼
     Material
        │
        ├── high signal ──> immediate Gate（repo/session最大1）
        │
        └── normal ───────> Daily Textbook ─> graded Gate 3〜5問
                                                    │
                                            pass / partial / fail
                                              │             │
                                        spaced review   Capture triage
                                              │             │
                                              └── Misconception ──> retry
                                                                  │
                                                        Application / re-observe
```

短期移行では新しいUnderstandingAttempt tableを一気に作らず、既存Gateへ
`daily / weekly` kindとdedupe/versionを追加し、Daily/Weekly Checkから`gateId`で接続する。
Masteryはgradeから派生し、自己感触は別confidenceとして残す。

### 10. ADRの自己評価と昇格条件

このADR自身も月次meta-evalの対象にする。

- scheduled EvaluationRunのmiss率
- findingのaccept / ignored / pending
- evaluator token budget
- policyVersion変更頻度
- 同じfindingの再発率
- 介入後に測定可能なsegmentが作れた割合

H-JOB/H-EVALが2連続窓で支持され、H-CACHEがnon-inferior以上になった時点で
control-plane部分をaccepted候補にする。H-CYCLE/H-ADAPTERは#5/#13を含む実地完走後に
判定する。全仮説を一括でacceptedにしない。

## 理由

- promptやskillだけでは、実行・ACK・retry・回復を保証できない。
- LLM評価を毎session走らせると、節約対象のharnessが自らtokenを浪費する。
- provider横断のraw token列は意味が異なり、正規化前の比較は誤診を生む。
- cache改善だけを目的にすると、短いpromptだが学習が閉じない局所最適になりうる。
- durable jobとversioned EvaluationRunがあれば、失敗も仮説反証も履歴として残せる。

却下した案:

| 案 | 却下理由 |
|---|---|
| AGENTS/skillsを増やすだけ | advisoryであり実行保証・復旧・評価履歴がない |
| 毎commit即時Gateへ戻す | ADR-0020で確認済みの量的破綻を再導入する |
| 毎session LLM evaluator | token消費、finding乱造、deterministic判定の不透明化 |
| direct provider APIを必須化 | API key・従量課金・retention差を新たな導入障壁にする |
| 全repo一括stable-prefix適用 | 因果比較ができず、本人承認・既存ルール所有権にも反する |
| 全provider合算cache率 | usage semanticsとmodel/repo mixの差を施策効果と誤認する |
| morning briefingをcron代わりにする | 呼ばれない日には評価も復旧も走らない |

## 結果・トレードオフ

得られるもの:

- process終了を越えるGate生成・採点・評価
- 仮説、介入、反証、guardrailを同じ履歴で追える
- cache改善と学習closureを同時に評価できる
- deterministic-firstによる評価token上限
- worker停止や評価未実行そのものの検知

コスト・意図的に失うもの:

- Prisma model、worker、watchdog、launchd、migrationの運用複雑性
- single-user pre/post観測なので、すべての因果を強く証明できるわけではない
- 十分なsampleが無い仮説は`inconclusive`のまま残る
- direct APIのexplicit cache controlは初期scope外
- stable prefixは本人承認なしに自動適用しない

## 出典

- ADR-0009 ハーネス理解ループ
- ADR-0017 / ADR-0022 安定prefix規約と正典分離
- ADR-0020 材料→日次教科書→Checkへの重心移動
- 2026-08-21 read-only repo / live DB / launchd調査
- OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching
- Anthropic Prompt Caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
