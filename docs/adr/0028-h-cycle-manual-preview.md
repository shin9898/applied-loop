---
type: decision
status: proposed
date: 2026-08-24
tags: [learning-loop, h-cycle, evidence, evaluation, privacy, read-only]
source_refs:
  [
    docs/adr/0025-hypothesis-driven-learning-harness.md,
    docs/adr/0027-h-cycle-evidence-evaluation.md,
    src/lib/h-cycle-projection.ts,
    src/lib/h-cycle-evidence-adapter.ts,
    src/lib/harness-cache-audit-query.ts,
  ]
---

# ADR-0028: H-CYCLE の手動 read-only preview を二つの隣接週で固定する

実装トラッキング: [GitHub Issue #34](https://github.com/shin9898/applied-loop/issues/34)
親: [Harness P0 #24](https://github.com/shin9898/applied-loop/issues/24)
前提: ADR-0025 / ADR-0027 の A7-A evidence ledger と A7-B historical projection

## 背景

ADR-0027 の A7-A / A7-B は、Textbook Check の source revision、自己申告、
Gate 状態遷移、failed Gate の direct Capture、accepted 後の follow-up を本文なしの
append-only 証跡として残し、JST の完了週を pure projection で再構成する。

しかし pure function と DB adapter だけでは、本人が「今の証拠で H-CYCLE を支持・反証
できるのか」を安全に確認する操作面にならない。逆に既存の write-capable `db.ts`、現在週、
または単週だけをそのまま CLI に結びつけると、過去週の不変性、二週 policy、read-only
境界を損なう。

この ADR は **A7-C の手動 preview だけ**を決める。定期実行、durable evaluation record、
worker/scheduler/queue activation、LLM 呼出、結果に基づく自動介入は決めない。

## 決定

### 1. 操作は明示的な `--week` + `--json` のみとする

実装後の唯一の package script は次とする。

```text
DATABASE_URL=file:/absolute/path/to/applied-loop.db \
  npm run --silent harness:preview-cycle-evidence -- --week 2026-W35 --json
```

- `DATABASE_URL` は呼出側が明示的に与える必須値とする。script は `.env` を読まず、
  `file:./dev.db` を fallback しない。値自体を stdout / stderr / JSON に出さない。
- local SQLite の `file:` URL だけを受ける。空値、host 付き URL、別 scheme、query / fragment、
  解釈不能な path は `invalid_database_url` として DB を開かずに失敗する。
- `--week YYYY-Www` と `--json` はそれぞれ厳密に一回だけ受ける。順序は問わないが、位置引数、
  `--`、unknown option、重複、欠損値は失敗とする。
- `--week` は policy の **後側（target）週**である。CLI は ISO/JST の直前週を純粋に導出し、
  常に `[previous, target]` の二つの隣接 completed window を評価する。年跨ぎも同じ規則で扱う。
- target の JST `[start,end)` に対し `end <= injected now` のときだけ query を許す。現在週と
  future week は `week_not_completed` として query 前に失敗する。`now` は CLI dependency として
  注入し、output へ含めない。
- `baseline_collecting`、`inconclusive`、`supported`、`rejected` は**正常な観測結果**であり
  exit 0 とする。入力、configuration、read failure だけが exit 1 である。

エラーは stdout を空にし、stderr の一行だけに固定する。

```text
error: missing_database_url
error: invalid_database_url
error: missing_required_option
error: missing_option_value
error: duplicate_option
error: unknown_option
error: invalid_iso_week
error: week_not_completed
error: query_failed
error: internal_error
```

`query_failed` / `internal_error` に driver message、path、SQL、stack、source body を連結しない。

### 2. JSON は aggregate-only の二週 envelope とする

成功時 stdout は次の一つの JSON document と改行だけとする。

```ts
type HCycleEvidencePreviewV1 = Readonly<{
  schema: "h_cycle_evidence_preview_v1";
  policyVersion: "h_cycle_evidence_v1";
  targetWeekKey: string;
  projections: readonly [
    HCycleEvidenceProjectionV1, // previous, older window
    HCycleEvidenceProjectionV1, // target, requested window
  ];
  policy: HCycleEvidencePolicyResultV1;
}>;
```

`HCycleEvidenceProjectionV1` は既に aggregate / rate status / denominator / diagnostics / period
だけを持つ。preview はその出力を再整形しない。個別 ID、source revision hash、textbook key、
source、Gate status row、Capture title / note、Misconception、answer、question、reference、diff、
conversation、prompt、secret、DB URL は envelope に追加しない。

`policy.evaluatedWeekKeys` は二週の順序を明示するが、二週を跨ぐ summary rate を新設しない。
各週の母数と `not_applicable` / `incomplete` reason を残すことで、policy verdict を単独の
headline に圧縮しない。

### 3. 二つの投影は一つの read-only snapshot から作る

```text
  explicit DATABASE_URL
           │
           ▼
┌────────────────────────┐
│ preview CLI            │  option + completed-week validation only
└───────────┬────────────┘
            │ target / previous periods
            ▼
┌────────────────────────┐
│ readonly query adapter │  fresh Prisma client; fileMustExist=true
│ one read transaction   │  SELECT-only minimal projection
└───────────┬────────────┘
            │ privacy-minimized snapshot
            ▼
┌────────────────────────┐
│ pure projection × 2    │  no DB / clock / LLM / output capability
│ + two-week policy      │
└───────────┬────────────┘
            │ aggregate-only envelope
            ▼
       stdout JSON

  No edge: write / worker / scheduler / queue / LLM / intervention
```

query adapter は fresh `PrismaClient` を
`PrismaBetterSqlite3({ url, readonly: true, fileMustExist: true })` でだけ生成する。global
`prisma` / `db.ts` を import しない。五つの existing evidence relation
(`TextbookCheckEvidence` + mastery events、origins、state events、failure captures、follow-up
observations) を、一つの read transaction で必要最小の field だけ select する。

`h-cycle-evidence-adapter.ts` は snapshot reader を明示 export し、その一回の結果に
previous / target の period を付与する。同じ snapshot を二つの period に付与し、`projectHCycleEvidenceV1` を二回、
`evaluateHCycleEvidencePolicyV1` を一回だけ呼ぶ。DB の current `Gate.status` / `gradedAt` /
`Misconception.nextReviewAt` を select せず、raw `sourceContext` は既存 strict parser で
direct linkage を検証する局所用途に限る。pure input、envelope、error へ渡さない。

DB client は `finally` で必ず disconnect する。read transaction・disconnect 失敗は成功を
偽装せず `query_failed` とする。

### 4. read-only は capability と観測の両方で証明する

`readonly: true` と `fileMustExist: true` は capability の第一防壁である。実装 test は
disposable SQLite fixture に migrations を apply してから、次を同じ child-process invocation
で確認する。

- DB main file の SHA-256 が command 前後で一致する。
- `-wal`、`-shm`、`-journal` sidecar の集合が command 前後で一致する。
- 存在しない database / directory を渡しても file / sidecar を作らない。
- valid invocation の stdout は JSON 一文だけ、stderr は空、`npm run --silent` の wrapper
  を含めても一文として parse できる。

fixture には answer、question、Capture title / note、source context、secret-looking token を
入れ、再帰的な key/value deny test でそれらが JSON / stderr に出ないことを固定する。

### 5. 実装 surface を狭くし、既存 dormant fence を維持する

A7-C は schema、migration、Gate writer、Capture triage、worker、scheduler、queue、UI、MCP を
変更しない。最小 implementation surface は以下に限定する。

```text
package.json                                  # one exact script only
scripts/preview-h-cycle-evidence.ts           # process adapter only
src/lib/h-cycle-evidence-adapter.test.ts      # shared snapshot-reader proof
src/lib/h-cycle-evidence-adapter.ts           # one snapshot reader + period decoration
src/lib/h-cycle-evidence-preview.ts           # args, period pair, envelope, pure CLI
src/lib/h-cycle-evidence-preview-query.ts     # fresh read-only client + snapshot query
src/lib/h-cycle-evidence-preview.test.ts      # TDD / integration / privacy proof
src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts
src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts
```

最後の二つは allowlist を広げるためではなく、A7-C の exact path と baseline byte を明記し、
新しい production edge が worker / queue / scheduler / LLM / write-capable client を import
しないことを静的に検証するためだけに更新する。package script は
`tsx scripts/preview-h-cycle-evidence.ts` の完全一致とし、末尾 `--`、duplicate JSON key、
他 script の書換えを拒否する。

### 6. TDD acceptance を先に固定する

1. `--week` parser は ISO/JST 境界・week 1 の前年遷移・invalid ISO week・option 全 error を
   固定し、current / future week は query が一度も走らないこと。
2. target `2026-W35` は exactly `2026-W34` と `2026-W35` の二入力だけを作り、
   period / as-of が ADR-0027 と完全一致すること。
3. query adapter は read transaction 内の五 relation だけを最小 select し、current Gate /
   Misconception row を読まず、success / rejection のどちらでも disconnect すること。
4. 同じ captured snapshot から projection が二回、policy が一回だけ実行されること。policy の
   `baseline_collecting` / `inconclusive` / `supported` / `rejected` が exit 0 の JSON であること。
5. temporary SQLite child smoke は DB hash と sidecar 不変、missing DB の no-create、JSON purity、
   privacy deny list を証明すること。
6. output は二週の aggregateを持つが ID / hash / source / raw text / secret を持たず、future の
   malformed record が過去 target の output を変えないこと。
7. package script、process adapter、query module の AST / import guard は `db.ts`、Gate / Capture
   writer、worker、scheduler、queue、LLM、`fs` write、child process、network、dotenv、console、
   stderr echo を拒否すること。
8. A2/A3/A4/A5/A6/A7-B coexistence fence、typecheck、lint、full suite、temporary SQLite Prisma
   validationを通すこと。live DB / `.env` / worker / scheduler / queue / LLM は一切起動しない。

## 非ゴールと停止条件

- preview 結果を保存しない。durable evaluation record は別 ADR で扱う。
- 毎週の自動実行、通知、automatic intervention、Capture triage、Gate 作成、review schedule の
  変更をしない。
- two-week policy の閾値・version を preview の都合で緩めない。
- target / previous 以外の週や current week を暗黙に補完しない。
- read-only proof、privacy deny test、as-of 不変、dormant fenceのいずれかが崩れたら、実装を
  push せず ADR / pure contract へ戻る。

## 代替案とトレードオフ

1. **一週だけを preview する**: metrics は見えるが、二週 policy を caller が恣意的に選べる。
   target の直前週を固定して採らない。
2. **write-capable `db.ts` を reuse する**: 実装は短いが、read-only を慣習に落とすため採らない。
3. **二回別々に DB を query する**: 差分や競合により policy pair の観測時点がずれるため採らない。
4. **最新週を自動選択する**: clock依存の再現不能な command になるため採らない。
5. **scheduler で毎週出力する**: A2 activation と durable record を先取りするため採らない。

## Rollout

1. A7-B implementation の PR が main へ入り、CI が成功したことを read-only で再観測する。
2. この ADR を review し、A7-C を新しい isolated branch で RED→GREEN 実装する。fixture は
   temporary SQLite だけを使う。
3. PR / CI 成功後も、実 DB preview の実行は本人が `DATABASE_URL` を選んで明示承認した時だけ行う。
   初回は output と DB / sidecar 不変を観測し、結果を仮説の support / reject と混同しない。
4. 二週の実地 evidence が揃っても automatic activation はしない。定期 evaluation / durable record
   を検討するなら、A2 activation の実証と別 ADR を先に置く。
