---
type: decision
status: proposed
date: 2026-08-24
tags: [learning-loop, textbook, comprehension-gate, evidence, human-in-the-loop]
source_refs:
  [
    docs/adr/0006-comprehension-gate.md,
    docs/adr/0007-gate-resources-rubric.md,
    docs/adr/0020-daily-retro-knowledge-loop.md,
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    prisma/schema.prisma,
    src/lib/daily-textbook.ts,
    src/lib/weekly-textbook.ts,
    src/lib/textbook-guidance-shared.ts,
    src/lib/gate-answer.ts,
    src/lib/gate.ts,
    src/lib/capture.ts,
  ]
---

# ADR-0026: Textbook Check を証拠付き Gate へ明示昇格する

実装トラッキング: [GitHub Issue #31](https://github.com/shin9898/applied-loop/issues/31)
親: [Harness P0 #24](https://github.com/shin9898/applied-loop/issues/24)

## 背景

`DailyTextbookCheck` と `WeeklyTextbookCheck` は、質問と `mastery`
(`clear / partial / stuck / parked`) を持つ。現在のUIはこの自己申告を保存し、
翌日の導線を `stuck → /zukan`、`partial → /retro` として返す。一方、回答本文、
rubric、採点結果、Gateとの安定した関連は持たない。

既存の `Gate` は回答、rubric、採点、失敗時の `Capture`、人間のtriageを経た
`Misconception` と復習予定を持つ。しかしGateの主な供給源はdiff/会話であり、
Textbook Checkをそのまま証拠付きのGateへ変換する契約はない。日次再生成は
`source="auto"` のCheckを削除して作り直すため、単にCheckのIDを外部キーにすると、
元の問いが消えた後にGateの由来・採点参照・重複防止を失う。

したがって、自己申告を理解証拠と見なさず、明示的にGateへ昇格した回答とその採点だけを
graded evidenceとして扱う、再生成に耐えるorigin契約が必要である。これはADR-0025の
H-CYCLEを検証するための前提であり、H-JOBの耐久化や自動介入の証明ではない。

## 決定

### 1. 自己申告とgraded evidenceを分離する

- `mastery` は本人の振り返りであり、`clear` を含めてgraded evidence、Gateの合格、
  Misconceptionの解消、H-CYCLEの成功分母には数えない。
- `partial` または `stuck` のCheckだけが、本人の明示操作「Gateで確かめる」により
  Gate候補になる。`parked` は明示的に再開されるまで候補にならない。
- page visit、morning briefing、Masteryの保存、日次/週次生成、scheduler、queue drainは
  Gateを自動作成しない。候補の作成時にもLLMを呼ばない。
- Gate回答を本人が送信した後だけ、既存の採点経路が採点を試みる。採点不能・未回答は
  `graded` と数えず、自己申告を上書きしない。

```text
Textbook Check の自己申告 (partial / stuck)
                    │
                    │ 本人が明示的に「Gateで確かめる」
                    ▼
  server-derived source snapshot + rubric/reference
                    │  1 logical source revision = 1 Gate
                    ▼
          Gate (pending, local answer only)
                    │
                    │ 本人が回答を提出
                    ▼
      existing grade path ── pass ──> graded evidence
                    │
                    └── fail ──> Capture (pending)
                                      │
                                      │ 本人のtriage/accept
                                      ▼
                         Misconception + 次回 review の候補
```

### 2. Checkの再生成に耐えるimmutable originを持つ

実装時は、GateとCheckの直接外部キーだけに依存しない。`TextbookCheckGateOrigin`
（名称は責務を維持する範囲で調整可）を一つ設け、次を保存する。

| field | 意味 |
|---|---|
| `gateId @unique` | 作成済みGateの一意な関連 |
| `sourceKind` | `daily` または `weekly` |
| `textbookKey` | 日付/週のstable key。Checkの生存には依存しない |
| `checkIndex`, `chapterIndex?`, `source` | 元の論理スロットを監査するmetadata |
| `sourceRevisionHash` | v1 canonical source snapshotのSHA-256 |
| `questionHash` | Gate.question と同じ問いであることの検査用hash |
| `referenceHash` | 採点referenceの検査用hash |
| `referenceJson` | bounded local reference。回答本文・diff全文・secretを含めない |

`sourceRevisionHash` は少なくとも `sourceKind`、`textbookKey`、`source`、
`checkIndex`、`chapterIndex`、question、rubric、referenceのversioned canonical JSONから
serverが計算する。同じrevisionのpromotionは既存Gateを返す。再生成でquestionまたは
referenceが変わった場合、旧Gateを自動dismiss・delete・置換せず、本人が新revisionを
明示的にpromoteしたときだけ別Gateを許す。旧Gateは既存のGates導線から引き続き見える。

元のCheck行が削除されても、Gate.questionとorigin snapshotは残る。逆にoriginを失った
Gateを「同じCheckの続き」と推定しない。これにより、日次再生成が未回答の理解債務を
黙って消すことを防ぐ。

### 3. rubricと採点referenceはserver側で決める

promotion actionが受け取るのはCheckの識別子と期待されるsource kindだけとする。
question、rubric、resource、hash、referenceをclientから受け取らない。serverが現在の
Daily/Weekly Checkと対応Chapterを読み、次を作る。

- Gate.question: Checkの問いのimmutable copy。
- Gate.rubricCriteria: Check templateに対応する1〜3個の決定的観点。例えば
  「何をしたか」「なぜその判断か」「別案/次回適用」を、該当Checkが実際に問う範囲だけに
  絞る。LLMによる問い/rubric生成はしない。
- Gate.resources: Chapterの既存 `evidenceJson` から上限付きで投影した一次情報の入口。
- `referenceJson`: 採点に必要な最小のLessonSlots/章要約/evidence refのみ。既存の
  Textbook内容のbounded local snapshotであり、HarnessRun、telemetry、外部送信payloadには
  保存しない。

既存のdiff Gateのgrading promptは変更しない。Textbook originを持つGateだけが、
originのreferenceをcap付きで採点器へ渡せる。referenceが見つからない、hashが一致しない、
またはshapeが不正なら、推測して採点せず `grading_failed` / stable reasonにする。

### 4. 失敗は人間のtriageを経由して次回予定へ進む

Textbook Gateの不合格は既存のGate失敗と同様に `Capture(sourceTool="gate")` を作る。
Captureのaccept/link_existing/create_newは既存の人間triageを通り、accept後だけ
Misconceptionと次回reviewが作られる。Captureがpending/ignoredのままでも、システムは
「復習予定済み」「cycle close」と主張しない。

Textbook Gate用の `kind` は既存の初回Gateと区別可能なstable値を使う。ただし既存の
`retry` / `sr_review` / `module` の復習意味論を流用・改変しない。新kindに対するpass/fail、
Capture、resubmit、UI表示、集計を列挙テストで固定してから導入する。

### 5. 計測は自己申告と証拠を別に出す

v1で記録/集計する数は次のように定義する。最初の導入週はbaselineであり、ADRの支持を
判定しない。

| metric | 定義 |
|---|---|
| `selfAssessmentRate` | Masteryが一度でも付いたCheck / 全Check |
| `actionableCheckCount` | 最終Masteryが`partial`または`stuck`のCheck数 |
| `explicitPromotionRate` | Gateを明示作成したlogical source revision / actionable Check |
| `answeredPromotedGateRate` | 回答受理済みGate / 明示作成Gate |
| `gradedPromotedGateRate` | terminal pass/failのGate / 明示作成Gate |
| `failedTriageRate` | fail Gateに対応するCaptureがhuman triage済み / fail Gate |
| `scheduledFollowupRate` | accept済みCaptureがMisconceptionの次回予定を持つ / accept済みCapture |

分母0は0%ではなく `not_applicable` とする。`clear`自己申告、LLMエラー、未回答、
pending Captureをsuccessへ丸めない。H-CYCLEの2週連続の支持/反証は、durable grading
deliveryが別途成立した後にだけ評価する。

## 受入テスト

1. 純関数でsource snapshotのcanonical化、hash、rubric/reference上限、invalid shapeを
   固定する。回答本文をsnapshotへ混入させない。
2. Temporary SQLiteで、`partial/stuck`の明示promotionだけが1 transactionでGateとoriginを
   作り、同一revisionの並行/再送では同じGateを返すことを検証する。
3. `clear`、`parked`、page visit、briefing、日次/週次再生成、scheduler相当の入力はGateを
   作らないことを検証する。
4. auto Checkの削除・再生成後も旧Gate/originが残り、revision変更は新Gateを自動作成しない。
5. Textbook Gateだけがbounded referenceを使い、既存diff Gateのprompt shapeと採点意味論を
   変えないことを検証する。
6. pass/fail、grading_failed、Capture pending/ignored/accepted、Misconception作成、次回予定を
   状態表で検証する。answerなし・self-reportだけでgraded/clear/closeにならない。
7. `npm test`、lint、typecheck、Prisma migration、UIの明示CTAを確認する。LLM live call、
   worker activation、実DB backfillはtest fixture以外で実行しない。

## 非ゴールと停止条件

- LoopJob/worker/watchdog/schedulerのactivation、`after()`の耐久化、automatic Gate作成、
  automatic intervention、本人の回答代行はこのADRの対象外。
- current H-EVAL policyへTextbook/Gate統計を無理に流し込まない。H-EVALは評価jobの
  健全性、H-CYCLEは理解証拠の仮説であり、入力・判定・rolloutを分ける。
- HarnessRun usage evidence、cache cohort評価、A5のhistorical backfill writeは別sliceである。
- 以下のいずれかが観測されたら導入を止めて設計へ戻る: source revisionの取り違え、
  duplicate Gate、answerなしのgraded扱い、Capture/Misconceptionの自動確定、reference欠落を
  推測採点、既存Gateのgrading意味論の意図しない変更。

## 代替案とトレードオフ

1. **Masteryをそのまま理解証拠とする**: 追加実装は少ないが、自己申告と採点済み回答を
   混同し、H-CYCLEの反証可能性を失うため採らない。
2. **Mastery変更時に自動でGateを作る**: 表面的な発火数は増えるが、page/briefingを
   scheduler代わりにしない原則、backlog、本人の意思を壊すため採らない。
3. **Check IDだけをGateへ外部キーでつなぐ**: 日次再生成がsource行を消すため、由来と
   grading referenceを失う。immutable origin snapshotを採る。
4. **promotion時にLLMで問い/rubricを作る**: token消費と出題の揺れを増やし、同じCheckの
   idempotencyを壊す。v1はdeterministic projectionを採る。

## Rollout

1. ADR-0026とIssue #31をレビューし、schema/origin/source revisionのexact contractをfreezeする。
2. isolated worktreeでfixture-firstに実装し、worker・schedulerを起動せずtemporary SQLiteだけで
   migration/transaction/rebuild挙動を証明する。
3. UIは`partial/stuck`にだけ明示CTAを出し、既存Mastery導線を置き換えない。
4. merge後は本人が少数のmanual promotionを行い、self-report/answered/graded/triageを
   read-onlyで観測する。最初の2週間はH-CYCLEの結論を出さない。
