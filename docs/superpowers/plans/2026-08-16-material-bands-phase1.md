# よみもの帯（MaterialBand）Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日次教科書生成の5repo×8件ハードキャップで捨てられていた材料（`droppedMaterialIds`）を、`MaterialBand`として全量保存し、ユーザーが1タップで正式な章に「編纂」できるようにする。あわせて捕捉判定を`DevEvent.incorporatedAt`という単一の正典に統一する。

**Architecture:** `clusterMaterialsIntoChapters`（章のクラスタリング本体）は無変更のまま、生成時にあふれた材料をrepo単位で`MaterialBand`へ保存する処理を追加する。`DailyTextbookChapter`/`DailyTextbookCheck`に`source`列（"auto"/"compiled"）を足し、「編纂する」で追加した章が「手元で再圧縮」で消えないよう、自動生成分だけを選択的に作り直す。

**Tech Stack:** Next.js App Router / Prisma(SQLite) / TypeScript / node:test（既存パターン踏襲。DBを触る関数は既存慣習どおり自動テストなし・手動ブラウザ確認）

**Spec:** `docs/superpowers/specs/2026-08-16-material-tiers-weekly-digest-design.md`

## Global Constraints

- LLM呼び出しは追加しない（規則ベースのみ。既存の`clusterMaterialsIntoChapters`/`draftChapterFromRepo`のロジックを再利用する）
- 既存の品質不変条件（`chaptersHaveDistinctCopy`, `chapterHasLessonSlots`）は`source="compiled"`の章にも適用する
- `droppedMaterialIds`列は互換のため残すが、新規生成では常に`"[]"`を書く
- 既存の`clusterMaterialsIntoChapters`本体・`TEXTBOOK_MAX_CHAPTERS`/`TEXTBOOK_MAX_MATERIALS_PER_CHAPTER`の値は変更しない
- 週のしょ（`WeeklyTextbook`）はPhase 2。本計画には含まない

---

## 対象外（Phase 2で扱う）

`WeeklyTextbook` / `WeeklyTextbookChapter` / `WeeklyTextbookCheck`と週次生成バッチは、Phase 1完了後に別のplanファイルで扱う。Phase 1単体で「材料が消えない」「選んで読める」は満たされる（design docの要件1・3）。要件2（回収儀式で墓場化を防ぐ）はPhase 2の週のしょで完成する。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `prisma/schema.prisma` | `MaterialBand`新設、`DevEvent.incorporatedAt`・`DailyTextbookChapter.source`・`DailyTextbookCheck.source`追加 |
| `src/lib/daily-textbook-shared.ts` | 純関数追加: `groupMaterialsIntoBandDrafts`, `distillSingleCheck`。`draftChapterFromRepo`をexportに変更 |
| `src/lib/daily-textbook.ts` | `generateDailyTextbook`改修（帯保存・incorporatedAt付与・compiled章保護）、新規`compileMaterialBand`・`loadMaterialBandsForDate` |
| `src/lib/actions.ts` | 新規`compileMaterialBandAction` |
| `src/components/living-atlas/load-atlas-data.ts` | `listMaterialCaptureHealth`をincorporatedAt基準に改修 |
| `src/components/living-atlas/atlas-daily-textbook.tsx` | 「よみもの帯」セクション追加 |
| `src/components/living-atlas/atlas-harness.tsx` | とりこぼしリンク・文言修正 |
| `src/app/(app)/retro/[dateKey]/page.tsx` | `loadMaterialBandsForDate`呼び出し追加 |
| `src/app/atlas-living.css` | 帯セクション用クラス追加 |
| `src/lib/daily-textbook.test.ts` | 新規テスト追加 |

---

### Task 1: スキーマ変更

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `MaterialBand`モデル、`DevEvent.incorporatedAt: DateTime?`、`DailyTextbookChapter.source: String @default("auto")`、`DailyTextbookCheck.source: String @default("auto")`

- [ ] **Step 1: スキーマを編集する**

`model DevEvent { ... }`ブロック内、`gates Gate[]`の直前に追加:

```prisma
  incorporatedAt DateTime? // 章（きょう／編纂／週のしょ）のいずれかに組み込まれた瞬間にセット
```

`model DailyTextbookChapter { ... }`ブロック内、`checks DailyTextbookCheck[]`の直前に追加:

```prisma
  source       String                 @default("auto") // "auto"（毎日自動生成）/ "compiled"（帯から編纂）
```

`model DailyTextbookCheck { ... }`ブロック内、`answeredAt DateTime?`の直後に追加:

```prisma
  source      String                @default("auto") // "auto" / "compiled"
```

ファイル末尾（`DailyTextbookCheck`モデルの後）に新規モデルを追加:

```prisma
// よみもの帯・書庫の実体。日次生成であふれた材料をrepo単位で保存する
// （2026-08-16、5repo×8件キャップでの取りこぼし対応）
model MaterialBand {
  id                String   @id @default(cuid())
  dateKey           String   // 材料を受け取った日 (JST)
  repo              String
  materialIds       String   // JSON string[]（あふれた DevEvent.id 全量）
  digest            String   // 1行サマリ
  count             Int
  compiledChapterId String?  // 「編纂する」で章に昇格したらセット
  createdAt         DateTime @default(now())

  @@unique([dateKey, repo])
}
```

- [ ] **Step 2: マイグレーションを作成・適用する**

Run: `cd /Users/koki/tools/applied-loop && npx prisma migrate dev --name material_bands_and_incorporated_at`

Expected: `Your database is now in sync with your schema.` と表示され、`prisma/migrations/`配下に新しいディレクトリが作られる

- [ ] **Step 3: Prisma Clientが再生成されたことを確認する**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし（新規追加した型はまだどこからも参照していないため、既存コードにエラーは出ない）

- [ ] **Step 4: コミット**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(daily-textbook): MaterialBandとincorporatedAt/source列を追加する"
```

---

### Task 2: 純関数 — あふれた材料をrepo単位の帯に束ねる

**Files:**
- Modify: `src/lib/daily-textbook-shared.ts`
- Test: `src/lib/daily-textbook.test.ts`

**Interfaces:**
- Consumes: `MaterialRow`型（既存）
- Produces: `export type BandDraft = { repo: string; materialIds: string[]; digest: string; count: number }`、`export function groupMaterialsIntoBandDrafts(materials: MaterialRow[]): BandDraft[]`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/daily-textbook.test.ts`の`import`に`groupMaterialsIntoBandDrafts`を追加し、`describe("clusterMaterialsIntoChapters", ...)`ブロックの直後に新しい`describe`を追加する:

```ts
describe("groupMaterialsIntoBandDrafts", () => {
  it("groups materials by repo with a short digest and count", () => {
    const materials = [
      mat({ id: "a1", repo: "triple-report-infra", summary: "fix: cron retry" }),
      mat({ id: "a2", repo: "triple-report-infra", summary: "feat: add queue" }),
      mat({ id: "b1", repo: "workbench", summary: "chore: bump deps" }),
    ];
    const bands = groupMaterialsIntoBandDrafts(materials);
    assert.equal(bands.length, 2);
    const infra = bands.find((b) => b.repo === "triple-report-infra");
    assert.ok(infra);
    assert.equal(infra!.count, 2);
    assert.deepEqual(infra!.materialIds.sort(), ["a1", "a2"]);
    assert.match(infra!.digest, /cron retry/);
    const wb = bands.find((b) => b.repo === "workbench");
    assert.equal(wb!.count, 1);
  });

  it("returns empty array for no materials", () => {
    assert.deepEqual(groupMaterialsIntoBandDrafts([]), []);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd /Users/koki/tools/applied-loop && npx tsx --test src/lib/daily-textbook.test.ts 2>&1 | tail -20`

Expected: `groupMaterialsIntoBandDrafts is not defined` 相当のエラーでFAIL

- [ ] **Step 3: 最小実装を書く**

`src/lib/daily-textbook-shared.ts`の`overflowDigest`関数（467行付近）の直前に追加:

```ts
export type BandDraft = {
  repo: string;
  materialIds: string[];
  digest: string;
  count: number;
};

/**
 * 章の予算（TEXTBOOK_MAX_CHAPTERS × TEXTBOOK_MAX_MATERIALS_PER_CHAPTER）から
 * あふれた材料を、repo単位の「よみもの帯」下書きに束ねる。LLM不要。
 */
export function groupMaterialsIntoBandDrafts(
  materials: MaterialRow[],
): BandDraft[] {
  const byRepo = new Map<string, MaterialRow[]>();
  for (const m of materials) {
    const list = byRepo.get(m.repo) ?? [];
    list.push(m);
    byRepo.set(m.repo, list);
  }
  const bands: BandDraft[] = [];
  for (const [repo, rows] of byRepo) {
    const sorted = [...rows].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    );
    const preview = sorted
      .slice(0, 3)
      .map((m) => (m.summary?.trim() || m.ref).slice(0, 28))
      .join("、");
    bands.push({
      repo,
      materialIds: sorted.map((m) => m.id),
      digest: preview,
      count: sorted.length,
    });
  }
  return bands.sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx tsx --test src/lib/daily-textbook.test.ts 2>&1 | tail -20`

Expected: `groupMaterialsIntoBandDrafts`関連の2件がPASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/daily-textbook-shared.ts src/lib/daily-textbook.test.ts
git commit -m "feat(daily-textbook): あふれた材料をrepo単位の帯にまとめる純関数を追加する"
```

---

### Task 3: 純関数 — 編纂した章に1問だけ確認問いを作る／`draftChapterFromRepo`をexport

**Files:**
- Modify: `src/lib/daily-textbook-shared.ts`
- Test: `src/lib/daily-textbook.test.ts`

**Interfaces:**
- Consumes: `ChapterDraft`型（既存）
- Produces: `export function draftChapterFromRepo(index, repo, kept, overflow): ChapterDraft`（既存関数の可視性変更のみ）、`export function distillSingleCheck(chapter: ChapterDraft): { chapterIndex: number; question: string }`

- [ ] **Step 1: 失敗するテストを書く**

`daily-textbook.test.ts`の`describe("distillChecks", ...)`ブロックの直後に追加（`import`に`distillSingleCheck`, `draftChapterFromRepo`を足す）:

```ts
describe("distillSingleCheck", () => {
  it("asks a work+timing question scoped to one chapter", () => {
    const materials = [
      mat({ id: "c1", repo: "triple-report-infra", summary: "fix: retry cron" }),
    ];
    const chapter = draftChapterFromRepo(1, "triple-report-infra", materials, []);
    const check = distillSingleCheck(chapter);
    assert.equal(check.chapterIndex, chapter.index);
    assert.match(check.question, new RegExp(chapter.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx tsx --test src/lib/daily-textbook.test.ts 2>&1 | tail -20`

Expected: `draftChapterFromRepo`または`distillSingleCheck`が未定義でFAIL（`draftChapterFromRepo`は現状`function`宣言のみでexportされていないため）

- [ ] **Step 3: 実装する**

`src/lib/daily-textbook-shared.ts`の527行目、`function draftChapterFromRepo(`を`export function draftChapterFromRepo(`に変更する（1箇所のみ、ロジックは変更しない）。

`distillChecks`関数（877行）の直前に追加:

```ts
/** 編纂（帯→章の昇格）で追加する1問だけの確認問い */
export function distillSingleCheck(
  chapter: ChapterDraft,
): { chapterIndex: number; question: string } {
  return {
    chapterIndex: chapter.index,
    question: `「${chapter.title}」で進めていた改修と、ナレッジが溜まったタイミングを1文で。とった対応も添えること。（改修: ${chapter.work.slice(0, 36)}）`,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx tsx --test src/lib/daily-textbook.test.ts 2>&1 | tail -20`

Expected: 全件PASS

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 6: コミット**

```bash
git add src/lib/daily-textbook-shared.ts src/lib/daily-textbook.test.ts
git commit -m "feat(daily-textbook): 編纂用の単一章生成・単一チェック生成をexportする"
```

---

### Task 4: `generateDailyTextbook`改修 — 帯保存・incorporatedAt付与・compiled章の保護

**Files:**
- Modify: `src/lib/daily-textbook.ts`

**Interfaces:**
- Consumes: `groupMaterialsIntoBandDrafts`（Task 2）, `prisma.materialBand`, `prisma.devEvent.updateMany`
- Produces: `generateDailyTextbook`の戻り値・シグネチャは不変（既存呼び出し元 `regenerateDailyTextbookAction` 等は無改修で動く）

現状（48-127行）は「既存の`DailyTextbook`行があれば`delete`→丸ごと`create`」という構造。これを「`source="auto"`のchapter/checkだけを削除して作り直す」構造に変える。あわせて、あふれた材料を`MaterialBand`にupsertし、章に入った（kept）材料の`DevEvent.incorporatedAt`をセットする。

- [ ] **Step 1: 既存の手動確認手順を用意する（自動テストではなく、プロジェクト既存の慣習に従いブラウザで確認する）**

このタスクはPrismaに依存するため`daily-textbook.test.ts`には追加しない（既存の`daily-textbook.ts`内DB関数はどれも自動テスト対象外。`clusterMaterialsIntoChapters`等の純粋ロジックだけがテスト対象、という既存の切り分けを踏襲する）。Step 5で手動確認する。

- [ ] **Step 2: `generateDailyTextbook`を書き換える**

`src/lib/daily-textbook.ts`の48-127行目（`export async function generateDailyTextbook`全体）を以下に置き換える:

```ts
export async function generateDailyTextbook(
  dateKey: string = dateKeyJST(),
): Promise<TextbookGenerateResult> {
  const materials = await loadMaterialsForDate(dateKey);
  const { chapters, droppedMaterialIds } =
    clusterMaterialsIntoChapters(materials);
  if (!chaptersHaveLessonSlots(chapters)) {
    throw new Error("generateDailyTextbook: lesson slots missing after cluster");
  }
  const checks = distillChecks(chapters);
  const peakHour = peakHourFromMaterials(materials);
  const title = `きょうのぼうけんのしょ — ${dateKey}`;
  const lead =
    materials.length === 0
      ? "この日の材料はまだない。実装の足跡が溜まると章が立つ。"
      : `材料 ${materials.length} 件 → 章 ${chapters.length}。新規も再圧縮も同じ規則で「なぜ／型／結果／別案」を埋める。磨くのは任意。`;

  const existing = await prisma.dailyTextbook.findUnique({
    where: { dateKey },
    select: { id: true },
  });

  let textbookId: string;
  if (existing) {
    textbookId = existing.id;
    // source="compiled" の章・チェック（編纂で足したもの）は再圧縮の対象外。
    // 自動生成分だけを作り直す（2026-08-16、Phase1設計の核心）。
    await prisma.dailyTextbookCheck.deleteMany({
      where: { textbookId, source: "auto" },
    });
    await prisma.dailyTextbookChapter.deleteMany({
      where: { textbookId, source: "auto" },
    });
    await prisma.dailyTextbook.update({
      where: { id: textbookId },
      data: {
        title,
        lead,
        status: "ready",
        materialCount: materials.length,
        chapterCount: chapters.length,
        peakHour,
        droppedMaterialIds: JSON.stringify([]),
      },
    });
    await prisma.dailyTextbookChapter.createMany({
      data: chapters.map((ch) => ({
        textbookId,
        index: ch.index,
        title: ch.title,
        oneLiner: ch.oneLiner,
        bodyPlain: ch.bodyPlain,
        bodyDeep: ch.bodyDeep,
        diagramKind: ch.diagramKind,
        evidenceJson: JSON.stringify(ch.evidence),
        materialIds: JSON.stringify(ch.materialIds),
        source: "auto",
      })),
    });
  } else {
    const created = await prisma.dailyTextbook.create({
      data: {
        dateKey,
        title,
        lead,
        status: "ready",
        materialCount: materials.length,
        chapterCount: chapters.length,
        peakHour,
        droppedMaterialIds: JSON.stringify([]),
        chapters: {
          create: chapters.map((ch) => ({
            index: ch.index,
            title: ch.title,
            oneLiner: ch.oneLiner,
            bodyPlain: ch.bodyPlain,
            bodyDeep: ch.bodyDeep,
            diagramKind: ch.diagramKind,
            evidenceJson: JSON.stringify(ch.evidence),
            materialIds: JSON.stringify(ch.materialIds),
            source: "auto",
          })),
        },
      },
    });
    textbookId = created.id;
  }

  const freshChapters = await prisma.dailyTextbookChapter.findMany({
    where: { textbookId, source: "auto" },
    select: { id: true, index: true },
  });
  const chapterIdByIndex = new Map(
    freshChapters.map((c) => [c.index, c.id] as const),
  );

  if (checks.length > 0) {
    await prisma.dailyTextbookCheck.createMany({
      data: checks.map((ck) => ({
        textbookId,
        chapterId:
          ck.chapterIndex != null
            ? (chapterIdByIndex.get(ck.chapterIndex) ?? null)
            : null,
        index: ck.index,
        question: ck.question,
        source: "auto",
      })),
    });
  }

  // あふれた材料を repo 単位で帯へ保存する（2026-08-16、取りこぼし対応）
  const droppedSet = new Set(droppedMaterialIds);
  const droppedMaterials = materials.filter((m) => droppedSet.has(m.id));
  const bandDrafts = groupMaterialsIntoBandDrafts(droppedMaterials);
  for (const band of bandDrafts) {
    await prisma.materialBand.upsert({
      where: { dateKey_repo: { dateKey, repo: band.repo } },
      update: {
        materialIds: JSON.stringify(band.materialIds),
        digest: band.digest,
        count: band.count,
      },
      create: {
        dateKey,
        repo: band.repo,
        materialIds: JSON.stringify(band.materialIds),
        digest: band.digest,
        count: band.count,
      },
    });
  }

  // 章に入った（kept）材料を「捕捉済み」として記録する（2026-08-16）
  const keptIds = chapters.flatMap((ch) => ch.materialIds);
  if (keptIds.length > 0) {
    await prisma.devEvent.updateMany({
      where: { id: { in: keptIds } },
      data: { incorporatedAt: new Date() },
    });
  }

  return {
    dateKey,
    textbookId,
    materialCount: materials.length,
    chapterCount: chapters.length,
    checkCount: checks.length,
    droppedMaterialIds,
    peakHour,
  };
}
```

ファイル冒頭のimportに`groupMaterialsIntoBandDrafts`を追加する（`daily-textbook-shared`からのimport一覧に足す）。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 4: 既存テストがすべて通ることを確認する**

Run: `npm test 2>&1 | tail -15`

Expected: 全件PASS（`clusterMaterialsIntoChapters`等の既存テストは無影響のはず）

- [ ] **Step 5: ブラウザで手動確認する**

`npm run dev:all`が動いていることを確認し、`/setup`で「手元で再圧縮（LLMなし）」相当の`regenerateDailyTextbookAction`をきょうの日付に対して実行できる画面（`/retro/{today}`）を開き、生成後に`npx prisma studio`または直接クエリで`MaterialBand`行が作られていること、`DevEvent.incorporatedAt`が章に入った材料にセットされていることを確認する。

Run: `cd /Users/koki/tools/applied-loop && node -e "
const { PrismaClient } = require('./src/generated/prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const p = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:./dev.db' }) });
p.materialBand.findMany({ take: 5 }).then((r) => { console.log(r); return p.\$disconnect(); });
"`

Expected: 直近生成分の`MaterialBand`行が（もしその日にあふれた材料があれば）出力される。無くてもエラーにならないことを確認する

- [ ] **Step 6: コミット**

```bash
git add src/lib/daily-textbook.ts
git commit -m "feat(daily-textbook): 生成時にあふれた材料を帯へ保存しincorporatedAtを付ける"
```

---

### Task 5: 「編纂する」— MaterialBandを正式な章に昇格させる

**Files:**
- Modify: `src/lib/daily-textbook.ts`
- Modify: `src/lib/actions.ts`

**Interfaces:**
- Consumes: `draftChapterFromRepo`, `distillSingleCheck`（Task 3）
- Produces: `export async function compileMaterialBand(bandId: string): Promise<{ chapterId: string; dateKey: string }>`（`daily-textbook.ts`）、`export async function compileMaterialBandAction(bandId: string)`（`actions.ts`、UIから呼ぶ）

- [ ] **Step 1: `compileMaterialBand`を実装する**

`src/lib/daily-textbook.ts`の`generateDailyTextbook`関数の直後（128行目付近）に追加:

```ts
/** よみもの帯を、今日の教科書に追加章として編纂する（2026-08-16） */
export async function compileMaterialBand(
  bandId: string,
): Promise<{ chapterId: string; dateKey: string }> {
  const band = await prisma.materialBand.findUnique({ where: { id: bandId } });
  if (!band) throw new Error(`compileMaterialBand: band not found: ${bandId}`);
  if (band.compiledChapterId) {
    return { chapterId: band.compiledChapterId, dateKey: band.dateKey };
  }

  const ids: string[] = JSON.parse(band.materialIds);
  const events = await prisma.devEvent.findMany({
    where: { id: { in: ids } },
    orderBy: { receivedAt: "desc" },
  });
  const materials: MaterialRow[] = events.map((e) => ({
    id: e.id,
    kind: e.kind,
    repo: e.repo,
    ref: e.ref,
    summary: e.summary,
    skipReason: e.skipReason,
    receivedAt: e.receivedAt,
  }));

  const kept = materials.slice(0, TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);
  const overflow = materials.slice(TEXTBOOK_MAX_MATERIALS_PER_CHAPTER);

  let textbook = await prisma.dailyTextbook.findUnique({
    where: { dateKey: band.dateKey },
  });
  if (!textbook) {
    await generateDailyTextbook(band.dateKey);
    textbook = await prisma.dailyTextbook.findUnique({
      where: { dateKey: band.dateKey },
    });
    if (!textbook) throw new Error("compileMaterialBand: textbook creation failed");
  }

  const maxIndex = await prisma.dailyTextbookChapter.aggregate({
    where: { textbookId: textbook.id },
    _max: { index: true },
  });
  const nextIndex = (maxIndex._max.index ?? 0) + 1;

  const draft = draftChapterFromRepo(nextIndex, band.repo, kept, overflow);
  if (!chapterHasLessonSlots(draft)) {
    throw new Error("compileMaterialBand: lesson slots missing");
  }

  const chapter = await prisma.dailyTextbookChapter.create({
    data: {
      textbookId: textbook.id,
      index: draft.index,
      title: draft.title,
      oneLiner: draft.oneLiner,
      bodyPlain: draft.bodyPlain,
      bodyDeep: draft.bodyDeep,
      diagramKind: draft.diagramKind,
      evidenceJson: JSON.stringify(draft.evidence),
      materialIds: JSON.stringify(draft.materialIds),
      source: "compiled",
    },
  });

  const maxCheckIndex = await prisma.dailyTextbookCheck.aggregate({
    where: { textbookId: textbook.id },
    _max: { index: true },
  });
  const check = distillSingleCheck(draft);
  await prisma.dailyTextbookCheck.create({
    data: {
      textbookId: textbook.id,
      chapterId: chapter.id,
      index: (maxCheckIndex._max.index ?? 0) + 1,
      question: check.question,
      source: "compiled",
    },
  });

  await prisma.devEvent.updateMany({
    where: { id: { in: kept.map((m) => m.id) } },
    data: { incorporatedAt: new Date() },
  });
  await prisma.materialBand.update({
    where: { id: band.id },
    data: { compiledChapterId: chapter.id },
  });

  return { chapterId: chapter.id, dateKey: band.dateKey };
}

/** 指定日の帯（未編纂・編纂済み双方）を新しい順で返す */
export async function loadMaterialBandsForDate(dateKey: string): Promise<
  Array<{
    id: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
    createdAt: Date;
  }>
> {
  return prisma.materialBand.findMany({
    where: { dateKey },
    orderBy: { count: "desc" },
    select: {
      id: true,
      repo: true,
      digest: true,
      count: true,
      compiledChapterId: true,
      createdAt: true,
    },
  });
}
```

ファイル冒頭のimportに`draftChapterFromRepo`, `distillSingleCheck`, `TEXTBOOK_MAX_MATERIALS_PER_CHAPTER`, `chapterHasLessonSlots`（単数形。既存importの`chaptersHaveLessonSlots`＝複数形とは別物なので両方importする）を`daily-textbook-shared`から追加する。

- [ ] **Step 2: server actionを追加する**

`src/lib/actions.ts`の`regenerateDailyTextbookAction`（712-719行）の直後に追加:

```ts
/** よみもの帯を今日の教科書に編纂する（2026-08-16） */
export async function compileMaterialBandAction(bandId: string) {
  await requireAuth();
  const { compileMaterialBand } = await import("@/lib/daily-textbook");
  const result = await compileMaterialBand(bandId);
  revalidatePath(`/retro/${result.dateKey}`);
  revalidatePath("/harness");
  return result;
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 4: 既存テストが通ることを確認する**

Run: `npm test 2>&1 | tail -10`

Expected: 全件PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/daily-textbook.ts src/lib/actions.ts
git commit -m "feat(daily-textbook): よみもの帯を章に編纂するアクションを追加する"
```

---

### Task 6: しくみのこどう指標を `incorporatedAt` 基準に再定義する

**Files:**
- Modify: `src/lib/daily-textbook.ts`

**Interfaces:**
- Consumes: `prisma.devEvent.groupBy`
- Produces: `listMaterialCaptureHealth`の戻り値の型は不変（`{dateKey, materialCount, droppedCount}[]`）だが算出方法を変更。呼び出し元（`load-atlas-data.ts`の`loadMaterialCaptureHealth`）は無改修で動く

現状（319-338行）は生成時点の`DailyTextbook.droppedMaterialIds`という**スナップショット**から算出しており、あとから編纂しても指標が改善されない。`DevEvent.incorporatedAt`という**生きた状態**から算出するよう書き換える。

- [ ] **Step 1: 実装を書き換える**

`src/lib/daily-textbook.ts`の319-338行目を以下に置き換える:

```ts
/**
 * 日次教科書が「材料を漏れなく拾えているか」(ADR-0020 §6-4)。
 * incorporatedAt が付いた（章・編纂・週のしょのいずれかに組み込まれた）
 * 材料の割合で測る。編纂すればその日の数値も遡って改善する（生きた指標。
 * 2026-08-16、生成時スナップショットのdroppedMaterialIdsから移行）。
 */
export async function listMaterialCaptureHealth(limit = 14): Promise<
  Array<{
    dateKey: string;
    materialCount: number;
    droppedCount: number;
  }>
> {
  const textbooks = await prisma.dailyTextbook.findMany({
    orderBy: { dateKey: "desc" },
    take: limit,
    select: { dateKey: true },
  });
  const results: Array<{ dateKey: string; materialCount: number; droppedCount: number }> = [];
  for (const tb of textbooks) {
    const { start, end } = dayRangeFromDateKey(tb.dateKey);
    const [materialCount, incorporatedCount] = await Promise.all([
      prisma.devEvent.count({
        where: { receivedAt: { gte: start, lt: end } },
      }),
      prisma.devEvent.count({
        where: {
          receivedAt: { gte: start, lt: end },
          incorporatedAt: { not: null },
        },
      }),
    ]);
    results.push({
      dateKey: tb.dateKey,
      materialCount,
      droppedCount: materialCount - incorporatedCount,
    });
  }
  return results.reverse();
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 3: ブラウザで手動確認する**

`/harness`を開き、「しくみのこどう」パネルの捕捉率が表示されること（クラッシュしないこと）を確認する。Task 4完了後の状態であれば、章に入った材料の分だけ捕捉率が計算に反映されているはず

- [ ] **Step 4: コミット**

```bash
git add src/lib/daily-textbook.ts
git commit -m "fix(harness): しくみのこどうの捕捉率をincorporatedAt基準の生きた指標にする"
```

---

### Task 7: にっきUI — よみもの帯セクション

**Files:**
- Modify: `src/app/(app)/retro/[dateKey]/page.tsx`
- Modify: `src/components/living-atlas/atlas-daily-textbook.tsx`
- Modify: `src/app/atlas-living.css`

**Interfaces:**
- Consumes: `loadMaterialBandsForDate`（Task 5）, `compileMaterialBandAction`（Task 5）

- [ ] **Step 1: ページで帯を読み込む**

`src/app/(app)/retro/[dateKey]/page.tsx`の`Promise.all`（21-31行）に`loadMaterialBandsForDate(dateKey)`を追加し、`<AtlasDailyTextbook>`へ`bands`propとして渡す:

```tsx
import {
  dayRangeFromDateKey,
  loadDailyTextbook,
  loadMaterialBandsForDate,
} from "@/lib/daily-textbook";
// ...
  const [textbook, materialCount, sessionDigest, bands] =
    await Promise.all([
      loadDailyTextbook(dateKey),
      (() => {
        const { start, end } = dayRangeFromDateKey(dateKey);
        return prisma.devEvent.count({
          where: { receivedAt: { gte: start, lt: end } },
        });
      })(),
      buildSessionDigestForDate(dateKey),
      loadMaterialBandsForDate(dateKey),
    ]);

  return (
    <AtlasDailyTextbook
      dateKey={dateKey}
      textbook={textbook}
      wsToken={getTerminalWsToken()}
      materialCountToday={materialCount}
      sessionDigest={sessionDigest}
      bands={bands}
    />
  );
```

- [ ] **Step 2: コンポーネントに帯セクションを追加する**

`src/components/living-atlas/atlas-daily-textbook.tsx`の`import`に`compileMaterialBandAction`を追加し（`regenerateDailyTextbookAction`の並びに足す）、`AtlasDailyTextbook`のprops型に`bands`を追加する（45-58行）:

```tsx
export function AtlasDailyTextbook({
  dateKey,
  textbook,
  wsToken,
  materialCountToday,
  sessionDigest,
  bands,
}: {
  dateKey: string;
  textbook: TextbookView | null;
  wsToken: string | null;
  materialCountToday?: number;
  sessionDigest?: SessionDigest | null;
  bands?: Array<{
    id: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
    createdAt: Date;
  }>;
}) {
```

`GenerateButton`関数（564-589行）の直前に新規コンポーネントを追加する:

```tsx
function daysAgo(createdAt: Date): number {
  const ms = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

const BAND_ARCHIVE_AFTER_DAYS = 7;

function MaterialBandShelf({
  bands,
  startTransition,
  pending,
}: {
  bands: NonNullable<Parameters<typeof AtlasDailyTextbook>[0]["bands"]>;
  startTransition: (fn: () => void) => void;
  pending: boolean;
}) {
  const open = bands.filter((b) => !b.compiledChapterId);
  if (open.length === 0) return null;
  return (
    <section className="atlas-band-shelf">
      <p className="atlas-band-shelf__title">
        よみもの帯 ／ 材料 {open.reduce((s, b) => s + b.count, 0)}
      </p>
      <ul className="atlas-band-shelf__list">
        {open.map((b) => {
          const age = daysAgo(b.createdAt);
          const remaining = BAND_ARCHIVE_AFTER_DAYS - age;
          return (
            <li key={b.id} className="atlas-band-shelf__item">
              <div className="atlas-band-shelf__meta">
                <span className="atlas-band-shelf__repo">{b.repo}</span>
                <span className="atlas-band-shelf__count">材料 {b.count}</span>
              </div>
              <p className="atlas-band-shelf__digest">{b.digest}</p>
              <div className="atlas-band-shelf__footer">
                <span className="atlas-band-shelf__age">
                  {remaining > 0
                    ? `あと${remaining}日で書庫へ`
                    : "まもなく書庫へ"}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  className="dq-btn dq-btn-ghost !px-2 !py-1 text-[8px]"
                  onClick={() => {
                    startTransition(async () => {
                      await compileMaterialBandAction(b.id);
                    });
                  }}
                >
                  編纂する
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

`atlas-daily-textbook.tsx`の426行目（`{textbook.chapters.length === 0 ? ... : null}`の閉じ）と428行目（`{wsToken && activeChapter ? (`）の間（427行目の空行）に挿入する:

```tsx
          <MaterialBandShelf
            bands={bands ?? []}
            startTransition={startTransition}
            pending={pending}
          />
```

- [ ] **Step 3: CSSを追加する**

`src/app/atlas-living.css`の末尾に追加:

```css
/* —— よみもの帯（Phase1、2026-08-16） —— */
.atlas-band-shelf {
  margin-top: 24px;
  padding: 12px;
  border: 1px solid #2a3a5a;
  background: rgba(13, 47, 112, 0.35);
}

.atlas-band-shelf__title {
  margin: 0 0 8px;
  font-family: var(--font-pixel);
  font-size: 9px;
  color: var(--atlas-cream-dim);
}

.atlas-band-shelf__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.atlas-band-shelf__item {
  padding: 8px;
  border: 1px solid #2a3a5a;
}

.atlas-band-shelf__meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.atlas-band-shelf__repo {
  color: var(--atlas-cream);
}

.atlas-band-shelf__count {
  color: var(--atlas-cream-dim);
}

.atlas-band-shelf__digest {
  margin: 4px 0;
  font-size: 12px;
  color: var(--atlas-cream-dim);
}

.atlas-band-shelf__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.atlas-band-shelf__age {
  font-size: 10px;
  color: var(--atlas-cream-dim);
}
```

（`--atlas-cream`, `--atlas-cream-dim`は`atlas-living.css`8-9行目で定義済みの既存変数。そのまま使ってよい）

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 5: ブラウザで実機確認する**

材料があふれている日（Task 4完了後に再圧縮した日、または過去の高活動日）の`/retro/{dateKey}`を開き、「よみもの帯」セクションが表示されること、「編纂する」を押すと章が追加され帯から消えることを確認する

- [ ] **Step 6: コミット**

```bash
git add "src/app/(app)/retro/[dateKey]/page.tsx" src/components/living-atlas/atlas-daily-textbook.tsx src/app/atlas-living.css
git commit -m "feat(living-atlas): にっきによみもの帯セクションを追加する"
```

---

### Task 8: どうぐUI — とりこぼしリンクの修正

**Files:**
- Modify: `src/components/living-atlas/atlas-harness.tsx`

**Interfaces:**
- Consumes: `today.dateKey`（`MaterialCaptureHealth.days[]`要素型に既存）

- [ ] **Step 1: リンク先とキャプションを修正する**

（`load-atlas-data.ts:749`の`MaterialCaptureHealth.days`要素型は既に`{ dateKey: string; materialCount: number; droppedCount: number }`。`today.dateKey`はそのまま使える）

`src/components/living-atlas/atlas-harness.tsx`の486-495行目を以下に置き換える:

```tsx
      <div className="atlas-dg-flow-caption">
        <p>
          {dropped > 0
            ? `かまどで こぼれた ${dropped} は、まだ 消えてはおらぬ。よみもの帯に 置いてある。`
            : "きょうは まだ 一粒も こぼれておらぬ。この まま 焼き上げてよい。"}
        </p>
        <Link href={`/retro/${today.dateKey}`} className="atlas-link-gold">
          {dropped > 0 ? "よみもの帯を みる" : "きょうの教科書を みる"}
        </Link>
      </div>
```

377-379行目の説明文も実態に合わせて改稿する:

```tsx
      <p className="atlas-win-px__lead">
        実装の足あとが、どこで どれだけ こぼれているか。管の中の粒が材料じゃ。
        かまどの下に落ちた粒は、だまって消えたのではなく
        <span style={{ color: "var(--atlas-danger)" }}> とりこぼし </span>
        として よみもの帯に 残っておる。ひろい直せる。
      </p>
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 3: ブラウザで実機確認する**

`/harness`を開き、「材料のながれ」パネルのリンクが実際に該当日の`/retro/{dateKey}`（よみもの帯が見える場所）に飛ぶことを確認する

- [ ] **Step 4: コミット**

```bash
git add src/components/living-atlas/atlas-harness.tsx
git commit -m "fix(living-atlas): とりこぼしのリンクを実際のよみもの帯に向ける"
```

---

### Task 9: 書庫ページ（`/retro/archive`）

**Files:**
- Create: `src/app/(app)/retro/archive/page.tsx`
- Create: `src/app/(app)/retro/archive/loading.tsx`
- Create: `src/components/living-atlas/atlas-material-archive.tsx`
- Modify: `src/lib/daily-textbook.ts`

**Interfaces:**
- Consumes: `prisma.materialBand`
- Produces: `export async function loadMaterialArchive(query?: string): Promise<Array<{ id: string; dateKey: string; repo: string; digest: string; count: number; compiledChapterId: string | null }>>`

- [ ] **Step 1: ローダーを追加する**

`src/lib/daily-textbook.ts`の`loadMaterialBandsForDate`の直後に追加:

```ts
/** 書庫: 全期間の帯を検索する（読む前提ゼロ・引く時に引く） */
export async function loadMaterialArchive(query?: string): Promise<
  Array<{
    id: string;
    dateKey: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
  }>
> {
  const rows = await prisma.materialBand.findMany({
    where: query
      ? {
          OR: [
            { repo: { contains: query } },
            { digest: { contains: query } },
          ],
        }
      : undefined,
    orderBy: { dateKey: "desc" },
    take: 200,
    select: {
      id: true,
      dateKey: true,
      repo: true,
      digest: true,
      count: true,
      compiledChapterId: true,
    },
  });
  return rows;
}
```

- [ ] **Step 2: ページコンポーネントを作る**

`src/app/(app)/retro/archive/page.tsx`:

```tsx
import { loadMaterialArchive } from "@/lib/daily-textbook";
import { AtlasMaterialArchive } from "@/components/living-atlas/atlas-material-archive";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ q?: string }>;
};

export default async function MaterialArchivePage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const bands = await loadMaterialArchive(sp.q);
  return <AtlasMaterialArchive bands={bands} query={sp.q ?? ""} />;
}
```

`src/app/(app)/retro/archive/loading.tsx`:

```tsx
import { AtlasRouteLoading } from "@/components/living-atlas/atlas-route-loading";

export default function Loading() {
  return <AtlasRouteLoading variant="compact" />;
}
```

- [ ] **Step 3: 表示コンポーネントを作る**

`src/components/living-atlas/atlas-material-archive.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AtlasShell } from "./atlas-shell";
import { AtlasPageTitle } from "./atlas-chrome";

export function AtlasMaterialArchive({
  bands,
  query,
}: {
  bands: Array<{
    id: string;
    dateKey: string;
    repo: string;
    digest: string;
    count: number;
    compiledChapterId: string | null;
  }>;
  query: string;
}) {
  const [q, setQ] = useState(query);
  const router = useRouter();

  return (
    <AtlasShell>
      <section className="atlas-win-px atlas-px-cut">
        <AtlasPageTitle title="書庫" sub="読む前提ゼロ。引く時に引く" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/retro/archive?q=${encodeURIComponent(q)}`);
          }}
          className="atlas-archive-search"
        >
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="repo名・本文で検索"
            className="atlas-archive-search__input"
          />
          <button type="submit" className="dq-btn !px-3 !py-2 text-[8px]">
            さがす
          </button>
        </form>
        <ul className="atlas-archive-list">
          {bands.map((b) => (
            <li key={b.id} className="atlas-archive-list__item">
              <span className="atlas-archive-list__date">{b.dateKey}</span>
              <span className="atlas-archive-list__repo">{b.repo}</span>
              <span className="atlas-archive-list__digest">{b.digest}</span>
              <span className="atlas-archive-list__count">{b.count}件</span>
              {b.compiledChapterId ? (
                <span className="atlas-archive-list__done">編纂済み</span>
              ) : null}
            </li>
          ))}
          {bands.length === 0 ? (
            <li className="atlas-archive-list__empty">見当たらぬ。</li>
          ) : null}
        </ul>
      </section>
    </AtlasShell>
  );
}
```

- [ ] **Step 4: CSSを追加する**

`src/app/atlas-living.css`末尾に追加:

```css
/* —— 書庫（Phase1、2026-08-16） —— */
.atlas-archive-search {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.atlas-archive-search__input {
  flex: 1;
  padding: 6px 8px;
  background: #000814;
  border: 1px solid #2a3a5a;
  color: var(--atlas-cream);
  font-size: 12px;
}

.atlas-archive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.atlas-archive-list__item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid #2a3a5a;
  font-size: 12px;
  color: var(--atlas-cream-dim);
}

.atlas-archive-list__date {
  color: var(--atlas-cream);
  font-family: var(--font-pixel);
  font-size: 9px;
}

.atlas-archive-list__done {
  color: var(--atlas-gold);
}

.atlas-archive-list__empty {
  padding: 12px;
  color: var(--atlas-cream-dim);
}
```

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし

- [ ] **Step 6: ブラウザで実機確認する**

`/retro/archive`を開き一覧が出ること、検索フォームで絞り込めることを確認する

- [ ] **Step 7: コミット**

```bash
git add "src/app/(app)/retro/archive" src/components/living-atlas/atlas-material-archive.tsx src/lib/daily-textbook.ts src/app/atlas-living.css
git commit -m "feat(living-atlas): 材料の書庫ページを追加する"
```

---

## 最終確認（全タスク完了後）

- [ ] `npx tsc --noEmit -p .` — 既知の無関係エラー1件のみ
- [ ] `npm test` — 全件PASS
- [ ] `npm run audit:onboarding` — 全件OK
- [ ] ブラウザで一通りの動線を実機確認: `/harness`のとりこぼしリンク → `/retro/{dateKey}`のよみもの帯 → 編纂 → 章が増える → `/harness`の指標が変わる → `/retro/archive`で検索できる
