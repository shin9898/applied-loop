---
type: decision
status: proposed
date: 2026-08-24
tags: [learning-loop, h-cycle, evidence, evaluation, privacy]
source_refs:
  [
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    docs/adr/0026-textbook-check-gate-bridge.md,
    prisma/schema.prisma,
    src/lib/daily-textbook.ts,
    src/lib/weekly-textbook.ts,
    src/lib/gate.ts,
    src/lib/capture.ts,
  ]
---

# ADR-0027: H-CYCLE を論理 source revision の証拠で評価する

実装トラッキング: [GitHub Issue #34](https://github.com/shin9898/applied-loop/issues/34)
親: [Harness P0 #24](https://github.com/shin9898/applied-loop/issues/24)
前提: ADR-0026 / Textbook Check→Gate bridge

## 背景

ADR-0026 は、`partial` / `stuck` という自己申告を本人の明示操作により
`textbook_check` Gate へ昇格し、immutable origin、回答、既存採点、Capture triageを
経由させる。これは「自己申告を理解証拠にしない」ための必要な入口である。

ただし、入口があるだけでは H-CYCLE を支持・反証できない。特に日次の
`source="auto"` Check は再生成時に削除・再作成される。現在の Check 行を後から読むだけでは、
削除された source revision、いつ自己申告が付いたか、またはその revision が Gate へ
明示昇格されたかを再構成できない。`TextbookCheckGateOrigin` は promotion 済みの
revision を保存するが、promotion されなかった Check の分母を保存しない。

そのため、現在の行数、`mastery="clear"`、pending Capture、LLM errorを成功へ丸める
集計は不正確である。A5 の HarnessRun usage evidence と A3 の H-EVAL job health は
別仮説・別コホートであり、この不足を埋めない。

## 決定

### 1. 評価単位は Check ID でなく logical source revision とする

以下を同一なら同じ logical source revision と定義する。

```text
sourceKind + textbookKey + source + checkIndex + sourceRevisionHash
```

- `sourceKind`: `daily` / `weekly`
- `textbookKey`: `dateKey` / `weekKey`
- `source`: daily は `auto` / `compiled`、weekly は sole writer により `auto`
- `checkIndex`: その書の論理スロット
- `sourceRevisionHash`: server 側で versioned canonical source projection から求める SHA-256

`sourceRevisionHash` は ADR-0026 の Gate origin と**同一の値**を使う。ただし A7 は
Gate を作らないため、pure helper を `TextbookCheckSourceRevisionV1` として分離する。
同じ有効な source input に対し、helperの `sourceRevisionHash` は
`createTextbookCheckGateOriginV1(input).sourceRevisionHash` と完全一致しなければならない。
second hash / version mapping / 類似度結合を定義しない。必要ならA6のcanonical source-snapshot
計算を共有化し、`TextbookCheckGateOrigin` とは5-field identityでstrictに結ぶ。

hash の入力は source identity、question hash、chapter index、bounded chapter/reference
projection、schema versionである。answer、diff本文、会話本文、prompt本文、secretを入力にも
保存先にも含めない。

日次再生成で同じ logical revision が復元された場合は同じ観測行を再利用する。
question/reference が変われば別 revision となり、旧観測を更新・削除・置換しない。

### 2. 観測と自己申告イベントを分離して prospective に残す

次の二つを将来の A7 implementation で additive に保存する。これは Gate の自動作成ではなく、
既存の教材生成・本人の Mastery 保存に付随する最小の local evidence 記録である。

```text
TextbookCheckEvidence
  id
  sourceKind, textbookKey, source, checkIndex, chapterIndex?
  sourceRevisionHash, questionHash
  firstObservedAt
  UNIQUE(sourceKind, textbookKey, source, checkIndex, sourceRevisionHash)

TextbookCheckMasteryEvent
  id
  evidenceId -> TextbookCheckEvidence
  mastery: clear | partial | stuck | parked
  recordedAt
  INDEX(evidenceId, recordedAt)
```

`TextbookCheckEvidence` には source body/reference JSONを複製しない。`questionHash` は
revision の監査用であり、question 本文ではない。`TextbookCheckMasteryEvent` は本人が既存の
authenticated Mastery 操作を保存したときだけ append する。page visit、briefing、教材生成、
scheduler、worker、Gate pollingは Mastery event を作らない。

生成側は Check を保存する同一 transaction で evidence を upsert する。対象は日次 `auto`、
日次 `compiled`、週次の全 production writer であり、一つでも観測しない経路を作らない。
Mastery 保存側は現在の Check を server で再読して revision identity を再計算し、同じ
transaction で evidence を upsert してから event を append する。client は revision hash、
question、reference、timestampを渡さない。

rollout前に作成された既存 Check に evidence が無い場合、その最初の explicit Mastery save は
save時刻で初めて観測した evidence を作る。元の生成日時を推測して過去 period へ backfill
しない。baseline は ledger rollout後の `firstObservedAt` だけから始める。source を再読できない、
hash が一致しない、mastery が列挙外の場合は event を推測作成せず fail-loud にする。

### 3. projection は純粋・read-only・コホート明示とする

`projectHCycleEvidenceV1(input)` は DB client、時計、LLMを持たない pure function とする。
DB/CLI adapter は必要最小限の hash、timestamp、status、relation IDだけを読み、その入力を
渡す。結果には period、as-of、policy version、各 denominator、unknown/integrity countsを
必ず含める。

率は次の union を使い、分母0を `0%` と表示しない。

```ts
type EvidenceRate =
  | { status: "measured"; numerator: number; denominator: number; ratio: number }
  | { status: "not_applicable"; numerator: 0; denominator: 0; reason: "zero_denominator" }
  | { status: "incomplete"; numerator: number; denominator: number; reason: string };
```

同じ画面・JSONに異なる母集団を暗黙に割り算しない。少なくとも以下の cohort を別名で
出力する。

| metric | numerator | denominator | cohort / as-of |
|---|---|---|---|
| `selfAssessmentRate` | 1回以上 Mastery event がある revision | period 中に firstObserved された revision | period end |
| `actionableCheckCount` | 該当なし（count） | 該当なし | period end 時点で最新 Mastery が `partial` / `stuck` の revision |
| `explicitPromotionRate` | matching `TextbookCheckGateOrigin` がある actionable revision | period end 時点の actionable revision | period end |
| `answeredPromotedGateRate` | `answeredAt` がある promoted Gate | period 中に origin を作った Gate | as-of |
| `gradedPromotedGateRate` | status が `passed` / `failed` の promoted Gate | period 中に origin を作った Gate | as-of |
| `failedTriageRate` | fail Gate ごとに、関連 Capture が少なくとも1件あり全件 terminal (`accepted` / `ignored`) | terminal failed promoted Gate | as-of |
| `scheduledFollowupRate` | accepted gate Capture が Misconception を持ち `nextReviewAt` 非null | accepted gate Capture | as-of |
| `evidenceClosureRate` | `passed` Gate、又は `failed → accepted Capture → nextReviewAt` | period 中に origin を作った Gate | as-of |

`explicitPromotionRate` は current actionable snapshot の conversion であり、遅延した promotion を
過去週へ暗黙に戻さない。`answered` / `graded` / `closure` は promotion cohort の追跡値であり、
`asOf` と一緒に読む。これにより、遅い回答を0%と断定せず、逆に後日の回答で過去のレポートを
無言に書き換えない。

### 4. failure / unknown は success と混ぜない

次は measured success ではない。

- `clear` の自己申告だけ
- `pending` / `answered` / `grading` / `grading_failed` Gate
- `pending` Capture
- `ignored` Capture（triage済みではあるが、scheduled follow-up / evidence closure ではない）
- failed Gate に Capture が見つからない場合
- source hash、origin hash、`sourceContext`→gate ID、Capture→Misconception relation の不一致
- period end以後の current stateを過去 period のterminal outcomeとして利用する場合

Capture は gate ID を `parseGateSourceContext` と同じ strict parser で照合する。
概念名の類似や answer本文からの推測で Capture を結び付けない。既存の dedupe により
新 Capture が作られなかった failed Gate は、human triage がこの Gate に対して観測できないため
`missing_gate_capture` として明示する。success へ補完しない。

### 5. H-CYCLE policy は deterministic で、最初の二週間は結論を出さない

policy を `h_cycle_evidence_v1` として version 化する。Calendar period は JST 月曜00:00から
次の月曜00:00までとする。CLIは completed period のみを評価し、現在週の途中集計を
supported/rejected にしない。

最初の連続二週は baseline とし、結果は `baseline_collecting` または `insufficient_data`。
少なくとも二つの completed weekly promotion cohort があり、各 cohort の分母が非0、
hash/linkage integrity errorが0、terminal未確定が0になった後にだけ判定を許す。

- `supported`: 二週とも `gradedPromotedGateRate >= 0.5`、failed Gateがあれば
  `failedTriageRate = 1`、accepted Captureがあれば `scheduledFollowupRate = 1`、
  かつ `evidenceClosureRate` を観測値とともに出せる。
- `rejected`: 上記の成熟した cohort のいずれかで graded rate が `0.5` 未満、
  または failed triage / accepted follow-up / integrity guard が破れる。
- `inconclusive`: 分母0、未成熟、pending、grading failure、missing linkage、または
  二週未満。`inconclusive` は成功でも反証でもない。

この v1 は A5 cache rate、A3 H-EVAL finding precision、HarnessRun usageを入力にしない。
LLMは呼ばず、token budget / cache hitを理由に判定を緩めない。

### 6. 初期の操作面は manual read-only preview に限定する

implementation 後にのみ、例えば次のような明示 command を検討できる。

```text
npm run harness:preview-cycle-evidence -- --week 2026-W35 --json
```

この command は read-only で、aggregate / status / hash / timestamp以外を出力しない。
answer、diff、question、chapter body、resource ref、Capture title、secretをJSONへ出さない。
DB write、worker、scheduler、queue、launchd、LLM、automatic interventionは command の範囲外である。

定期実行や durable evaluation record は、A2 worker activationと実利用後の evidenceが揃った
別 ADR で扱う。A7は「今のデータで何を主張でき、何を主張できないか」を決定的に可視化する
前提であり、実行保証の代替ではない。

## 受入テスト

1. pure source revision helper は同じ source を同一hash、question/reference変更を別hashにし、
   同じinputのA6 `createTextbookCheckGateOriginV1` とsourceRevisionHashが完全一致することを
   固定する。answer/diff/secretを入力・保存・CLI outputに含めない。
2. temporary SQLiteで daily `auto` Check を削除→同内容再生成しても Evidence は1件、revision変更時は
   旧行を残して2件目を作ることを検証する。daily `compiled` とweekly の各writerも、Checkと同じ
   transactionで Evidence を一件だけ作ることを検証する。
3. Mastery event は explicit authenticated save だけで追加され、page visit/briefing/generator/worker相当では
   追加されないことを検証する。rollout前相当のEvidence無しCheckを初めて保存したときはsave時刻で
   観測し、過去periodへ遡及しないことを検証する。
4. pure projection fixtureで `passed`、`failed + pending Capture`、`failed + ignored Capture`、
   `failed + accepted + scheduled`、hash/linkage mismatch、0 denominator、二週不足を固定する。
5. promotionとgradedの cohort / as-of が異なることをJSONで明示し、future stateを過去terminal outcomeに
   混入させない。
6. A2/A3/A4/A5/A6 coexistence fence、`npm test`、typecheck、lint、temporary SQLite Prisma validationを通す。
   live DB、LLM、worker、schedulerは起動しない。

## 非ゴールと停止条件

- Masteryを自動的にGateへ変換しない。
- H-CYCLE結果を元に介入・通知・Capture triage・Misconception・reviewを自動で作成しない。
- H-EVAL、HarnessRun usage/cache、A5 historical backfillを一つのscoreに混ぜない。
- answer/diff/conversation/prompt/reference本文を新しいtableやpreview outputへ複製しない。
- H-CYCLEを二週未満・pending・unknownの状態でsupportedと表示しない。
- source identity取り違え、hash mismatch、duplicate observation、future stateの混入、privacy漏えいが
  観測されたら、policyを緩めず導入を止めて設計へ戻る。

## 代替案とトレードオフ

1. **現在のDaily/Weekly Checkをそのまま集計する**: 実装量は小さいが、auto再生成で分母が消え、
   週次比較を再現できないため採らない。
2. **Gate originだけを分母にする**: promotion済みだけを見れば楽だが、promotionしなかった
   actionable Checkを不可視化し、conversion仮説を検証できないため採らない。
3. **Masteryの最新値だけを持つ**: 過去週のend時点を復元できない。append-only eventにして
   as-of projectionを可能にする。
4. **LLMでCapture/Gateの関連を推測する**: privacy、再現性、token効率を壊すため採らない。
5. **最初からschedulerで毎週評価する**: A2のactivationとsleep/catch-up証拠を先取りするため採らない。

## A7-B 追補: 過去週の Gate / follow-up は現在行から復元しない

この追補は、§3〜§5 にある「current Gate / Capture / Misconception を as-of に
読む」と解釈できる箇所を置き換える。A7-A の `TextbookCheckEvidence` と
`TextbookCheckMasteryEvent` は source revision / self-report の履歴として十分だが、
Gate と `Misconception.nextReviewAt` は現在値を後から更新できる。

実装を確認すると、`textbook_check` Gate は failed 後に明示 resubmit されると
`answered` へ戻り `gradedAt` も消去される。さらに `nextReviewAt` は pass、fail、
link-existing、stale recovery、due Gate 作成で上書きまたは `null` にされる。このため、
現在の `status` / `gradedAt` / `nextReviewAt` を過去の週末状態として使うと、将来の
操作が過去の評価を無言に書き換える。

### B-1. A7-B は三つの本文なし append-only 証跡を追加する

PR #36 が main に入った後の別 implementation slice で、次の三つを追加する。
いずれも ID、列挙値、時刻だけであり、answer、question、reference、diff、prompt、
Capture title / note、会話本文を持たない。

```text
TextbookCheckGateStateEvent
  id, gateId, ordinal, status, recordedAt
  UNIQUE(gateId, ordinal), INDEX(gateId, recordedAt)

TextbookCheckGateFailureCapture
  id, failedStateEventId, captureId, recordedAt
  UNIQUE(failedStateEventId, captureId), UNIQUE(captureId)

TextbookCheckGateFollowupObservation
  id, failureCaptureId, misconceptionId, scheduledFor, observedAt
  UNIQUE(failureCaptureId)
```

- `TextbookCheckGateStateEvent` は、origin を持つ `textbook_check` Gate の永続
  status 遷移ごとに一度だけ足す。許可する値は
  `pending` / `answered` / `grading` / `grading_failed` / `passed` / `failed` /
  `self_graded_pass` / `self_graded_fail` / `dismissed` / `parked` とする。
  `ordinal` は Gate 内で連番かつ一意であり、同一ミリ秒の遷移でも順序を失わない。
  初期 `pending` は origin の `createdAt` で表現できるが、park → pending の復帰は
  event として残す。
- `TextbookCheckGateFailureCapture` は、`failed` StateEvent を起点に実際に新規作成
  された Capture だけを結ぶ。Capture の `sourceTool === "gate"`、
  `parseGateSourceContext(sourceContext).gateId === gateId`、Capture 作成時刻が失敗
  event 以後、を同一 transaction 内で検証する。既存 Capture への dedupe、LLM が
  concept を返さない失敗、または検証不能な関連には行を推測作成しない。
- `TextbookCheckGateFollowupObservation` は、上の Capture が accepted になり、
  `misconceptionId` と non-null の `scheduledFor` が同じ transaction で確定した
  ときだけ一度だけ足す。これは「その時点で follow-up が予約された」観測であって、
  scheduler が実行済み・学習が完了済みであるという主張ではない。

```text
 TextbookCheckEvidence ──▶ MasteryEvent
          │
          └──▶ GateOrigin ──▶ GateStateEvent (append-only)
                                      │ failed only
                                      ▼
                         GateFailureCapture (direct mapping)
                                      │ accepted + scheduled
                                      ▼
                         FollowupObservation (append-only)

 【重要】現在の Gate.status / Misconception.nextReviewAt は表示用の現在値。
          過去週の証拠には使わない。
```

各 writer は、状態遷移と対応する証跡を同じ database transaction で保存する。
answer を受理する writer は `answered`、採点開始は `grading`、採点終了は
`passed` / `failed` / `grading_failed`、self-grade / dismiss / park / unpark も同じ
規則に従う。失敗時の Capture create と direct mapping、accept と follow-up observation
も、それぞれ原子化する。連番の競合は `(gateId, ordinal)` の unique violation を再読・
retry して解決し、イベントを上書きしない。

### B-2. pure projection の入力・as-of・出力を固定する

`projectHCycleEvidenceV1(input)` は引き続き DB client、時計、LLM、外部 I/O を
持たない。adapter は completed JST week の `[start, end)` と `asOf === end` を渡す。
「今」を入力に含めず、CLI が completed period だけを選ぶ責務とする。

adapter が pure function に渡してよいのは、次の privacy-minimized projection だけである。

```text
source revision: identity/hash, firstObservedAt, mastery value/recordedAt
promotion: gateId, immutable origin identity, originCreatedAt
gate state: gateId, ordinal, status, recordedAt
failure capture: failedStateEventId, captureId, capturedAt,
                 sourceTool, parsedGateId, status, reviewedAt, misconceptionId
follow-up: failureCaptureId, misconceptionId, scheduledFor, observedAt
```

adapter は raw `sourceContext` を既存 `parseGateSourceContext` で照合するためだけに
読んでよいが、pure input / result / CLI JSON へ渡さない。ID と hash も aggregate の
検証だけに使い、result には個別の ID、source revision hash、問題文を出さない。

pure function は以下を fail-loud に検証する。

- period は JST 月曜 00:00 から次の月曜 00:00 までの厳密な `[start, end)`、
  `asOf === end`、かつ全時刻が有効であること。
- identity / Gate / Capture / Misconception の参照は一意で、event ordinal は
  Gate ごとに連続していること。origin 前の event、failed でない event に結ぶ
  failure capture、capture / follow-up の時刻逆転、duplicate mapping は integrity error。
- Gate の as-of state は origin と StateEvent のみから再構成する。現在の Gate row は
  relation の存在確認以外に使わない。`passed` / `failed` だけが verified terminal、
  `self_graded_*` / `dismissed` / `parked` / `grading_failed` / 未完了は成功でも失敗率の
  0%でもなく `incomplete` である。
- Capture の as-of terminal は `accepted` / `ignored` と `reviewedAt < asOf` のときだけ
  確定する。`pending` / `expired` / reviewedAt 欠損 / direct mapping 欠損は
  `incomplete`。failed Gate が dedupe 等で Capture を新規作成しなかった場合は
  `missing_gate_capture` のままにする。
- follow-up は `TextbookCheckGateFollowupObservation` があり、同じ direct Capture と
  Misconception を指し、`observedAt < asOf`、`scheduledFor` が non-null のときだけ
  measured success とする。現在の `Misconception.nextReviewAt` は使用しない。

率は既存の `EvidenceRate` union を維持する。`incomplete` には一つの代表 reason を
入れ、別に reason ごとの count を持つ immutable diagnostics を必ず返す。従って、
分母が 0 なら `not_applicable`、必要な履歴が無い / pending / integrity error なら
`incomplete` であり、どちらも 0% ではない。

| metric | denominator | measured numerator | incomplete になる例 |
|---|---|---|---|
| selfAssessmentRate | period 内 `firstObservedAt` の revision | as-of までに有効な MasteryEvent がある revision | event chronology / mastery enum 不正 |
| actionableCheckCount | rateではなく as-of snapshot | latest event が `partial` / `stuck` の revision数 | event order / identity 不正 |
| explicitPromotionRate | as-of actionable revision | 同一identityの origin が `createdAt < asOf` | origin identity/hash mismatch |
| answeredPromotedGateRate | period 内 origin Gate | as-of state が `answered` 以降へ到達した Gate | pending / event欠損 / state transition不正 |
| gradedPromotedGateRate | period 内 origin Gate | as-of state が verified `passed` / `failed` の Gate | pending / grading failure / self-grade / dismiss |
| failedTriageRate | as-of verified failed StateEvent | direct Capture が1件以上あり全件 terminal | missing_gate_capture / pending / malformed mapping |
| scheduledFollowupRate | as-of accepted direct Capture | matching FollowupObservation がある Capture | observation欠損 / relation / chronology不正 |
| evidenceClosureRate | period 内 origin Gate | verified pass、又は failed attempt の direct Capture に accepted follow-up がある Gate | 未完了、missing capture、follow-up未観測 |

`explicitPromotionRate` は as-of snapshot conversion、`answeredPromotedGateRate` /
`gradedPromotedGateRate` / `evidenceClosureRate` は period 内 origin の outcome cohort、
`failedTriageRate` は verified failed attempt cohort、`scheduledFollowupRate` は accepted
direct Capture cohortである。結果の JSON には `cohortKind`、`period`、`asOf`、
`policyVersion`、各 denominator、diagnostics を明示し、異なる cohort を暗黙に割り算しない。

### B-3. 二週 policy の eligibility と判定順序を固定する

policy は `h_cycle_evidence_v1` のまま、古い週から順に並ぶ completed window だけを受ける。
隣接は `previous.end === current.start` で判定し、二つの任意の週を飛び越えて結論を出さない。

1. window が二つ未満、または隣接二週をまだ集められない場合は
   `baseline_collecting`。これは成功でも反証でもない。
2. 隣接二週があっても、各週の origin cohort が 0、任意の必須 metric が
   `incomplete`、または integrity error が 1 件以上なら `inconclusive`。
   分母 0 の `not_applicable` はその metric の適格な非適用であり、0%へ変換しない。
   pre-A7-B history に StateEvent / FollowupObservation が無い場合もここへ入り、
   current row から補完しない。
3. 二週とも eligible のときだけ判定する。二週とも
   `gradedPromotedGateRate >= 0.5`、failed cohort があれば
   `failedTriageRate = 1`、accepted direct Capture cohort があれば
   `scheduledFollowupRate = 1` なら `supported`。いずれかの measured threshold を
   満たさなければ `rejected`。`evidenceClosureRate` は必ず併記する観測値であり、
   自動介入のトリガーではない。

この順序により、usage unavailable、pending、self-grade、dedupe、low precision、
follow-up未観測が競合しても、先に `incomplete` / integrity を返し、成功・反証へ
丸めない。

### B-4. A7-B implementation の受入証拠

1. Pure fixtures が同一 Gate の `failed → answered → passed` を ordinal で再構成し、
   現在行の `status` / `gradedAt` を変えても過去週 projection が変わらないこと。
2. `failed → pending Capture`、`failed → ignored Capture`、`failed → accepted →
   FollowupObservation`、dedupe による `missing_gate_capture`、malformed sourceContext、
   duplicate / time-reversed event を個別に固定すること。
3. `Misconception.nextReviewAt` を後日上書き・null化しても、過去の scheduled follow-up
   metric が observation に基づき不変なこと。
4. `[start,end)` の両端、JST年跨ぎ、同一時刻の ordinal、二週非隣接、二週不足、
   zero denominator、self-grade / dismiss / grading_failed を固定すること。
5. StateEvent / FailureCapture / FollowupObservation writer は temporary SQLite で
   transaction rollback、unique race、answer / question / diff / prompt本文非保存を検証すること。
6. projection module / tests は DB、clock、LLM、worker、scheduler、queue、CLI writeを
   import / invoke しない。manual read-only preview は pure contract とadapterがGREENに
   なった後の A7-C とする。

## Rollout

1. PR #36（A7-A evidence ledger）が本人により merge された後だけ、新 main をread-onlyで
   再観測する。A7-B は別 worktree / branch でこの追補の StateEvent / FailureCapture /
   FollowupObservation とpure fixtureをTDD実装する。
2. pre-A7-B history は current Gate / Misconception stateでbackfillしない。必要な event が
   無い週は `inconclusive` として表示する。
3. 一つ目と二つ目の隣接 completed weekはbaselineとしてread-onlyに観測し、supported/rejectedを出さない。
4. 二週を越えても`inconclusive`なら、分母・pending・missing linkage・missing observationを
   表示して設計へ戻る。数字を埋めるためのauto promotion、LLM評価、scheduler起動はしない。
