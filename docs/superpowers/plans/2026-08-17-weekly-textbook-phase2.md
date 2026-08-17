# 週のしょ（WeeklyTextbook）Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日次教科書の5repo×8件キャップで週内に拾いきれなかった材料（`incorporatedAt`がnullのDevEvent）を、直前に完了した1週間ぶん再クラスタリングして「週のしょ」として1冊にまとめる。週次レビューという「唯一の持続的な回収儀式」を実装し、Phase1（よみもの帯・書庫）だけでは埋まらない「墓場化」を防ぐ。

**Architecture:** 週次生成は`clusterMaterialsIntoChapters`・`distillChecks`・`draftChapterFromRepo`など日次で使っている純関数をそのまま再利用し、日次パイプライン自体（`generateDailyTextbook`・`clusterMaterialsIntoChapters`本体）は一切変更しない。起動経路はkoki承認済みのハイブリッド方式: (a) 月曜09:00にlaunchd cronがstandaloneスクリプトを叩いて自動生成、(b) `/retro`訪問時にサーバー側で直近8週の欠落をサイレントに補完生成（lazy fallback）。両経路は同じ`ensureRecentWeeklyTextbooks()`を呼ぶ一本の入口に統一する。週のしょは「閉じた過去の週のスナップショット」なので、日次と違い再生成（regenerate）ボタンは持たない——同じweekKeyに対する2回目以降の生成は常にno-op（idempotent）。

**Tech Stack:** Next.js App Router / Prisma(SQLite, `PrismaBetterSqlite3`アダプタ) / TypeScript / node:test（純関数のみ自動テスト、DB統合はPhase1同様に使い捨て検証スクリプト＋バックアップ）

**Spec:** `docs/superpowers/specs/2026-08-16-material-tiers-weekly-digest-design.md`

**関連の確定事項（本セッションでkoki承認済み、spec本文には無い決定）:**
- 週次生成の起動経路はハイブリッド方式（cron＋lazyフォールバック）。理由: このアプリはdevサーバーが常時起動している保証のない個人ツールで、cron単体だと「発火時にサーバーが落ちていて週のしょが無い」というUXの裏切りが起きる。lazyフォールバックが取りこぼしをゼロにする。
- 対象週は「直前に完了した週（先週分）」。GTD週次レビューの「終わった週を振り返る」という本質に合わせる。
- 週のしょに「編纂」相当の追加機能は作らない（Phase2スコープ外）。週次クラスタリングで拾いきれなかった分は書庫（`MaterialBand`、Phase1実装済み）だけで発見可能にする（spec L215）。

## Global Constraints

- LLM呼び出しは追加しない（規則ベースのみ。既存の`clusterMaterialsIntoChapters`/`draftChapterFromRepo`/`distillChecks`をそのまま再利用する）
- `clusterMaterialsIntoChapters`本体・`TEXTBOOK_MAX_CHAPTERS`(5)/`TEXTBOOK_MAX_MATERIALS_PER_CHAPTER`(8)の値は変更しない。日次パイプラインへの影響ゼロを保つ
- 週のしょは「編纂」を持たない。`MaterialBand`テーブルへの書き込み（create/update/delete）は一切行わない。読み取りもしない——書庫はPhase1の実装のまま独立して動く
- 週次生成は同一`weekKey`に対して冪等（既に`WeeklyTextbook`行があれば即return、削除→再作成はしない）
- 材料0件の週は`WeeklyTextbook`行を作らない（空の儀式を作らない。HEYの"countless"設計・スペック過負荷防止原則5を踏襲）
- 新規の最上位ナビは作らない。`/retro`ページ内の既存棚まわりに1リンクを添えるだけ
- じゅもん注入（LLMアシスト機能）は週のしょには実装しない（Phase2スコープ外、spec対象外セクション「LLMベースの重要度分類」と同じ理由でLLM呼び出しゼロを維持）

---

## 対象外（将来検討）

- 週のしょの一覧・過去週ブラウザページ（`/retro/weekly`のindex）。Phase2は最新1週間へのリンクのみ
- 案F（クエスト掲示板スキン）
- 週のしょに対する「編纂」相当の再クラスタリング操作
- `droppedMaterialIds`列自体の削除

---

## File Structure

| ファイル | 責務 |
|---|---|
| `prisma/schema.prisma` | `WeeklyTextbook`/`WeeklyTextbookChapter`/`WeeklyTextbookCheck`新設 |
| `src/lib/weekly-textbook-shared.ts`（新規） | 純関数: 週境界計算・タイトル/リード文生成・型定義 |
| `src/lib/weekly-textbook.ts`（新規） | DB操作: 生成・冪等バックフィル・読み込み・Mastery更新 |
| `src/lib/actions.ts` | 新規`setWeeklyCheckMasteryAction` |
| `src/app/(app)/retro/page.tsx` | `ensureRecentWeeklyTextbooks`呼び出し＋最新週サマリ取得 |
| `src/components/living-atlas/atlas-nikki-retro.tsx` | 「週のしょ」リンクchip追加 |
| `src/app/(app)/retro/weekly/[weekKey]/page.tsx`（新規） | 週のしょ詳細ページ |
| `src/app/(app)/retro/weekly/[weekKey]/loading.tsx`（新規） | ロードUI（既存`AtlasRouteLoading`流用） |
| `src/components/living-atlas/atlas-weekly-textbook.tsx`（新規） | 週のしょ表示コンポーネント（章＋確認問い＋Mastery） |
| `src/app/atlas-living.css` | 週のしょ用クラス追加（大部分は既存`atlas-journal__*`を再利用） |
| `scripts/generate-weekly-textbook.ts`（新規） | standaloneスクリプト（cron用） |
| `scripts/weekly-textbook.sh`（新規） | launchd用シェルラッパー |
| `scripts/com.applied-loop.weekly-textbook.plist`（新規） | launchd定義（月曜09:00） |
| `src/lib/weekly-textbook-shared.test.ts`（新規） | 純関数テスト |

---

### Task 1: スキーマ変更

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `WeeklyTextbook`/`WeeklyTextbookChapter`/`WeeklyTextbookCheck`モデル

- [ ] **Step 1: スキーマにモデルを追加する**

`prisma/schema.prisma`の`model MaterialBand { ... }`ブロック（ファイル末尾、308-319行）の直後に追加:

```prisma

// 週のしょ (Phase 2)。直前に完了した週で incorporatedAt が null のままの
// DevEvent を再クラスタリングし、週次レビューという回収儀式を実装する。
model WeeklyTextbook {
  id            String   @id @default(cuid())
  weekKey       String   @unique // ISO週 "2026-W33"（JST基準、weekKeyJST()）
  title         String
  lead          String?
  status        String   @default("ready")
  materialCount Int      @default(0)
  chapterCount  Int      @default(0)
  createdAt     DateTime @default(now())
  chapters      WeeklyTextbookChapter[]
  checks        WeeklyTextbookCheck[]
}

model WeeklyTextbookChapter {
  id           String   @id @default(cuid())
  weeklyId     String
  weekly       WeeklyTextbook @relation(fields: [weeklyId], references: [id], onDelete: Cascade)
  index        Int
  title        String
  oneLiner     String
  bodyPlain    String
  bodyDeep     String?
  diagramKind  String   @default("generic")
  evidenceJson String   @default("[]")
  materialIds  String   @default("[]")
  checks       WeeklyTextbookCheck[]

  @@unique([weeklyId, index])
}

model WeeklyTextbookCheck {
  id         String   @id @default(cuid())
  weeklyId   String
  weekly     WeeklyTextbook @relation(fields: [weeklyId], references: [id], onDelete: Cascade)
  chapterId  String?
  chapter    WeeklyTextbookChapter? @relation(fields: [chapterId], references: [id], onDelete: SetNull)
  index      Int
  question   String
  mastery    String?
  answeredAt DateTime?

  @@unique([weeklyId, index])
}
```

- [ ] **Step 2: マイグレーションを作成・適用する**

Run: `cd /Users/koki/tools/applied-loop && npx prisma migrate dev --name weekly_textbook`

Expected: `Your database is now in sync with your schema.` と表示され、`prisma/migrations/`配下に新しいディレクトリ（`<timestamp>_weekly_textbook`）が作られる

- [ ] **Step 3: 型チェックで既存コードに影響が無いことを確認する**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`

Expected: 出力なし（新規モデルはまだどこからも参照していない）

- [ ] **Step 4: コミット**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(weekly-textbook): WeeklyTextbook/Chapter/Checkスキーマを追加する"
```

---

### Task 2: 純関数 — 週境界計算とタイトル/リード文生成

**Files:**
- Create: `src/lib/weekly-textbook-shared.ts`
- Test: `src/lib/weekly-textbook-shared.test.ts`

**Interfaces:**
- Consumes: `weekStartJST`/`weekRangeJST`（`@/lib/date`、既存）
- Produces:
  - `export type WeekRange = { start: Date; end: Date; weekKey: string }`
  - `export function lastCompletedWeekRangeJST(now?: Date): WeekRange`
  - `export function recentCompletedWeekRanges(now?: Date, count?: number): WeekRange[]`
  - `export function buildWeeklyTitle(weekKey: string): string`
  - `export function buildWeeklyLead(materialCount: number, chapterCount: number): string`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/weekly-textbook-shared.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWeeklyLead,
  buildWeeklyTitle,
  lastCompletedWeekRangeJST,
  recentCompletedWeekRanges,
} from "./weekly-textbook-shared";

describe("lastCompletedWeekRangeJST", () => {
  it("returns the Monday-to-Monday range of the week before the current one", () => {
    // 2026-08-17 は月曜 (JST)。今週の月曜00:00の1つ前の週を返すはず。
    const now = new Date("2026-08-17T01:00:00Z"); // 2026-08-17 10:00 JST (月)
    const range = lastCompletedWeekRangeJST(now);
    assert.equal(range.weekKey, "2026-W33");
    assert.equal(range.start.toISOString(), "2026-08-09T15:00:00.000Z"); // 2026-08-10 00:00 JST (月)
    assert.equal(range.end.toISOString(), "2026-08-16T15:00:00.000Z"); // 2026-08-17 00:00 JST (月)
  });

  it("stays in the previous week even mid-week", () => {
    const now = new Date("2026-08-19T12:00:00Z"); // 水曜 JST
    const range = lastCompletedWeekRangeJST(now);
    assert.equal(range.weekKey, "2026-W33");
  });
});

describe("recentCompletedWeekRanges", () => {
  it("returns `count` distinct weeks, most recent first, excluding the current week", () => {
    const now = new Date("2026-08-17T01:00:00Z");
    const ranges = recentCompletedWeekRanges(now, 3);
    assert.equal(ranges.length, 3);
    assert.deepEqual(
      ranges.map((r) => r.weekKey),
      ["2026-W33", "2026-W32", "2026-W31"],
    );
  });
});

describe("buildWeeklyTitle / buildWeeklyLead", () => {
  it("builds a title with the weekKey", () => {
    assert.equal(buildWeeklyTitle("2026-W33"), "週のしょ — 2026-W33");
  });

  it("builds a lead describing material and chapter counts", () => {
    const lead = buildWeeklyLead(12, 3);
    assert.match(lead, /12 件/);
    assert.match(lead, /章 3/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx tsx --test src/lib/weekly-textbook-shared.test.ts`
Expected: FAIL（`weekly-textbook-shared.ts`が存在しない）

- [ ] **Step 3: 実装する**

Create `src/lib/weekly-textbook-shared.ts`:

```ts
/**
 * 週のしょの純関数・型 (クライアント可)。DB は weekly-textbook.ts。
 */

import { weekRangeJST, weekStartJST } from "@/lib/date";

const DAY_MS = 86400000;

export type WeekRange = { start: Date; end: Date; weekKey: string };

/** 直前に完了した週（今週の1つ前、JST月曜始まり）のレンジ */
export function lastCompletedWeekRangeJST(now: Date = new Date()): WeekRange {
  const thisMonday = weekStartJST(now);
  const lastWeekAnyDay = new Date(thisMonday.getTime() - DAY_MS);
  return weekRangeJST(lastWeekAnyDay);
}

/**
 * 直近 `count` 週ぶん（今週を除く、直前の週が先頭）のレンジ。
 * cron が落ちていた・サーバーが起動していなかった期間の取りこぼしを
 * lazy フォールバックでまとめて埋めるために使う。
 */
export function recentCompletedWeekRanges(
  now: Date = new Date(),
  count = 8,
): WeekRange[] {
  const thisMonday = weekStartJST(now);
  const ranges: WeekRange[] = [];
  for (let i = 1; i <= count; i++) {
    const anyDay = new Date(thisMonday.getTime() - i * 7 * DAY_MS);
    ranges.push(weekRangeJST(anyDay));
  }
  return ranges;
}

export function buildWeeklyTitle(weekKey: string): string {
  return `週のしょ — ${weekKey}`;
}

export function buildWeeklyLead(
  materialCount: number,
  chapterCount: number,
): string {
  if (materialCount === 0) {
    return "先週、まだ拾えていない材料はなかった。";
  }
  return `先週の材料 ${materialCount} 件 → 章 ${chapterCount}。日々の教科書でこぼれた分を、週の終わりにもう一度編み直した。`;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx tsx --test src/lib/weekly-textbook-shared.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: 全体テストスイートも壊れていないことを確認する**

Run: `npm test`
Expected: 既存166件 + 新規4件、全pass

- [ ] **Step 6: コミット**

```bash
git add src/lib/weekly-textbook-shared.ts src/lib/weekly-textbook-shared.test.ts
git commit -m "feat(weekly-textbook): 週境界計算とタイトル/リード文の純関数を追加する"
```

---

### Task 3: DB層 — 週次生成・冪等バックフィル・読み込み

**Files:**
- Create: `src/lib/weekly-textbook.ts`

**Interfaces:**
- Consumes: `clusterMaterialsIntoChapters`, `distillChecks`, `chaptersHaveLessonSlots`, `MaterialRow`, `MasteryState`, `isMasteryState`（`@/lib/daily-textbook-shared`、既存）。`recentCompletedWeekRanges`, `buildWeeklyTitle`, `buildWeeklyLead`, `WeekRange`（Task 2）
- Produces:
  - `export async function generateWeeklyTextbook(range: WeekRange): Promise<{ skipped: boolean; weeklyId?: string; materialCount?: number; chapterCount?: number }>`
  - `export async function ensureRecentWeeklyTextbooks(count?: number): Promise<void>`
  - `export type WeeklyTextbookView = { id: string; weekKey: string; title: string; lead: string | null; materialCount: number; chapterCount: number; chapters: Array<{...}>; checks: Array<{...}> }`
  - `export async function loadWeeklyTextbook(weekKey: string): Promise<WeeklyTextbookView | null>`
  - `export async function loadLatestWeeklyTextbookSummary(): Promise<{ weekKey: string; materialCount: number; chapterCount: number } | null>`
  - `export async function setWeeklyCheckMastery(checkId: string, mastery: MasteryState): Promise<void>`

- [ ] **Step 1: 実装する**

Create `src/lib/weekly-textbook.ts`:

```ts
/**
 * 週のしょ DB 操作 (server-only)。
 *
 * 週のしょは「閉じた過去の週」のスナップショットなので、日次と違い
 * 再生成（regenerate）は無い。同一 weekKey に対する generateWeeklyTextbook は
 * 既存行があれば即 skip する（冪等）。cron・lazy フォールバックの両方から
 * 何度呼ばれても安全。
 */

import "server-only";

import { prisma } from "@/lib/db";
import {
  chaptersHaveLessonSlots,
  clusterMaterialsIntoChapters,
  distillChecks,
  isMasteryState,
  type MasteryState,
  type MaterialRow,
} from "@/lib/daily-textbook-shared";
import {
  buildWeeklyLead,
  buildWeeklyTitle,
  recentCompletedWeekRanges,
  type WeekRange,
} from "@/lib/weekly-textbook-shared";

async function loadUncoveredMaterialsForWeek(
  start: Date,
  end: Date,
): Promise<MaterialRow[]> {
  return prisma.devEvent.findMany({
    where: { receivedAt: { gte: start, lt: end }, incorporatedAt: null },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      kind: true,
      repo: true,
      ref: true,
      summary: true,
      skipReason: true,
      receivedAt: true,
      incorporatedAt: true,
    },
  });
}

/**
 * 指定週の週のしょを生成する。既に存在すれば何もせず skip を返す
 * （週は閉じているため、2回目以降の呼び出しは意味を持たない）。
 * 材料が0件の週は行を作らない（空の儀式を作らない）。
 */
export async function generateWeeklyTextbook(
  range: WeekRange,
): Promise<{
  skipped: boolean;
  weeklyId?: string;
  materialCount?: number;
  chapterCount?: number;
}> {
  const existing = await prisma.weeklyTextbook.findUnique({
    where: { weekKey: range.weekKey },
    select: { id: true },
  });
  if (existing) return { skipped: true, weeklyId: existing.id };

  const materials = await loadUncoveredMaterialsForWeek(range.start, range.end);
  if (materials.length === 0) return { skipped: true };

  const { chapters } = clusterMaterialsIntoChapters(materials);
  if (!chaptersHaveLessonSlots(chapters)) {
    throw new Error("generateWeeklyTextbook: lesson slots missing after cluster");
  }
  const checks = distillChecks(chapters);
  const title = buildWeeklyTitle(range.weekKey);
  const lead = buildWeeklyLead(materials.length, chapters.length);

  const created = await prisma.weeklyTextbook.create({
    data: {
      weekKey: range.weekKey,
      title,
      lead,
      status: "ready",
      materialCount: materials.length,
      chapterCount: chapters.length,
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
        })),
      },
    },
  });

  if (checks.length > 0) {
    const freshChapters = await prisma.weeklyTextbookChapter.findMany({
      where: { weeklyId: created.id },
      select: { id: true, index: true },
    });
    const chapterIdByIndex = new Map(
      freshChapters.map((c) => [c.index, c.id] as const),
    );
    await prisma.weeklyTextbookCheck.createMany({
      data: checks.map((ck) => ({
        weeklyId: created.id,
        chapterId:
          ck.chapterIndex != null
            ? (chapterIdByIndex.get(ck.chapterIndex) ?? null)
            : null,
        index: ck.index,
        question: ck.question,
      })),
    });
  }

  // 章に入った材料を「捕捉済み」にする。溢れた分（droppedMaterialIds）は
  // incorporatedAt を null のまま残す＝書庫のみで発見可能（spec L215）。
  // MaterialBand への書き込みは行わない（週のしょは「編纂」を持たない）。
  const keptIds = chapters.flatMap((ch) => ch.materialIds);
  if (keptIds.length > 0) {
    await prisma.devEvent.updateMany({
      where: { id: { in: keptIds } },
      data: { incorporatedAt: new Date() },
    });
  }

  return {
    skipped: false,
    weeklyId: created.id,
    materialCount: materials.length,
    chapterCount: chapters.length,
  };
}

/**
 * 直近 `count` 週のうち、まだ週のしょが無い週をまとめて生成する。
 * cron が落ちていた期間があってもこれで埋まる（取りこぼしゼロ）。
 * `/retro` 訪問時に毎回呼ぶ想定。既存週は1クエリで skip されるため軽い。
 */
export async function ensureRecentWeeklyTextbooks(count = 8): Promise<void> {
  for (const range of recentCompletedWeekRanges(new Date(), count)) {
    const existing = await prisma.weeklyTextbook.findUnique({
      where: { weekKey: range.weekKey },
      select: { id: true },
    });
    if (existing) continue;
    await generateWeeklyTextbook(range);
  }
}

function parseEvidence(raw: string): Array<{ kind: string; label: string; url?: string; ref?: string }> {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as Array<{ kind: string; label: string; url?: string; ref?: string }>) : [];
  } catch {
    return [];
  }
}

function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type WeeklyTextbookView = {
  id: string;
  weekKey: string;
  title: string;
  lead: string | null;
  materialCount: number;
  chapterCount: number;
  chapters: Array<{
    id: string;
    index: number;
    title: string;
    oneLiner: string;
    bodyPlain: string;
    bodyDeep: string | null;
    diagramKind: string;
    evidence: Array<{ kind: string; label: string; url?: string; ref?: string }>;
    materialIds: string[];
  }>;
  checks: Array<{
    id: string;
    index: number;
    chapterId: string | null;
    question: string;
    mastery: MasteryState | null;
    answeredAt: string | null;
  }>;
};

export async function loadWeeklyTextbook(
  weekKey: string,
): Promise<WeeklyTextbookView | null> {
  const row = await prisma.weeklyTextbook.findUnique({
    where: { weekKey },
    include: {
      chapters: { orderBy: { index: "asc" } },
      checks: { orderBy: { index: "asc" } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    weekKey: row.weekKey,
    title: row.title,
    lead: row.lead,
    materialCount: row.materialCount,
    chapterCount: row.chapterCount,
    chapters: row.chapters.map((c) => ({
      id: c.id,
      index: c.index,
      title: c.title,
      oneLiner: c.oneLiner,
      bodyPlain: c.bodyPlain,
      bodyDeep: c.bodyDeep,
      diagramKind: c.diagramKind,
      evidence: parseEvidence(c.evidenceJson),
      materialIds: parseIds(c.materialIds),
    })),
    checks: row.checks.map((c) => ({
      id: c.id,
      index: c.index,
      chapterId: c.chapterId,
      question: c.question,
      mastery: c.mastery && isMasteryState(c.mastery) ? c.mastery : null,
      answeredAt: c.answeredAt?.toISOString() ?? null,
    })),
  };
}

export async function loadLatestWeeklyTextbookSummary(): Promise<{
  weekKey: string;
  materialCount: number;
  chapterCount: number;
} | null> {
  return prisma.weeklyTextbook.findFirst({
    orderBy: { weekKey: "desc" },
    select: { weekKey: true, materialCount: true, chapterCount: true },
  });
}

export async function setWeeklyCheckMastery(
  checkId: string,
  mastery: MasteryState,
): Promise<void> {
  await prisma.weeklyTextbookCheck.update({
    where: { id: checkId },
    data: { mastery, answeredAt: new Date() },
  });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`
Expected: 出力なし

- [ ] **Step 3: 実dev.dbに対する使い捨て検証スクリプトで動作確認する**

既存テストはDBに触れない規約（`src/lib/daily-textbook.test.ts`と同様）なので、Phase1同様に使い捨てスクリプトで確認する。

事前にバックアップ: `cp dev.db dev.db.bak-before-weekly-textbook-verify-$(date +%Y%m%d%H%M%S)`

Create（一時ファイル、確認後に削除）`_verify-weekly.ts`:

```ts
import { prisma } from "./src/lib/db";
import {
  ensureRecentWeeklyTextbooks,
  loadLatestWeeklyTextbookSummary,
  loadWeeklyTextbook,
} from "./src/lib/weekly-textbook";

async function main() {
  await ensureRecentWeeklyTextbooks(8);
  const summary = await loadLatestWeeklyTextbookSummary();
  console.log("latest summary:", summary);
  if (summary) {
    const full = await loadWeeklyTextbook(summary.weekKey);
    console.log("chapters:", full?.chapters.length, "checks:", full?.checks.length);
  }
  // 冪等性の確認: もう一度呼んでも増えないこと
  const before = await prisma.weeklyTextbook.count();
  await ensureRecentWeeklyTextbooks(8);
  const after = await prisma.weeklyTextbook.count();
  console.log("idempotent:", before === after, { before, after });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Run: `npx tsx _verify-weekly.ts`
Expected: `idempotent: true`と表示され、材料が存在する週があれば`chapters`/`checks`が0件超で出る

確認後、一時ファイルを削除: `rm _verify-weekly.ts`

- [ ] **Step 4: コミット**

```bash
git add src/lib/weekly-textbook.ts
git commit -m "feat(weekly-textbook): 週次生成・冪等バックフィル・読み込みのDB層を追加する"
```

---

### Task 4: Server Action — Mastery更新

**Files:**
- Modify: `src/lib/actions.ts`

**Interfaces:**
- Consumes: `setWeeklyCheckMastery`, `isMasteryState`（Task 3）
- Produces: `export async function setWeeklyCheckMasteryAction(checkId: string, mastery: string, weekKey: string): Promise<void>`

- [ ] **Step 1: actionを追加する**

`src/lib/actions.ts`の`setTextbookMasteryAction`（772-787行）の直後に追加:

```ts

export async function setWeeklyCheckMasteryAction(
  checkId: string,
  mastery: string,
  weekKey: string,
) {
  await requireAuth();
  const { isMasteryState } = await import("@/lib/daily-textbook-shared");
  const { setWeeklyCheckMastery } = await import("@/lib/weekly-textbook");
  if (!isMasteryState(mastery)) {
    throw new Error(`invalid mastery: ${mastery}`);
  }
  await setWeeklyCheckMastery(checkId, mastery);
  revalidatePath(`/retro/weekly/${weekKey}`);
  revalidatePath("/retro");
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`
Expected: 出力なし

- [ ] **Step 3: コミット**

```bash
git add src/lib/actions.ts
git commit -m "feat(weekly-textbook): 週のしょ確認問いのMastery更新actionを追加する"
```

---

### Task 5: lazyフォールバック配線（`/retro`訪問時に自動補完）

**Files:**
- Modify: `src/app/(app)/retro/page.tsx`
- Modify: `src/components/living-atlas/atlas-nikki-retro.tsx`

**Interfaces:**
- Consumes: `ensureRecentWeeklyTextbooks`, `loadLatestWeeklyTextbookSummary`（Task 3）
- Produces: `AtlasNikkiRetro`への新規prop `latestWeekly: { weekKey: string; materialCount: number; chapterCount: number } | null`

- [ ] **Step 1: `retro/page.tsx`にlazyフォールバックを配線する**

`src/app/(app)/retro/page.tsx`を編集:

```tsx
import { AtlasNikkiRetro } from "@/components/living-atlas/atlas-nikki-retro";
import { groupNikkiMonths } from "@/components/living-atlas/nikki-months";
import { dateKeyJST } from "@/lib/date";
import {
  dayRangeFromDateKey,
  listTextbookDates,
  listUngeneratedDays,
} from "@/lib/daily-textbook";
import {
  ensureRecentWeeklyTextbooks,
  loadLatestWeeklyTextbookSummary,
} from "@/lib/weekly-textbook";
import { prisma } from "@/lib/db";
import { regenerateDailyTextbookAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function RetroIndexPage() {
  const today = dateKeyJST();

  // 直近8週の週のしょ欠落をサイレントに補完する（取りこぼしゼロ）。
  // 既に生成済みの週は generateWeeklyTextbook 側で即 skip されるため軽い。
  await ensureRecentWeeklyTextbooks(8);

  const [dates, ungeneratedDays, materialCountToday, latestWeekly] =
    await Promise.all([
      listTextbookDates(120),
      listUngeneratedDays(60),
      (() => {
        const { start, end } = dayRangeFromDateKey(today);
        return prisma.devEvent.count({
          where: { receivedAt: { gte: start, lt: end } },
        });
      })(),
      loadLatestWeeklyTextbookSummary(),
    ]);

  const months = groupNikkiMonths(dates);

  async function regenerateAction() {
    "use server";
    await regenerateDailyTextbookAction(today);
  }

  return (
    <AtlasNikkiRetro
      months={months}
      todayKey={today}
      materialCountToday={materialCountToday}
      ungeneratedDays={ungeneratedDays}
      regenerateAction={regenerateAction}
      latestWeekly={latestWeekly}
    />
  );
}
```

- [ ] **Step 2: `AtlasNikkiRetro`にpropを受け取らせる**

`src/components/living-atlas/atlas-nikki-retro.tsx`の関数シグネチャ（18-31行）を編集:

```tsx
export function AtlasNikkiRetro({
  months,
  todayKey,
  materialCountToday,
  ungeneratedDays = [],
  regenerateAction,
  latestWeekly,
}: {
  months: NikkiMonth[];
  todayKey: string;
  materialCountToday: number;
  /** 材料はあるのに教科書になっていない日 */
  ungeneratedDays?: UngeneratedDay[];
  regenerateAction: () => Promise<void>;
  /** 最新の週のしょ（無ければ null＝先週は全部拾いきれていた） */
  latestWeekly: { weekKey: string; materialCount: number; chapterCount: number } | null;
}) {
```

Task 6でこの`latestWeekly`を実際にレンダリングする（このタスクでは配線のみ、propは受け取るが未使用でもtscは通る——TypeScriptは未使用propを警告しない）。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`
Expected: 出力なし

- [ ] **Step 4: コミット**

```bash
git add "src/app/(app)/retro/page.tsx" src/components/living-atlas/atlas-nikki-retro.tsx
git commit -m "feat(weekly-textbook): /retro訪問時に週のしょのlazyフォールバックを配線する"
```

---

### Task 6: UI — 「週のしょ」リンクchipを棚まわりに追加

**Files:**
- Modify: `src/components/living-atlas/atlas-nikki-retro.tsx`
- Modify: `src/app/atlas-living.css`

**Interfaces:**
- Consumes: `latestWeekly` prop（Task 5）

- [ ] **Step 1: masthead付近にリンクを追加する**

`src/components/living-atlas/atlas-nikki-retro.tsx`の`<AtlasPageTitle title="にっき" sub="月ごとのぼうけんにっき" />`（50行）の直後に追加:

```tsx
      <AtlasPageTitle title="にっき" sub="月ごとのぼうけんにっき" />
      {latestWeekly ? (
        <Link
          href={`/retro/weekly/${latestWeekly.weekKey}`}
          className="atlas-weekly-chip"
        >
          週のしょ · {latestWeekly.weekKey}
          <span className="atlas-weekly-chip__count">
            材料 {latestWeekly.materialCount}
          </span>
        </Link>
      ) : null}
      <div className="atlas-journal">
```

（既存の`<div className="atlas-journal">`行の直前に挿入する形になる。`Link`は既に1行目でimport済み）

- [ ] **Step 2: CSSを追加する**

`src/app/atlas-living.css`の`.atlas-band-shelf__age`ブロック（9384行付近）の直後に追加:

```css
.atlas-weekly-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0 0.75rem;
  padding: 0.4rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(216, 240, 200, 0.35);
  background: rgba(36, 90, 64, 0.25);
  color: #d8f0c8;
  font-size: 0.72rem;
  text-decoration: none;
  transition: background 0.15s ease;
}

.atlas-weekly-chip:hover {
  background: rgba(36, 90, 64, 0.4);
}

.atlas-weekly-chip__count {
  opacity: 0.7;
  font-size: 0.65rem;
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`
Expected: 出力なし

- [ ] **Step 4: コミット**

```bash
git add src/components/living-atlas/atlas-nikki-retro.tsx src/app/atlas-living.css
git commit -m "feat(weekly-textbook): にっき画面に週のしょへのリンクchipを追加する"
```

---

### Task 7: UI — 週のしょ詳細ページ

**Files:**
- Create: `src/app/(app)/retro/weekly/[weekKey]/page.tsx`
- Create: `src/app/(app)/retro/weekly/[weekKey]/loading.tsx`
- Create: `src/components/living-atlas/atlas-weekly-textbook.tsx`

（`src/app/atlas-living.css`は変更しない。既存の`atlas-journal__*`・`dq-btn`系グローバルクラスをそのまま再利用するため新規CSSは不要）

**Interfaces:**
- Consumes: `loadWeeklyTextbook`（Task 3）, `setWeeklyCheckMasteryAction`（Task 4）, `MASTERY_STATES`（`@/lib/daily-textbook-shared`、既存）

- [ ] **Step 1: ページを作る**

Create `src/app/(app)/retro/weekly/[weekKey]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { AtlasWeeklyTextbook } from "@/components/living-atlas/atlas-weekly-textbook";
import { loadWeeklyTextbook } from "@/lib/weekly-textbook";

export const dynamic = "force-dynamic";

export default async function RetroWeeklyPage({
  params,
}: {
  params: Promise<{ weekKey: string }>;
}) {
  const { weekKey } = await params;
  if (!/^\d{4}-W\d{2}$/.test(weekKey)) notFound();

  const textbook = await loadWeeklyTextbook(weekKey);
  if (!textbook) notFound();

  return <AtlasWeeklyTextbook textbook={textbook} />;
}
```

- [ ] **Step 2: ロードUIを作る**

Create `src/app/(app)/retro/weekly/[weekKey]/loading.tsx`:

```tsx
import { AtlasRouteLoading } from "@/components/living-atlas/atlas-route-loading";

export default function Loading() {
  return <AtlasRouteLoading variant="compact" />;
}
```

- [ ] **Step 3: 表示コンポーネントを作る**

Create `src/components/living-atlas/atlas-weekly-textbook.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AtlasPageTitle } from "./atlas-chrome";
import { MASTERY_STATES } from "@/lib/daily-textbook-shared";
import { setWeeklyCheckMasteryAction } from "@/lib/actions";
import type { WeeklyTextbookView } from "@/lib/weekly-textbook";

export function AtlasWeeklyTextbook({
  textbook,
}: {
  textbook: WeeklyTextbookView;
}) {
  const [pending, startTransition] = useTransition();
  const [localMastery, setLocalMastery] = useState<Record<string, string>>({});
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    textbook.chapters[0]?.id ?? null,
  );
  const activeChapter =
    textbook.chapters.find((c) => c.id === activeChapterId) ?? null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 pb-28">
      <AtlasPageTitle title="週のしょ" sub={textbook.weekKey} />
      <div className="atlas-journal">
        <div className="atlas-journal__page space-y-4">
          <p className="atlas-journal__lead">{textbook.lead}</p>

          {textbook.chapters.length === 0 ? (
            <p className="atlas-journal__note">
              この週は拾いきれなかった材料が無かった。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {textbook.chapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    className={`dq-btn !px-2 !py-1.5 text-[7px] ${
                      ch.id === activeChapterId ? "" : "dq-btn-ghost"
                    }`}
                    aria-pressed={ch.id === activeChapterId}
                    onClick={() => setActiveChapterId(ch.id)}
                  >
                    第{ch.index}章
                  </button>
                ))}
              </div>

              {activeChapter ? (
                <div className="border-t-2 border-[#245a40]/40 pt-3 space-y-2">
                  <p className="atlas-journal__chapter-no">
                    第{activeChapter.index}章
                  </p>
                  <h3 className="atlas-journal__heading">
                    {activeChapter.title}
                  </h3>
                  <p className="atlas-journal__lead">{activeChapter.oneLiner}</p>
                  <p className="atlas-journal__note whitespace-pre-wrap">
                    {activeChapter.bodyPlain}
                  </p>
                </div>
              ) : null}

              {textbook.checks.length > 0 ? (
                <div className="space-y-3">
                  <p className="atlas-journal__note">
                    確認問い。Mastery で振り返りを記録する。
                  </p>
                  {textbook.checks.map((ck) => {
                    const mastery = localMastery[ck.id] ?? ck.mastery;
                    return (
                      <div
                        key={ck.id}
                        className="border-t-2 border-[#245a40]/40 pt-3"
                      >
                        <p className="atlas-journal__chapter-no">
                          問 {ck.index}
                        </p>
                        <p className="atlas-journal__lead">{ck.question}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {MASTERY_STATES.map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={pending}
                              className={`dq-btn !px-2 !py-1.5 text-[7px] ${
                                mastery === m ? "" : "dq-btn-ghost"
                              }`}
                              onClick={() => {
                                setLocalMastery((prev) => ({
                                  ...prev,
                                  [ck.id]: m,
                                }));
                                startTransition(async () => {
                                  await setWeeklyCheckMasteryAction(
                                    ck.id,
                                    m,
                                    textbook.weekKey,
                                  );
                                });
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}

          <div className="atlas-journal__divider" aria-hidden />
          <Link href="/retro" className="atlas-band-shelf__archive">
            にっきへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
```

（`atlas-journal__*`・`dq-btn`系クラスは既存のグローバルCSSをそのまま再利用するため新規CSS追加は不要。`atlas-band-shelf__archive`も既存の「戻るリンク」スタイルを流用する）

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit -p . 2>&1 | grep -v "textbook-chapter-polish.ts(186"`
Expected: 出力なし

- [ ] **Step 5: ブラウザで実機確認する**

`npm run dev:all`（起動済みならスキップ）→ `http://localhost:3100/retro` を開き、「週のしょ」chipが表示されていればクリックして詳細ページを確認。表示されていない場合は先週分の未捕捉材料が無い（正常系）ので、`_verify-weekly.ts`相当の確認スクリプトで`WeeklyTextbook`が実際に0件かどうかをdev.db上で確認する。

- [ ] **Step 6: コミット**

```bash
git add "src/app/(app)/retro/weekly" src/components/living-atlas/atlas-weekly-textbook.tsx
git commit -m "feat(weekly-textbook): 週のしょ詳細ページを追加する"
```

---

### Task 8: standaloneスクリプト＋launchd cron（月曜09:00）

**Files:**
- Create: `scripts/generate-weekly-textbook.ts`
- Create: `scripts/weekly-textbook.sh`
- Create: `scripts/com.applied-loop.weekly-textbook.plist`

**Interfaces:**
- Consumes: `ensureRecentWeeklyTextbooks`（Task 3）

- [ ] **Step 1: standaloneスクリプトを作る**

Create `scripts/generate-weekly-textbook.ts`:

```ts
// 週のしょのcron用エントリポイント。ensureRecentWeeklyTextbooks は冪等なので
// 手動実行しても launchd から叩かれても安全（既存週は即skip）。
//
// Usage: npx tsx scripts/generate-weekly-textbook.ts
import { prisma } from "../src/lib/db";
import { ensureRecentWeeklyTextbooks } from "../src/lib/weekly-textbook";

async function main() {
  await ensureRecentWeeklyTextbooks(8);
  const rows = await prisma.weeklyTextbook.findMany({
    orderBy: { weekKey: "desc" },
    take: 3,
    select: { weekKey: true, materialCount: true, chapterCount: true },
  });
  console.log(`# ensured recent weekly textbooks, latest 3:`);
  for (const r of rows) {
    console.log(`${r.weekKey}\tmaterials=${r.materialCount}\tchapters=${r.chapterCount}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: launchd用シェルラッパーを作る**

Create `scripts/weekly-textbook.sh`（`scripts/harness-collect.sh`と同じ最小雛形。外部プロセス起動が不要なため`weekly-audio-auto.sh`ほど複雑にしない）:

```bash
#!/bin/bash
# launchd 用ラッパー: 週のしょ（WeeklyTextbook）を生成する（月曜09:00、ADR-0020）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# launchd はログインシェルの PATH (nvm/homebrew 等) を継承しないため明示する
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

LOG="$ROOT/scripts/weekly-textbook.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "---- $(date '+%Y-%m-%dT%H:%M:%S%z') ----"
  npx tsx "$ROOT/scripts/generate-weekly-textbook.ts"
} >>"$LOG" 2>&1
```

Run: `chmod +x scripts/weekly-textbook.sh`

- [ ] **Step 3: launchd plistを作る**

Create `scripts/com.applied-loop.weekly-textbook.plist`（`scripts/com.applied-loop.weekly-audio.plist`と同じ形式。09:00に設定——weekly-audio（10:00、週次ナレーションの音声化）より前に週のしょ本体が出来ている必要があるため）:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  Applied Loop 週のしょ (WeeklyTextbook) の自動生成 (毎週月曜 09:00)

  weekly-textbook.sh が直近8週の欠落をまとめて冪等に補完生成する。
  weekly-audio (月曜10:00、週次ナレーションの音声化) より前に走らせること。

  インストール手順:
    1. このファイルを編集し、YOUR_USER を実際のユーザ名に置換する
       (ProgramArguments のパスもリポジトリ実パスに合わせる)
    2. cp scripts/com.applied-loop.weekly-textbook.plist ~/Library/LaunchAgents/
    3. launchctl load ~/Library/LaunchAgents/com.applied-loop.weekly-textbook.plist
    4. 動作確認: launchctl start com.applied-loop.weekly-textbook
       ログ: scripts/weekly-textbook.log
    5. 停止: launchctl unload ~/Library/LaunchAgents/com.applied-loop.weekly-textbook.plist

  前提:
    - このスクリプトは dev.db に直接 Prisma で接続する（Next.js サーバー起動は不要）
-->
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.applied-loop.weekly-textbook</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>/Users/YOUR_USER/tools/applied-loop/scripts/weekly-textbook.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Weekday</key>
      <integer>1</integer>
      <key>Hour</key>
      <integer>9</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/applied-loop-weekly-textbook.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/applied-loop-weekly-textbook.err.log</string>
  </dict>
</plist>
```

- [ ] **Step 4: スクリプトを実際に一度動かして確認する**

事前にバックアップ: `cp dev.db dev.db.bak-before-weekly-cron-verify-$(date +%Y%m%d%H%M%S)`

Run: `npx tsx scripts/generate-weekly-textbook.ts`
Expected: `# ensured recent weekly textbooks, latest 3:`に続けて0〜3行（材料が無かった週はそもそも行が無いので0行もあり得る、正常）

- [ ] **Step 5: コミット**

```bash
git add scripts/generate-weekly-textbook.ts scripts/weekly-textbook.sh scripts/com.applied-loop.weekly-textbook.plist
git commit -m "feat(weekly-textbook): 週のしょ生成のstandaloneスクリプトとlaunchd定義を追加する"
```

**注記（koki向け、実装は完了しても運用開始には手動作業が要る）**: 他のlaunchd plist（`weekly-audio`・`harness-collect`）と同様、このplistは雛形をリポジトリに置くだけで自動では有効化されない。実際にcronを動かすには`YOUR_USER`を置換した上で`cp`→`launchctl load`が必要（plistファイルのコメントに手順を記載済み）。lazyフォールバック（Task 5）は`/retro`を開くだけで動くため、cronを有効化しなくても最悪1回訪問すれば直近8週分は補完される。

---

### Task 9: Global Constraints遵守の最終確認

**Files:** なし（確認のみ）

- [ ] **Step 1: 日次パイプラインに回帰が無いことを確認する**

Run: `npm test`
Expected: 全件pass（Phase1までの166件＋Task2で追加した週次純関数テスト、既存daily-textbook関連のテストに変更なし）

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: 出力は`textbook-chapter-polish.ts:186`の既知の無関係エラー1件のみ（本plan対象外、ENTRY優先順位3番の別タスク）

- [ ] **Step 3: ブラウザで日次教科書・書庫が壊れていないことを確認する**

`http://localhost:3100/retro`（今日の教科書生成・よみもの帯）と`http://localhost:3100/retro/archive`（書庫検索）を開き、Phase1の挙動に変化が無いことを目視確認する。週のしょはこれらのテーブル・ロジックに一切書き込まないため、影響が出ていれば実装ミスの signal になる。

- [ ] **Step 4: MaterialBandへの書き込みが本当に無いことをコードで再確認する**

Run: `grep -n "materialBand\." src/lib/weekly-textbook.ts`
Expected: 出力なし（Global Constraintsで宣言した「MaterialBandへの書き込み・読み込みを一切行わない」の実装保証）
