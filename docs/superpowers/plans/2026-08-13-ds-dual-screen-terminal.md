# DS風二画面ターミナル連動UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Living Atlas トップページを Nintendo DS 風の常設二画面レイアウトにし、ターミナル内で Claude/Codex が `answer_gate`（pass時）/ `save_task_mappings` / `capture_learning_candidate` を呼ぶたびに上画面（マップ・ステータス）がリアルタイムに反応する体験を作る。

**Architecture:** MCPツール呼び出し発生元と同じ Next.js プロセス（3100番）内に、in-memory イベントバス（`node:events` の `EventEmitter`、`globalThis` シングルトン）と SSE Route Handler を新設する。3101番のターミナル WebSocket サーバーには一切手を入れない。クライアントは `EventSource` でイベントを購読し、DS実機風の筐体UIコンポーネント内で演出を発火する。

**Tech Stack:** Next.js 16 (App Router), React, Prisma (better-sqlite3 adapter), Node.js 組み込み `node:events` / `node:test`

## Global Constraints

- 対象 MCP ツールは3つのみ: `answer_gate`（`src/app/api/mcp/route.ts:368`、pass 確定は `gradeGate` 内）/ `save_task_mappings`（`route.ts:680`）/ `capture_learning_candidate`（`route.ts:78`）。他ツールは対象外
- 配置はトップページ（`src/app/(app)/page.tsx` → `AtlasDashboard`）のみ。他ページは対象外
- テストランナーは Node.js 組み込み `node:test`（`package.json` の `"test": "tsx --test src/lib/*.test.ts"`）。UI コンポーネントの自動テストの慣習はこのプロジェクトに存在しない（ブラウザ実機確認が正）
- 新規シングルトンは既存の `src/lib/db.ts` と同じ `globalThis` パターンに従う（Next.js dev の HMR でモジュールが再評価されてもインスタンスを保持するため）
- **commit は各タスクの末尾では行わない。** 全タスク完了後にまとめて差分を提示し、koki に commit 可否を確認する（このリポジトリの運用規約: 「commit / push は明示依頼があるまでしない」）。各タスクの最終ステップは「変更内容を `git diff` で確認する」に置き換える
- 既存の `TerminalPanel` / `AtlasAssist` の接続・認証・再起動ロジックは無改造
- dev server は `npm run dev:all`（Web `:3100` / terminal WS `:3101`）。作業前に `lsof -nP -iTCP:3100 -sTCP:LISTEN` / `:3101` で生死確認する

---

## Task 1: サーバー側イベントバス基盤

**Files:**
- Create: `src/lib/atlas-live-events.ts`
- Test: `src/lib/atlas-live-events.test.ts`

**Interfaces:**
- Consumes: なし（新規モジュール）
- Produces:
  - `export type AtlasLiveEvent = { type: "gate_passed"; gateId: string } | { type: "task_mapping_saved"; dateKey: string; taskCount: number } | { type: "capture_added"; title: string }`
  - `export type AtlasLiveEventEnvelope = AtlasLiveEvent & { seq: number }`
  - `export function emitAtlasEvent(event: AtlasLiveEvent): void`
  - `export function subscribeAtlasEvents(listener: (event: AtlasLiveEventEnvelope) => void): () => void`（戻り値は unsubscribe 関数）

- [ ] **Step 1: Write the failing test**

`src/lib/atlas-live-events.test.ts` を作成:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitAtlasEvent, subscribeAtlasEvents } from "./atlas-live-events";

describe("atlas-live-events", () => {
  it("配信したイベントを購読者が受け取る（seq付き）", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeAtlasEvents((e) => received.push(e));
    emitAtlasEvent({ type: "gate_passed", gateId: "g1" });
    unsubscribe();
    assert.equal(received.length, 1);
    const e = received[0] as { type: string; gateId: string; seq: number };
    assert.equal(e.type, "gate_passed");
    assert.equal(e.gateId, "g1");
    assert.equal(typeof e.seq, "number");
  });

  it("unsubscribe 後はイベントを受け取らない", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeAtlasEvents((e) => received.push(e));
    unsubscribe();
    emitAtlasEvent({ type: "capture_added", title: "t" });
    assert.deepEqual(received, []);
  });

  it("複数購読者に同じイベントが届く", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = subscribeAtlasEvents((e) => a.push(e));
    const unsubB = subscribeAtlasEvents((e) => b.push(e));
    emitAtlasEvent({ type: "task_mapping_saved", dateKey: "2026-08-13", taskCount: 2 });
    unsubA();
    unsubB();
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  it("seq はイベントごとに増分する", () => {
    const received: { seq: number }[] = [];
    const unsubscribe = subscribeAtlasEvents((e) => received.push(e));
    emitAtlasEvent({ type: "capture_added", title: "one" });
    emitAtlasEvent({ type: "capture_added", title: "two" });
    unsubscribe();
    assert.equal(received.length, 2);
    assert.ok(received[1].seq > received[0].seq);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/atlas-live-events.test.ts`
Expected: FAIL（`./atlas-live-events` モジュールが存在しない）

- [ ] **Step 3: Write minimal implementation**

`src/lib/atlas-live-events.ts` を作成:

```ts
import { EventEmitter } from "node:events";

export type AtlasLiveEvent =
  | { type: "gate_passed"; gateId: string }
  | { type: "task_mapping_saved"; dateKey: string; taskCount: number }
  | { type: "capture_added"; title: string };

export type AtlasLiveEventEnvelope = AtlasLiveEvent & { seq: number };

const EVENT_NAME = "atlas-live-event";

const globalForAtlasEvents = globalThis as unknown as {
  atlasEventBus?: EventEmitter;
  atlasEventSeq?: number;
};

const bus = globalForAtlasEvents.atlasEventBus ?? new EventEmitter();
bus.setMaxListeners(50);
if (process.env.NODE_ENV !== "production") {
  globalForAtlasEvents.atlasEventBus = bus;
}

function nextSeq(): number {
  const current = globalForAtlasEvents.atlasEventSeq ?? 0;
  const next = current + 1;
  globalForAtlasEvents.atlasEventSeq = next;
  return next;
}

export function emitAtlasEvent(event: AtlasLiveEvent): void {
  const envelope: AtlasLiveEventEnvelope = { ...event, seq: nextSeq() };
  bus.emit(EVENT_NAME, envelope);
}

export function subscribeAtlasEvents(
  listener: (event: AtlasLiveEventEnvelope) => void,
): () => void {
  bus.on(EVENT_NAME, listener);
  return () => bus.off(EVENT_NAME, listener);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/atlas-live-events.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Confirm the diff**

Run: `git diff --stat src/lib/atlas-live-events.ts src/lib/atlas-live-events.test.ts`
Expected: 2 files, 新規追加のみ。commit はしない（Global Constraints 参照）。

---

## Task 2: `gradeGate` へのイベント発行フック追加（しれん pass 検知）

**Files:**
- Modify: `src/lib/gate.ts:1-30`（import 追加）, `src/lib/gate.ts:791-793`（フック追加）

**Interfaces:**
- Consumes: `emitAtlasEvent` from Task 1（`src/lib/atlas-live-events.ts`）
- Produces: `gradeGate` が pass 確定時に `emitAtlasEvent({ type: "gate_passed", gateId })` を呼ぶという既存動作への追加のみ。新規の外部インターフェースはなし

**Note:** `gradeGate` は LLM 呼び出しを含む重い関数で、既存のテスト慣習でも直接の unit test は書かれていない（`gate-answer.test.ts` は DB 非依存の `evaluateGateAcceptability` のみをテストしている）。この変更も同じ慣習に従い、新規テストは書かず、Task 8 のブラウザ実機確認で検証する。

- [ ] **Step 1: import を追加**

`src/lib/gate.ts` の冒頭 import 群（他の `@/lib/*` import の並びに合わせる）に追加:

```ts
import { emitAtlasEvent } from "@/lib/atlas-live-events";
```

- [ ] **Step 2: pass 確定直後にイベント発行を追加**

`src/lib/gate.ts:791-800` を次のように変更する（`if (passed) {` の中身の先頭に1行追加するだけ）:

変更前:
```ts
  if (passed) {
    await onGatePassed(gate, now, result?.goal_suggestions, rubric);
    await refreshRequirementsForGate(gateId).catch((e) =>
      console.error("[requirement] refresh after pass failed:", e)
    );
  } else {
    await onGateFailed(gate, misconceptions, now, rootCause);
  }
```

変更後:
```ts
  if (passed) {
    emitAtlasEvent({ type: "gate_passed", gateId });
    await onGatePassed(gate, now, result?.goal_suggestions, rubric);
    await refreshRequirementsForGate(gateId).catch((e) =>
      console.error("[requirement] refresh after pass failed:", e)
    );
  } else {
    await onGateFailed(gate, misconceptions, now, rootCause);
  }
```

- [ ] **Step 3: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし（既知の `src/lib/textbook-chapter-polish.ts:186` のみ残る）

- [ ] **Step 4: 既存テストが壊れていないことを確認**

Run: `npm test`
Expected: 全件 PASS（既存件数を維持、新規追加なし）

- [ ] **Step 5: Confirm the diff**

Run: `git diff src/lib/gate.ts`
Expected: import 1行 + `emitAtlasEvent` 呼び出し1行の追加のみ。commit はしない。

---

## Task 3: `save_task_mappings` / `capture_learning_candidate` へのイベント発行フック追加

**Files:**
- Modify: `src/app/api/mcp/route.ts:14`（import 追加）, `src/app/api/mcp/route.ts:115-123`（capture_learning_candidate）, `src/app/api/mcp/route.ts:710-724`（save_task_mappings）

**Interfaces:**
- Consumes: `emitAtlasEvent` from Task 1
- Produces: なし（既存ハンドラへの追加のみ）

- [ ] **Step 1: import を追加**

`src/app/api/mcp/route.ts:14` 付近（`import { saveTaskMappings } from "@/lib/task-map";` の直後）に追加:

```ts
import { emitAtlasEvent } from "@/lib/atlas-live-events";
```

- [ ] **Step 2: `capture_learning_candidate` の成功パスにイベント発行を追加**

`src/app/api/mcp/route.ts:115-123` を次のように変更する（`prisma.capture.create` 成功後、`after()` ブロックの直前に1行追加）:

変更前（117行目〜):
```ts
        const capture = await prisma.capture.create({
          data: {
            title: trimmed,
            note: note?.trim() || null,
            sourceTool,
            sourceContext: sourceContext?.trim() || null,
            dedupeKey,
          },
        });
        // ADR-0012 §2: 重要度スコアリングは非同期。応答は即返す (llm_auto はまだ無効)
        after(() => {
```

変更後:
```ts
        const capture = await prisma.capture.create({
          data: {
            title: trimmed,
            note: note?.trim() || null,
            sourceTool,
            sourceContext: sourceContext?.trim() || null,
            dedupeKey,
          },
        });
        emitAtlasEvent({ type: "capture_added", title: capture.title });
        // ADR-0012 §2: 重要度スコアリングは非同期。応答は即返す (llm_auto はまだ無効)
        after(() => {
```

- [ ] **Step 3: `save_task_mappings` の成功パスにイベント発行を追加**

`src/app/api/mcp/route.ts:710-724` を次のように変更する:

変更前:
```ts
      async ({ dateKey, mappings }) => {
        await requireAuth();
        const result = await saveTaskMappings({ dateKey, mappings });
        const lines = [
          `# タスクマッピングを保存しました`,
          `- dateKey: ${result.dateKey}`,
          `- タスク数: ${result.savedCount}`,
        ];
```

変更後:
```ts
      async ({ dateKey, mappings }) => {
        await requireAuth();
        const result = await saveTaskMappings({ dateKey, mappings });
        if (result.savedCount > 0) {
          emitAtlasEvent({
            type: "task_mapping_saved",
            dateKey: result.dateKey,
            taskCount: result.savedCount,
          });
        }
        const lines = [
          `# タスクマッピングを保存しました`,
          `- dateKey: ${result.dateKey}`,
          `- タスク数: ${result.savedCount}`,
        ];
```

- [ ] **Step 4: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし

- [ ] **Step 5: Confirm the diff**

Run: `git diff src/app/api/mcp/route.ts`
Expected: import 1行 + 2箇所への `emitAtlasEvent` 呼び出し追加のみ。commit はしない。

---

## Task 4: SSE Route Handler 新設

**Files:**
- Create: `src/app/api/atlas-events/route.ts`

**Interfaces:**
- Consumes: `subscribeAtlasEvents`, `AtlasLiveEventEnvelope` from Task 1（`src/lib/atlas-live-events.ts`）、`requireAuth` from `src/lib/auth.ts`
- Produces: `GET /api/atlas-events` — SSE ストリーム。各行 `data: <JSON.stringify(AtlasLiveEventEnvelope)>\n\n`。20秒ごとに `: heartbeat\n\n` を送信

- [ ] **Step 1: Route Handler を実装**

`src/app/api/atlas-events/route.ts` を作成:

```ts
import { requireAuth } from "@/lib/auth";
import { subscribeAtlasEvents } from "@/lib/atlas-live-events";

export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function GET(request: Request) {
  await requireAuth();

  const encoder = new TextEncoder();
  let disposed = false;

  const stream = new ReadableStream({
    start(controller) {
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const unsubscribe = subscribeAtlasEvents((event) => {
        if (disposed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      });

      const heartbeat = setInterval(() => {
        if (disposed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし

- [ ] **Step 3: dev server の生死を確認し、必要なら起動**

Run: `lsof -nP -iTCP:3100 -sTCP:LISTEN`
Expected: プロセスが生きていること。生きていなければ `npm run dev:all` を起動してから次へ進む

- [ ] **Step 4: curl で疎通確認**

Run（バックグラウンドで数秒受信して終了するテスト）:
```bash
timeout 3 curl -N -s http://localhost:3100/api/atlas-events | head -5
```
Expected: `: heartbeat` 行が最低1行出力される（20秒間隔なので timeout 3秒では heartbeat が出ないこともある。接続がハングせず `timeout` で正常終了すれば疎通OKと判断してよい。エラー出力が無いことを確認する）

- [ ] **Step 5: Confirm the diff**

Run: `git diff --stat src/app/api/atlas-events/route.ts`
Expected: 新規ファイル1つ。commit はしない。

---

## Task 5: クライアント側 EventSource Context Provider

**Files:**
- Create: `src/components/living-atlas/atlas-live-events-context.tsx`

**Interfaces:**
- Consumes: `GET /api/atlas-events`（Task 4）、`AtlasLiveEvent` / `AtlasLiveEventEnvelope` 型（Task 1、型のみ import）
- Produces:
  - `export function AtlasLiveEventsProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `export function useAtlasLiveEvents(): { connected: boolean; lastEvent: AtlasLiveEventEnvelope | null }`

- [ ] **Step 1: Context Provider を実装**

`src/components/living-atlas/atlas-live-events-context.tsx` を作成:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AtlasLiveEventEnvelope } from "@/lib/atlas-live-events";

type AtlasLiveState = {
  connected: boolean;
  lastEvent: AtlasLiveEventEnvelope | null;
};

const AtlasLiveEventsContext = createContext<AtlasLiveState>({
  connected: false,
  lastEvent: null,
});

export function AtlasLiveEventsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<AtlasLiveEventEnvelope | null>(
    null,
  );

  useEffect(() => {
    const source = new EventSource("/api/atlas-events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as AtlasLiveEventEnvelope;
        setLastEvent(parsed);
      } catch {
        /* malformed payload, ignore */
      }
    };
    return () => {
      source.close();
    };
  }, []);

  return (
    <AtlasLiveEventsContext.Provider value={{ connected, lastEvent }}>
      {children}
    </AtlasLiveEventsContext.Provider>
  );
}

export function useAtlasLiveEvents(): AtlasLiveState {
  return useContext(AtlasLiveEventsContext);
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし（`AtlasLiveEventEnvelope` は Task 1 で export 済みの型を re-import しているだけ）

- [ ] **Step 3: Confirm the diff**

Run: `git diff --stat src/components/living-atlas/atlas-live-events-context.tsx`
Expected: 新規ファイル1つ。commit はしない。

---

## Task 6: DS筐体UIコンポーネント（レイアウト・グロー・ヒンジ・ボタン装飾）

**Files:**
- Create: `src/components/living-atlas/atlas-console-shell.tsx`
- Modify: `src/app/atlas-living.css`（末尾に新規クラス群を追加）

**Interfaces:**
- Consumes: `useAtlasLiveEvents` from Task 5（グロー演出・未接続表示のトリガーに使う）
- Produces: `export function AtlasConsoleShell({ topScreen, bottomScreen, pulse }: { topScreen: React.ReactNode; bottomScreen: React.ReactNode; pulse: boolean }): JSX.Element`（`pulse` は呼び出し側が「今イベントを受信して光らせたい」と判断した瞬間に `true` を渡す。接続状態自体は内部で `useAtlasLiveEvents().connected` を見る）

koki 承認済みビジュアル（visual companion、2026-08-13、`console-final-v3.html` 相当）: 上画面は全幅、下段は「十字キー｜画面｜ABXYボタン」の3カラム、画面縁は金色グロー（平常時は薄く、`pulse` 時にパルス発光、未接続時は消灯/グレーアウト）。

- [ ] **Step 1: コンポーネントを実装**

`src/components/living-atlas/atlas-console-shell.tsx` を作成:

```tsx
"use client";

import { useAtlasLiveEvents } from "./atlas-live-events-context";

export function AtlasConsoleShell({
  topScreen,
  bottomScreen,
  pulse,
}: {
  topScreen: React.ReactNode;
  bottomScreen: React.ReactNode;
  pulse: boolean;
}) {
  const { connected } = useAtlasLiveEvents();
  const glowClass = [
    "atlas-console-glow",
    connected ? "" : "atlas-console-glow--offline",
    pulse ? "atlas-console-glow--pulse" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const glowClassLower = [
    "atlas-console-glow",
    "atlas-console-glow--lower",
    connected ? "" : "atlas-console-glow--offline",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="atlas-console-shell">
      <div className={glowClass}>{topScreen}</div>
      <div className="atlas-console-hinge" aria-hidden />
      <div className="atlas-console-lower-row">
        <div className="atlas-console-side-pad" aria-hidden>
          <div className="atlas-console-dpad" />
        </div>
        <div className="atlas-console-lower-screen">
          <div className={glowClassLower}>{bottomScreen}</div>
        </div>
        <div className="atlas-console-side-pad" aria-hidden>
          <div className="atlas-console-abxy">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS を追加**

`src/app/atlas-living.css` の末尾に追加:

```css
.atlas-console-shell {
  padding: 20px 22px 18px;
  border-radius: 22px;
  background: linear-gradient(155deg, #3a3d46 0%, #23252b 55%, #17181c 100%);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.atlas-console-glow {
  border-radius: 6px;
  padding: 3px;
  background: linear-gradient(160deg, #0a0a0c, #000);
  box-shadow:
    inset 0 0 0 2px rgba(240, 210, 90, 0.35),
    0 0 16px rgba(240, 210, 90, 0.18);
  position: relative;
  overflow: hidden;
  transition: box-shadow 0.25s ease;
}

.atlas-console-glow::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    rgba(255, 255, 255, 0.1) 0%,
    rgba(255, 255, 255, 0.02) 22%,
    transparent 45%
  );
  pointer-events: none;
}

.atlas-console-glow--pulse {
  box-shadow:
    inset 0 0 0 2px rgba(240, 210, 90, 0.9),
    0 0 28px rgba(240, 210, 90, 0.55);
}

.atlas-console-glow--offline {
  box-shadow:
    inset 0 0 0 2px rgba(140, 140, 140, 0.25),
    0 0 0 rgba(0, 0, 0, 0);
  filter: grayscale(0.4);
}

.atlas-console-hinge {
  height: 12px;
  margin: 6px auto;
  width: 92%;
  border-radius: 6px;
  background: linear-gradient(180deg, #111214, #050506);
  position: relative;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6);
}

.atlas-console-hinge::before,
.atlas-console-hinge::after {
  content: "";
  position: absolute;
  top: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #6b6f78, #1a1b1e);
}

.atlas-console-hinge::before {
  left: -4px;
}

.atlas-console-hinge::after {
  right: -4px;
}

.atlas-console-lower-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.atlas-console-side-pad {
  width: 42px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.atlas-console-lower-screen {
  flex: 1;
  min-width: 0;
}

.atlas-console-dpad {
  width: 30px;
  height: 30px;
  position: relative;
  opacity: 0.85;
}

.atlas-console-dpad::before,
.atlas-console-dpad::after {
  content: "";
  position: absolute;
  background: #55585f;
  border-radius: 2px;
}

.atlas-console-dpad::before {
  width: 30px;
  height: 10px;
  top: 10px;
  left: 0;
}

.atlas-console-dpad::after {
  width: 10px;
  height: 30px;
  top: 0;
  left: 10px;
}

.atlas-console-abxy {
  display: grid;
  grid-template-columns: repeat(2, 13px);
  grid-template-rows: repeat(2, 13px);
  gap: 3px;
}

.atlas-console-abxy span {
  border-radius: 50%;
  background: #55585f;
  opacity: 0.85;
}

@media (prefers-reduced-motion: reduce) {
  .atlas-console-glow {
    transition: none;
  }
}
```

- [ ] **Step 3: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし

- [ ] **Step 4: Confirm the diff**

Run: `git diff --stat src/components/living-atlas/atlas-console-shell.tsx src/app/atlas-living.css`
Expected: 新規ファイル1つ + CSS追記。commit はしない。

---

## Task 7: `atlas-dashboard.tsx` への統合（筐体ラップ・演出3種・常時表示化）

**Files:**
- Modify: `src/components/living-atlas/atlas-dashboard.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/atlas-living.css`（通知バナー・アイコンバウンド用クラス追加）

**Interfaces:**
- Consumes: `AtlasConsoleShell`（Task 6）、`useAtlasLiveEvents`（Task 5）、`AtlasLiveEventsProvider`（Task 5）、`AtlasLiveEventEnvelope`（Task 1）
- Produces: なし（末端の統合タスク）

- [ ] **Step 1: `layout.tsx` に `AtlasLiveEventsProvider` を追加**

`src/app/(app)/layout.tsx` の現状（全文）:

```tsx
import { AtlasBodyClass } from "@/components/living-atlas/atlas-body-class";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AtlasBodyClass />
      <main className="flex-1">{children}</main>
    </>
  );
}
```

次のように変更する:

```tsx
import { AtlasBodyClass } from "@/components/living-atlas/atlas-body-class";
import { AtlasLiveEventsProvider } from "@/components/living-atlas/atlas-live-events-context";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <AtlasBodyClass />
      <main className="flex-1">
        <AtlasLiveEventsProvider>{children}</AtlasLiveEventsProvider>
      </main>
    </>
  );
}
```

- [ ] **Step 2: `atlas-dashboard.tsx` に演出用の state とロジックを追加**

`src/components/living-atlas/atlas-dashboard.tsx` の冒頭 import に追加:

```ts
import { useEffect, useRef, useState } from "react";
import { useAtlasLiveEvents } from "./atlas-live-events-context";
import { AtlasConsoleShell } from "./atlas-console-shell";
```

（既存の `import { useState } from "react";` は `useEffect, useRef, useState` に置き換える）

`AtlasDashboard` 関数内、`const [activeId, setActiveId] = useState(...)` の直後に追加:

```ts
  const { lastEvent } = useAtlasLiveEvents();
  const [optimisticResolvedDelta, setOptimisticResolvedDelta] = useState(0);
  const [clearedGateId, setClearedGateId] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [bounceIcon, setBounceIcon] = useState(false);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!lastEvent || lastEvent.seq === lastSeqRef.current) return;
    lastSeqRef.current = lastEvent.seq;

    setPulse(true);
    const pulseTimer = setTimeout(() => setPulse(false), 900);

    if (lastEvent.type === "gate_passed") {
      setOptimisticResolvedDelta((d) => d + 1);
      if (pendingGate && lastEvent.gateId === pendingGate.id) {
        setClearedGateId(lastEvent.gateId);
      }
    } else if (lastEvent.type === "task_mapping_saved") {
      setBanner(
        `今の任務と関連しそうな学びを検知しました（${lastEvent.taskCount}件）`,
      );
      const bannerTimer = setTimeout(() => setBanner(null), 6000);
      return () => {
        clearTimeout(pulseTimer);
        clearTimeout(bannerTimer);
      };
    } else if (lastEvent.type === "capture_added") {
      setBounceIcon(true);
      const bounceTimer = setTimeout(() => setBounceIcon(false), 1200);
      return () => {
        clearTimeout(pulseTimer);
        clearTimeout(bounceTimer);
      };
    }

    return () => clearTimeout(pulseTimer);
  }, [lastEvent, pendingGate]);
```

- [ ] **Step 3: EXP バーの楽観的再計算を反映**

`const adventurer = adventurerProp ?? adventurerLevelFromResolved(resolvedTotal);` を次のように変更:

```ts
  const adventurer =
    adventurerProp ?? adventurerLevelFromResolved(resolvedTotal + optimisticResolvedDelta);
```

- [ ] **Step 4: quest ピンの撃破済み表示を反映**

`mapMarkers` の生成部分（`...(pendingGate && questPos ? [...] : [])` のブロック）内、`kind: "quest" as const,` を次のように変更:

```ts
            kind: (clearedGateId === pendingGate.id ? "clear" : "quest") as const,
```

- [ ] **Step 5: `StatusCommandPanel` に `bounceIcon` prop を追加**

`StatusCommandPanel` の関数シグネチャ（`atlas-dashboard.tsx:74-90`）を次のように変更:

```tsx
function StatusCommandPanel({
  adventurer,
  resolvedTotal,
  thisWeekDelta,
  streakDays,
  systemStars,
  todos,
  weaknesses,
  bounceIcon = false,
}: {
  adventurer: AdventurerLevel;
  resolvedTotal: number;
  thisWeekDelta: number;
  streakDays: number;
  systemStars: SystemStar[];
  todos: DashboardTodo[];
  weaknesses: AtlasDashboardProps["weaknesses"];
  bounceIcon?: boolean;
}) {
```

見出し行（`atlas-dashboard.tsx:110-115`）を次のように変更:

変更前:
```tsx
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="dq-win-title mb-0">ぼうけんしゃ</h2>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          司令塔
        </p>
      </div>
```

変更後:
```tsx
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="dq-win-title mb-0">
          ぼうけんしゃ
          {bounceIcon && (
            <span className="atlas-capture-bounce" aria-hidden>
              📥
            </span>
          )}
        </h2>
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[8px] text-[#9ec0ff]">
          司令塔
        </p>
      </div>
```

- [ ] **Step 6: レイアウトを `AtlasConsoleShell` でラップし、通知バナーを追加**

`atlas-dashboard.tsx` の import に `AtlasConsoleShell` を追加（Task 6 で作成済み）。既存の `return (` 以降（`atlas-dashboard.tsx:432-509`）は次の内容:

```tsx
  return (
    <AtlasShell>
      <AtlasWorldIntroModal />

      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
        <AtlasReveal as="section" className="dq-win flex h-full flex-col gap-3 p-3.5">
          <AtlasPageTitle
            title="ちず"
            sub={
              pendingGate
                ? `！＝いまのしれん（未クリア ${pendingGateCount ?? 1} 件）`
                : "領＝学びの系統じゃ"
            }
            surface="map"
          />
          <div className="atlas-worldmap-frame">
            <AtlasWorldMap
              markers={mapMarkers}
              activeId={activeId}
              onSelect={setActiveId}
              regionBrightness={regionBrightness}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[#c9c3a0]">
            <span className="text-[#f0d25a]">！＝未クリアのしれん</span>
            <span>自キャラ＝いま</span>
            <span>領＝学びの系統</span>
          </div>

          <div className="mt-auto border-t-2 border-[#002070] pt-3">
            <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
              ◆ いまの一手
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] font-normal leading-relaxed">
                  {primaryCta.title}
                </h2>
                <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
                  {primaryCta.body}
                </p>
              </div>
              <Link href={primaryCta.href} className="dq-btn shrink-0">
                {primaryCta.label}
              </Link>
            </div>
          </div>
        </AtlasReveal>

        <StatusCommandPanel
          adventurer={adventurer}
          resolvedTotal={resolvedTotal}
          thisWeekDelta={thisWeekDelta}
          streakDays={streakDays}
          systemStars={systemStars}
          todos={todos}
          weaknesses={weaknesses}
        />
      </div>

      <AtlasReveal as="section" delayIndex={2}>
        {wsToken ? (
          <AtlasAssist
            wsToken={wsToken}
            intent="general"
            context={assistContext}
            title="じゅもんで今日を進める"
            blurb="朝の仕分けも、証跡も、どうぐの見立ても——願うならここからじゅもんを。ひとつのしれんなら上の一手へ。"
            plain="ホーム用の全体操作。Claude/Codex が開き MCP で morning_briefing・仕分け・処方など。1問集中は上のプライマリ CTA。"
            defaultOpen={false}
          />
        ) : (
          <AtlasAssistUnavailable />
        )}
      </AtlasReveal>
    </AtlasShell>
  );
}
```

次の内容に置き換える（`AtlasReveal as="section" className="dq-win ..."` ブロックと `StatusCommandPanel` 呼び出しの中身は無変更のまま `topScreenContent` に、`AtlasAssist`/`AtlasAssistUnavailable` の中身は無変更のまま `bottomScreenContent` に、それぞれ移すだけ。`defaultOpen` と `StatusCommandPanel` への prop 追加のみが差分）:

```tsx
  const topScreenContent = (
    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
      <AtlasReveal as="section" className="dq-win flex h-full flex-col gap-3 p-3.5">
        <AtlasPageTitle
          title="ちず"
          sub={
            pendingGate
              ? `！＝いまのしれん（未クリア ${pendingGateCount ?? 1} 件）`
              : "領＝学びの系統じゃ"
          }
          surface="map"
        />
        <div className="atlas-worldmap-frame">
          <AtlasWorldMap
            markers={mapMarkers}
            activeId={activeId}
            onSelect={setActiveId}
            regionBrightness={regionBrightness}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[#c9c3a0]">
          <span className="text-[#f0d25a]">！＝未クリアのしれん</span>
          <span>自キャラ＝いま</span>
          <span>領＝学びの系統</span>
        </div>

        <div className="mt-auto border-t-2 border-[#002070] pt-3">
          <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
            ◆ いまの一手
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="m-0 text-[15px] font-normal leading-relaxed">
                {primaryCta.title}
              </h2>
              <p className="mt-1 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
                {primaryCta.body}
              </p>
            </div>
            <Link href={primaryCta.href} className="dq-btn shrink-0">
              {primaryCta.label}
            </Link>
          </div>
        </div>
      </AtlasReveal>

      <StatusCommandPanel
        adventurer={adventurer}
        resolvedTotal={resolvedTotal}
        thisWeekDelta={thisWeekDelta}
        streakDays={streakDays}
        systemStars={systemStars}
        todos={todos}
        weaknesses={weaknesses}
        bounceIcon={bounceIcon}
      />
    </div>
  );

  const bottomScreenContent = wsToken ? (
    <AtlasAssist
      wsToken={wsToken}
      intent="general"
      context={assistContext}
      title="じゅもんで今日を進める"
      blurb="朝の仕分けも、証跡も、どうぐの見立ても——願うならここからじゅもんを。ひとつのしれんなら上の一手へ。"
      plain="ホーム用の全体操作。Claude/Codex が開き MCP で morning_briefing・仕分け・処方など。1問集中は上のプライマリ CTA。"
      defaultOpen={true}
    />
  ) : (
    <AtlasAssistUnavailable />
  );

  return (
    <AtlasShell>
      <AtlasWorldIntroModal />
      <AtlasConsoleShell
        topScreen={topScreenContent}
        bottomScreen={bottomScreenContent}
        pulse={pulse}
      />
      {banner && (
        <div className="atlas-live-banner" role="status">
          💬 {banner}
        </div>
      )}
    </AtlasShell>
  );
}
```

`defaultOpen={false}` を `defaultOpen={true}` に変更した点に注意（下段ターミナルの常時表示化。折りたたみボタンは `AtlasAssist` 内の既存「とじる」ボタンがそのまま機能するので変更不要）。

- [ ] **Step 7: CSS を追加**

`src/app/atlas-living.css` の末尾に追加:

```css
.atlas-live-banner {
  margin-top: 10px;
  font-size: 0.78rem;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(240, 210, 90, 0.12);
  border: 1px solid rgba(240, 210, 90, 0.4);
  color: #f7f3d9;
}

.atlas-capture-bounce {
  display: inline-block;
  animation: atlas-bounce 0.6s ease 2;
}

@keyframes atlas-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@media (prefers-reduced-motion: reduce) {
  .atlas-capture-bounce {
    animation: none;
  }
}
```

- [ ] **Step 8: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし

- [ ] **Step 9: 既存テストを実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 10: Confirm the diff**

Run: `git diff --stat src/components/living-atlas/atlas-dashboard.tsx "src/app/(app)/layout.tsx" src/app/atlas-living.css`
Expected: 3ファイルに変更あり。commit はしない。

---

## Task 8: ブラウザ実機総合確認

**Files:** なし（確認のみ）

**Interfaces:**
- Consumes: Task 1〜7 の全成果物
- Produces: なし

- [ ] **Step 1: dev server の生死を確認**

Run: `lsof -nP -iTCP:3100 -sTCP:LISTEN && lsof -nP -iTCP:3101 -sTCP:LISTEN`
Expected: 両方生存。生きていなければ `npm run dev:all` で起動

- [ ] **Step 2: トップページの見た目を確認**

`http://localhost:3100/` を開き、DS実機風の筐体（上画面全幅・下段が十字キー｜ターミナル｜ABXYボタンの3カラム・金色グロー・ヒンジ）が表示され、ターミナルが初期状態で開いていることを目視確認する。

- [ ] **Step 3: `capture_learning_candidate` の演出を確認**

ターミナルで Claude/Codex に「〇〇という学びを受信箱に登録して」のように依頼し、`capture_learning_candidate` が呼ばれたら、画面縁がパルス発光し、ステータスパネル脇のアイコンがバウンドすることを確認する。

- [ ] **Step 4: `save_task_mappings` の演出を確認**

ターミナルで `find_related_learnings` → `save_task_mappings` の一連を実行させ（`morning_briefing` を呼ぶと誘導される）、画面下部に通知バナーが薄く表示され、6秒後に消えることを確認する。

- [ ] **Step 5: `answer_gate` pass 時の演出を確認**

未クリアのしれんがあれば、ターミナル経由で回答し pass するまで待つ（採点は非同期）。pass 確定時に、EXP バーがその場で伸び、かつ回答したゲートが現在表示中の quest ピンと一致していればピンが撃破済み表示に変わることを確認する。一致しない場合は EXP バーのみ伸びることを確認する。

- [ ] **Step 6: SSE 未接続時の表示を確認**

`npm run dev:all` のターミナル WS 側（3101）ではなく Web 側（3100）を一時停止し、画面縁のグローが消灯/グレーアウトすることを確認したのち、再起動して復帰することを確認する。

- [ ] **Step 7: 全体の差分を koki に提示し、commit 可否を確認する**

Run: `git status --short && git diff --stat`

出力を koki に見せ、commit してよいか確認する（Global Constraints 参照。このタスクでは commit を実行しない）。
