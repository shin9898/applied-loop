---
type: decision
status: proposed
date: 2026-08-26
tags: [harness, learning-loop, evaluation, cache, persistence, feature-off]
source_refs:
  [
    docs/adr/0035-harness-evaluation-next-action-proposals.md,
    src/lib/loop-jobs/harness-evaluation/harness-evaluation-report-v1.ts,
    src/lib/harness-evaluation-run-v1.ts,
  ]
---

# ADR-0036: H-EVAL の durable run record は closed aggregate envelope として保存する

実装トラッキング: [GitHub Issue #53](https://github.com/shin9898/applied-loop/issues/53)
前提: ADR-0035、A8-C3b/C3c の generation / reconciliation fence が main に反映済み

## 背景

ADR-0035 で H-CYCLE、H-EVAL、H-CACHE を cohort 非混合の deterministic report にまとめ、最大3件の
非実行 proposal を返す境界を定めた。manual preview の結果を後で比較できなければ、同じ評価を再実行した
ときの idempotency、report の改変検知、cache 効率の時系列評価を証拠ベースで閉じられない。

一方、raw row や prompt / answer / path / provider usage をそのまま durable record にすると、評価用の
保存が学習データや実行権限の別経路になる。A9-B は評価結果の保存だけを追加し、periodic scheduler、
worker、launchd、selected DB の運用開始は行わない。

## 決定

### 1. `HarnessEvaluationRun` は aggregate-only の append-only record とする

record は次の閉じた envelope だけを持つ。

```text
opaque evaluationKeyHash + reportSchema
          │
          └─> canonical HarnessEvaluationReportV1 JSON
                    │
                    ├─ reportEnvelopeSha256
                    └─ recordSha256 (identity + evaluatedAt + report digest)
```

`evaluationKeyHash` は呼び出し側で正規化済みの lower-case SHA-256 形式（64桁 hex）として渡す。
raw week key、repo/path、prompt、answer、token usage、provider response、secret は入力として受け付けず、
DB に保存しない。report は `normalizeHarnessEvaluationReportV1` を通して closed schema を検証し、
caller-owned object graph から切り離してから canonical JSON 化する。

### 2. retry と改変検知を一つの identity で固定する

一意性は次の tuple とする。

```text
(recordSchema, reportSchema, evaluationKeyHash)
```

同じ tuple かつ同じ `reportEnvelopeSha256` なら `created: false` を返す。再試行時の時刻が違っても、
最初の row を返し、更新しない。同じ tuple で digest が違えば
`evaluation_run_integrity_failure` とし、row を変更せず停止する。create の競合を再読する場合も、
対象の一意制約以外の storage error は idempotent retry として扱わない。

### 3. DB 自体で append-only と hash の形を守る

SQLite migration に lower-case 64桁 hash の CHECK、composite unique index、evaluatedAt index、
update/delete 拒否 trigger を置く。アプリケーション writer の検証を迂回した direct mutation も、
temporary SQLite で同じ停止条件になることを acceptance test で証拠化する。

### 4. A9-B の保存は manual / explicit caller の境界に留める

writer は report を受け取って一件を記録するだけであり、scheduler、queue、worker、launchd、LLM、
cache pre-warm、automatic intervention、selected local DB binding を呼ばない。A8-C4 / A9-C の
periodic execution は、この record の存在だけでは有効化されない。

## 受入条件

1. valid report が aggregate-only envelope と digest 付きで temporary SQLite に一件保存される。
2. 同じ identity + digest の retry は一件のまま同じ row を返し、日時や hash を更新しない。
3. 同じ identity + 異なる digest は integrity failure で停止し、row を変更しない。
4. raw-looking key、extra key、invalid report、accessor、Proxy、invalid Date は書き込まれない。
5. Prisma の update / delete と migration trigger の両方が append-only を証明する。
6. writer と report kernel に実行 authority、DB URL、raw data、LLM 依存がない。
7. typecheck、focused temporary SQLite tests、lint、historical scope fence が通る。

## 非ゴールと停止条件

- A8-C4 / A9-C の scheduler、launchd、heartbeat、selected DB の binding は追加しない。
- report の verdict や proposal から Gate、Capture、Misconception、notification を自動作成しない。
- digest mismatch、privacy/data-loss/duplicate durable effect、closed-schema violation が一件でもあれば
  `pause_and_investigate` 相当の停止境界を保ち、次の自動化へ進まない。

## 代替案とトレードオフ

1. **raw evidence を保存する**: 後からの再集計は容易になるが、学習データとプライバシー境界を広げるため採らない。
2. **毎回新しい row を append する**: 履歴は残るが、同一評価の retry と重複 durable effect を区別できないため採らない。
3. **upsert で最新 report に置換する**: 改変を隠し、最初の証拠を失うため採らない。
4. **record の保存と periodic scheduler を同時に入れる**: operation approval と評価結果の contract が混ざるため分離する。

## A9-D1: baseline / eligible window の決定論的境界

A9-B の record key を caller が raw week key や repo/path から直接組み立てると、同じ評価窓の
retry が別 identity になり、後続の cache / H-EVAL 比較で cohort が混ざる。そこで A9-D1 は、
completed window の aggregate outcome だけを受け取る feature-off の pure classifier を追加する。

- source は `cohort`、`policyVersion`、opaque `scopeHash`、cadence、数値の period bounds、
  `supported / rejected / inconclusive`、decision stage の closed shape に限定する。
- period hash と A9-B `evaluationKeyHash` は canonical identity から deterministic に導出し、
  raw week key、repo/path、本文、usage row は入力・出力・recordへ渡さない。
- 同一 cohort / policy / scope の completed window だけを順序化し、最新の隣接2窓を選ぶ。
  1窓または非隣接なら `baseline_collecting`、欠損・結果変更・current provisional は
  `inconclusive`、同じ non-inconclusive outcome の隣接2窓だけを `eligible` とする。
- classifier は clock、DB、scheduler、worker、launchd、LLM、automatic intervention を持たず、
  結果の `automaticInterventionAllowed` は常に `false`。A9-B writer へ渡す key を作るだけで、
  実窓の収集や periodic activation は開始しない。

この境界により、通常の window 判定は token を消費せず、同じ window の report retry は A9-B の
digest integrity fence へ収束する。実観測での outcome 記録と A9-C の periodic execution は、
user-owned operational evidence と別の承認が揃うまで未開始とする。

## Rollout

1. この ADR と writer/schema/migration の focused proof を review する。
2. A9-B を feature-off のまま main に取り込む。
3. manual preview の report を明示的な caller が保存できることを観測する。
4. baseline / eligible windows / cache matched cohort が揃うまで A9-D の outcome 判定は行わない。
5. A8-C4 / A9-C は別 operation approval と runtime evidence が揃ったときだけ提案する。
