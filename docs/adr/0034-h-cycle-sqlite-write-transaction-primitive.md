---
type: decision
status: proposed
date: 2026-08-26
tags: [learning-loop, h-cycle, sqlite, transaction, safety, feature-off]
source_refs:
  [
    docs/adr/0033-h-cycle-generation-fenced-execution.md,
    src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.ts,
    src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.test.ts,
  ]
---

# ADR-0034: H-CYCLE write は same-connection SQLite immediate transaction primitive を経由する

実装トラッキング: [GitHub Issue #40](https://github.com/shin9898/applied-loop/issues/40)
設計 freeze: [Issue #40 comment](https://github.com/shin9898/applied-loop/issues/40#issuecomment-5419751656)
前提: ADR-0033、A8-C1 control ledger、A8-C2 kind-isolated one-shot

## 背景

ADR-0033 の C3b/C3c は、current activation generation の確認、guarded enqueue /
record write、disable との競合を durable write の時点で同時に扱う必要がある。現在の
`appendHCycleActivationEventV1` は、history の `findMany` と event の `create` を別の
Prisma call として行う。その public API は既存の control ledger 用であり、C3 の
generation fence を表現する transaction boundary ではない。

installed `@prisma/adapter-better-sqlite3` の adapter transaction は `BEGIN` を使い、
adapter transaction の `commit` / `rollback` は adapter mutex を release する。この
implementation だけでは C3 が必要とする `BEGIN IMMEDIATE`、same physical connection、
commit / rollback、second client との lock behavior を証明できない。C3b/C3c が
`PrismaClient.$transaction()` を仮定で採用すると、future write fence の根拠が欠ける。

## 決定

### 1. C3p は narrow injected primitive だけを置く

`src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.ts` は
次の named primitive だけを提供する。

```ts
runHCycleSqliteImmediateWriteTransactionV1({ connection }, operation)
// -> Object.freeze({ ok: true })
//  | Object.freeze({ ok: false, code: "storage_failure" })
```

`connection` は caller が既に open した direct `better-sqlite3` connection である。
primitive は database path、URL、environment、Prisma client、queue、scheduler、worker、
registry、handler、launchd capability を受け取らず、database を open しない。production
caller も C3p では追加しない。

primitive の唯一の transaction route は次に固定する。

```ts
connection.transaction(() => operation(connection)).immediate()
```

callback には injected connection と同一の object を渡す。callback は `undefined` だけを
return できる。throw、thenable を含む non-`undefined` return、driver failure は driver の
rollback の後に one closed resultへ正規化する。public result には SQL、path、row、token、
driver error、stack を入れない。

```text
C3p temporary fixture only

direct driver A ── injected immediate primitive ── guarded probe write
      │                    │
      │                    └── callback receives the identical A object
      │
Prisma child B ── actual disabled append after a read barrier
      │
direct driver C ── reverse-busy and foreign-key probes
```

これは general database abstraction ではない。C3b/C3c が利用するには、same direct
connection を injection する別 ADR / design が必要である。Prisma transaction、callback
inside a second connection、read-then-write fallback は substitute にならない。

### 2. temporary SQLite で adapter と異なる client boundary を観測する

C3p fixture は OS temporary directory の exact `fixture.db` だけを migration target にする。
nonexistent explicit dotenv config と exact temporary `DATABASE_URL` を child migration に渡し、
selected local development DB は発見・read・write しない。direct driver は
`@prisma/adapter-better-sqlite3` package が nested resolve する `better-sqlite3` を
ESM-safe `createRequire` sequence で得る。root package と同じ path でないことを assert
してから direct clients を construction する。

fixture は direct A / C で `foreign_keys = ON` を set and verify し、bounded busy timeout を
使い、all clients を close してから temporary directory を remove する。temporary probe
table は real `HCycleActivationEvent` への FK と `(generationSequence, targetWeekKey)` unique
identity を持つが、`schema.prisma` / migration には加えない。

### 3. actual append path との deterministic stale-read barrier を測る

test-only worker child B は actual `appendHCycleActivationEventV1` を呼ぶ。delegating ledger
client が real `findMany` result を得たあと、two-way `SharedArrayBuffer` state の
`READ_READY` を parent に signal して create 前で wait する。A の immediate callback は
guarded probe write 後に child を release し、bounded wait で child の actual disabled
`create` が held lock により redacted storage failure になったことを確認する。

child process / test source is not an application worker registration and is never run by a queue,
scheduler, registry, handler, launchd service, or production entrypoint. It exists only in the
temporary fixture test and uses explicit `execArgv: ["--require", "tsx/cjs"]` when spawned. The
CJS preload keeps the child and its extensionless TypeScript dependency edges portable under the
repository's Node 20 `tsx --test` invocation.

### 4. historical fences remain independently checked

The exact C3p surface is limited to the following paths.

```text
docs/adr/0034-h-cycle-sqlite-write-transaction-primitive.md
src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.ts
src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-v1.test.ts
src/lib/loop-jobs/h-cycle-evaluation/h-cycle-sqlite-immediate-write-transaction-disable-child.ts
src/lib/loop-jobs/h-cycle-evaluation/h-cycle-one-shot-kind-isolation-v1.test.ts
src/lib/loop-jobs/dormant-worker-and-disposable-db.test.ts
src/lib/loop-jobs/harness-evaluation/h-eval-job-contract.test.ts
```

The C2 scope test adds all paths to its exact allowed list and pins the frozen local C3p design
artifact only when it is present. Its literal empty C3 manifest, actual-comment scanner, C3
projection, five original C2 hashes, forbidden-edge scan, and byte reconstruction remain unchanged.
The dormant and H-EVAL guards independently classify all C3p source paths and pin ADR-0034 and the
same local-only design artifact.

An executable source graph check must prove that the helper has exactly one `ImportDeclaration`
consumer, the C3p test; the test-support child has exactly one `new Worker(new URL(...))` reference,
also in that test, with the exact CJS preload; and no worker, registry, queue, delivery, index,
barrel, or production source imports or re-exports either module.

## 受入条件

1. structural fake observes `transaction` then named `immediate`, and callback receives `===` the
   injected connection;
2. actual second-client disabled append is blocked while A holds the immediate transaction after a
   real stale read, and returns only its existing redacted storage failure;
3. reverse busy fails before callback, redacts the helper result, and preserves a canonical ordered
   logical ledger / probe snapshot including relevant `sqlite_sequence` rows;
4. private sentinel throw rolls back the guarded probe write and returns the same redacted helper
   failure without exposing the sentinel;
5. both direct clients prove FK enforcement; duplicate guarded attempts retain one row and a second
   `RETURNING` is empty;
6. writer-first and disable-first observations use the actual public append path and make no
   compensating mutation;
7. no selected/local database, schema, migration, queue row, record row, runtime worker,
   scheduler, registry, handler, or launchd state is touched; and
8. all helper public outputs are frozen and contain no driver diagnostics.

## 非ゴール

- C3b generation-scoped enqueue / claim / recovery implementation
- C3c record writer / semantic full-control-history validator
- production direct SQLite connection injection boundary
- selected local SQLite migration or control event write
- registry / handler binding, worker entrypoint, scheduler / launchd install, first run, periodic
  execution, cache/token behavior, or activation authority

## Rollout

1. owner merge of C3a is read-only re-observed on `main`.
2. C3p executes one intentional structural RED with a helper stub, then minimum GREEN on a fresh
   worktree.
3. focused temporary-fixture and historical fence tests, lint, diff check, and sealed review gate
   the PR; merge remains owner-only.
4. only after C3p evidence is merged may C3b's generation-scoped enqueue / claim / recovery design
   be frozen. Runtime binding remains a separate operator decision.

## 代替案とトレードオフ

1. **Prisma transaction を immediate proof とみなす**: adapter source has not established the
   required named immediate or physical-connection behavior, so this is rejected.
2. **primitive が DB path / Prisma client を open する**: it would silently create operation
   authority and a second connection boundary, so this is rejected.
3. **busy / throw details を output に返す**: it leaks driver details without helping C3 callers,
   so one redacted storage failure is used.
4. **test child を runtime worker に register する**: it would turn temporary proof into execution
   authority, so child B remains a test-only source.
