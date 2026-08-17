# /setup 採点CLI診断タイミング見直し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/setup`ページのレンダーが「採点の賢者（claude/codex CLI）」診断のlive probe（最大8秒）でブロックされないようにし、live probeは`/setup`限定の手動ボタン（`AtlasSpellWait`演出付き）でのみ実行されるようにする。

**Architecture:** `/setup`の通常表示は`~/.applied-loop/grading-probe-cache.json`をファイル読み出しするだけの新関数`cachedGradingProbeResult()`に切り替える（live LLM呼び出しなし）。保留中しれんの自動再採点（B5-3）は、live probeの結果へのゲート依存をやめ無条件実行にする（内部の軽量PATHチェックが既にガードしているため安全）。live probe本体（`probeGradingCliLive()`）はロジック無変更のまま、新規サーバーアクション経由で手動ボタンから呼べるようにする。

**Tech Stack:** Next.js App Router（サーバーコンポーネント＋サーバーアクション）、`node:test`（`tsx --test`）、既存の`AtlasSpellWait`コンポーネント。

**Spec:** `docs/superpowers/specs/2026-08-17-setup-grading-probe-design.md`

## Global Constraints

- probe本体のロジック（`probeGradingCliLive()`・`probeGradingCli()`・キャッシュTTL）は変更しない（spec「対象外」）
- `home`（`/`、`src/app/(app)/page.tsx`）の`loadSetupDiagnosis()`呼び出し（オプションなし＝`probeGradingPathOnly()`）の挙動は変更しない
- 手動ボタンは`/setup`限定（他画面には追加しない）
- `AtlasWaitCompanion`（めくりん）は使わない。`AtlasSpellWait`単体のみ（spec「対象外」、過剰実装回避）
- 「未確認」は`SetupCheck.ok: false`で表現する（既存の他チェック項目の規約と整合、specの「未確認のok値について」参照）

---

### Task 1: `grading-probe.ts` — キャッシュ読み出し・鮮度ラベルの追加

**Files:**
- Modify: `src/lib/grading-probe.ts`
- Test: `src/lib/grading-probe.test.ts`（新規）

**Interfaces:**
- Produces: `readGradingProbeCache(cachePath?: string): GradingProbeCacheRow | null`（`GradingProbeCacheRow = { at: number; result: GradingProbeResult }`）、`formatCheckedLabel(elapsedMs: number): string`、`cachedGradingProbeResult(cachePath?: string): GradingProbeResult`

- [ ] **Step 1: 失敗するテストを書く（`readGradingProbeCache`）**

`src/lib/grading-probe.test.ts`を新規作成:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedGradingProbeResult,
  formatCheckedLabel,
  readGradingProbeCache,
} from "./grading-probe";

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "al-grading-probe-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readGradingProbeCache", () => {
  it("returns null when file does not exist", () => {
    withTmpDir((dir) => {
      const missing = join(dir, "no-such-file.json");
      assert.equal(readGradingProbeCache(missing), null);
    });
  });

  it("returns null for malformed JSON", () => {
    withTmpDir((dir) => {
      const file = join(dir, "cache.json");
      writeFileSync(file, "{not json", "utf8");
      assert.equal(readGradingProbeCache(file), null);
    });
  });

  it("returns the parsed row when valid", () => {
    withTmpDir((dir) => {
      const file = join(dir, "cache.json");
      const row = {
        at: 1000,
        result: {
          ok: true,
          provider: "claude" as const,
          detail: "dry-run OK",
          howTo: "",
          dryRun: true,
        },
      };
      writeFileSync(file, JSON.stringify(row), "utf8");
      assert.deepEqual(readGradingProbeCache(file), row);
    });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx tsx --test src/lib/grading-probe.test.ts`
Expected: FAIL — `readGradingProbeCache` is not exported / not a function

- [ ] **Step 3: `readGradingProbeCache`を実装**

`src/lib/grading-probe.ts`の以下のブロック（`type CacheRow`宣言から`writeCache`関数末尾まで）を丸ごと置き換える。

置き換え対象（現状のコード）:

```ts
type CacheRow = {
  at: number;
  result: GradingProbeResult;
};

const CACHE_PATH = join(homedir(), ".applied-loop", "grading-probe-cache.json");
const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;

function readCache(): CacheRow | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const row = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheRow;
    if (!row?.at || !row?.result) return null;
    return row;
  } catch {
    return null;
  }
}

function writeCache(result: GradingProbeResult): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    const row: CacheRow = { at: Date.now(), result };
    writeFileSync(CACHE_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[grading-probe] cache write failed:", e);
  }
}
```

置き換え後（新しいコード。`CacheRow`を`GradingProbeCacheRow`にリネームしてexportし、`readCache`の中身を`readCacheFrom`へ切り出して`readGradingProbeCache`から呼べるようにする）:

```ts
export type GradingProbeCacheRow = {
  at: number;
  result: GradingProbeResult;
};

const CACHE_PATH = join(homedir(), ".applied-loop", "grading-probe-cache.json");
const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;

function readCacheFrom(path: string): GradingProbeCacheRow | null {
  try {
    if (!existsSync(path)) return null;
    const row = JSON.parse(readFileSync(path, "utf8")) as GradingProbeCacheRow;
    if (!row?.at || !row?.result) return null;
    return row;
  } catch {
    return null;
  }
}

function readCache(): GradingProbeCacheRow | null {
  return readCacheFrom(CACHE_PATH);
}

function writeCache(result: GradingProbeResult): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    const row: GradingProbeCacheRow = { at: Date.now(), result };
    writeFileSync(CACHE_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[grading-probe] cache write failed:", e);
  }
}

/** テスト・`/setup` 表示用: live probe を呼ばずキャッシュだけ読む */
export function readGradingProbeCache(
  cachePath: string = CACHE_PATH,
): GradingProbeCacheRow | null {
  return readCacheFrom(cachePath);
}
```

- [ ] **Step 4: テストを実行して`readGradingProbeCache`のテストが通ることを確認**

Run: `npx tsx --test src/lib/grading-probe.test.ts`
Expected: 上記3件のPASS（`formatCheckedLabel`・`cachedGradingProbeResult`のテストはまだ存在しないので未実行）

- [ ] **Step 5: `formatCheckedLabel`・`cachedGradingProbeResult`の失敗するテストを追記**

同じ`src/lib/grading-probe.test.ts`の末尾に追記:

```ts
describe("formatCheckedLabel", () => {
  it("shows たった今確認 for under 1 minute", () => {
    assert.equal(formatCheckedLabel(0), "たった今確認");
    assert.equal(formatCheckedLabel(59_000), "たった今確認");
  });

  it("shows minutes", () => {
    assert.equal(formatCheckedLabel(5 * 60_000), "5分前に確認");
  });

  it("shows hours", () => {
    assert.equal(formatCheckedLabel(3 * 60 * 60_000), "3時間前に確認");
  });

  it("shows days", () => {
    assert.equal(formatCheckedLabel(2 * 24 * 60 * 60_000), "2日前に確認");
  });
});

describe("cachedGradingProbeResult", () => {
  it("returns 未確認 default when no cache file", () => {
    withTmpDir((dir) => {
      const missing = join(dir, "no-such-file.json");
      const result = cachedGradingProbeResult(missing);
      assert.equal(result.ok, false);
      assert.equal(result.detail, "まだ確認しておらぬ");
    });
  });

  it("appends freshness label to cached detail", () => {
    withTmpDir((dir) => {
      const file = join(dir, "cache.json");
      const at = Date.now() - 5 * 60_000;
      writeFileSync(
        file,
        JSON.stringify({
          at,
          result: {
            ok: true,
            provider: "claude",
            detail: "dry-run OK — claude CLI: /usr/local/bin/claude",
            howTo: "",
            dryRun: true,
          },
        }),
        "utf8",
      );
      const result = cachedGradingProbeResult(file);
      assert.equal(result.ok, true);
      assert.ok(result.detail.includes("分前に確認"));
    });
  });
});
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `npx tsx --test src/lib/grading-probe.test.ts`
Expected: FAIL — `formatCheckedLabel` / `cachedGradingProbeResult` is not exported

- [ ] **Step 7: `formatCheckedLabel`・`cachedGradingProbeResult`を実装**

`src/lib/grading-probe.ts`の`readGradingProbeCache`の直後（`probeGradingPathOnly`の前）に追記:

```ts
export function formatCheckedLabel(elapsedMs: number): string {
  if (elapsedMs < 60_000) return "たった今確認";
  const min = Math.floor(elapsedMs / 60_000);
  if (min < 60) return `${min}分前に確認`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前に確認`;
  const day = Math.floor(hr / 24);
  return `${day}日前に確認`;
}

const UNCHECKED_GRADING_RESULT: GradingProbeResult = {
  ok: false,
  provider: "none",
  detail: "まだ確認しておらぬ",
  howTo: "下のボタンで賢者に伺いを立てよ",
  dryRun: false,
};

/**
 * `/setup` の通常表示用: live probe を呼ばず、直近のキャッシュ結果 + 鮮度ラベルを返す。
 * キャッシュが無ければ「未確認」を表す既定値を返す。
 */
export function cachedGradingProbeResult(
  cachePath: string = CACHE_PATH,
): GradingProbeResult {
  const cached = readGradingProbeCache(cachePath);
  if (!cached) return UNCHECKED_GRADING_RESULT;
  return {
    ...cached.result,
    detail: `${cached.result.detail}（${formatCheckedLabel(Date.now() - cached.at)}）`,
  };
}
```

- [ ] **Step 8: 全テストを実行してPASSを確認**

Run: `npx tsx --test src/lib/grading-probe.test.ts`
Expected: 全件PASS

- [ ] **Step 9: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 10: commit**

```bash
git add src/lib/grading-probe.ts src/lib/grading-probe.test.ts
git commit -m "feat(grading-probe): キャッシュ読み出し専用の関数を追加する"
```

---

### Task 2: `setup-diagnosis.ts` — `gradingFromCache`オプションの配線

**Files:**
- Modify: `src/lib/setup-diagnosis.ts:117-120`（`loadSetupDiagnosis`のオプション型）, `:163-165`（`grading`算出）, `:298-299`（`plain`文言）

**Interfaces:**
- Consumes: `cachedGradingProbeResult(): GradingProbeResult`（Task 1で追加、`src/lib/grading-probe.ts`）
- Produces: `loadSetupDiagnosis(opts?: { gradingDryRun?: boolean; gradingFromCache?: boolean })`

このファイルには既存のテストが無く、DB・env・ファイルシステムに深く依存するため新規ユニットテストは追加しない（Task 7の手動確認・`tsc`で検証する）。

- [ ] **Step 1: オプション型に`gradingFromCache`を追加**

`src/lib/setup-diagnosis.ts:117-120`を以下に置き換える:

```ts
export async function loadSetupDiagnosis(opts?: {
  /** /setup のみ true。採点 CLI を dry-run する（G7） */
  gradingDryRun?: boolean;
  /** /setup のみ true。live probe を呼ばず、直近のキャッシュ結果を表示する */
  gradingFromCache?: boolean;
}): Promise<SetupDiagnosis> {
```

- [ ] **Step 2: `grading`算出の分岐に`gradingFromCache`を追加**

`src/lib/setup-diagnosis.ts:163-165`を以下に置き換える:

```ts
  const grading = opts?.gradingDryRun
    ? await (await import("@/lib/grading-probe")).probeGradingCliLive()
    : opts?.gradingFromCache
      ? (await import("@/lib/grading-probe")).cachedGradingProbeResult()
      : (await import("@/lib/grading-probe")).probeGradingPathOnly();
```

- [ ] **Step 3: `grading_cli`チェックの`plain`文言を修正**

`src/lib/setup-diagnosis.ts:298-299`（`grading_cli`チェックの`plain`フィールド）を以下に置き換える。現状の文言「じゅんびでは dry-run で認証まで確認する」は変更後の挙動と食い違う（自動では確認しなくなる）ため:

```ts
      plain:
        "提出後の採点はヘッドレス LLM（claude または codex）。無い／認証切れだと保留になり、CLI が戻ると自動再採点を試す。認証まで確認したいときは下のボタンで賢者に伺いを立てよ。",
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 5: commit**

```bash
git add src/lib/setup-diagnosis.ts
git commit -m "feat(setup-diagnosis): 採点CLI診断にキャッシュ表示モードを追加する"
```

---

### Task 3: `/setup/page.tsx` — live probe呼び出しの除去、自動再採点の無条件化

**Files:**
- Modify: `src/app/(app)/setup/page.tsx:21-30`

**Interfaces:**
- Consumes: `loadSetupDiagnosis({ gradingFromCache: true })`（Task 2）

このファイルもサーバーコンポーネントで既存テストが無い。Task 7の手動確認で検証する。

- [ ] **Step 1: `gradingDryRun`から`gradingFromCache`へ切り替え、自動再採点ゲートを外す**

`src/app/(app)/setup/page.tsx:21-30`を以下に置き換える:

```ts
  const diagnosis = await loadSetupDiagnosis({ gradingFromCache: true });
  // B5-3: 保留しれんを自動再採点（内部の軽量 PATH チェックで CLI 不在時は no-op）
  const { requeueFailedGradingIfCliReady } = await import(
    "@/lib/requeue-failed-grading"
  );
  await requeueFailedGradingIfCliReady().catch((e) =>
    console.error("[setup] auto-regrade:", e),
  );
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 3: commit**

```bash
git add "src/app/(app)/setup/page.tsx"
git commit -m "fix(setup): /setup描画からlive probeの同期待ちを外す"
```

---

### Task 4: サーバーアクション `runGradingProbeLiveAction`

**Files:**
- Modify: `src/lib/actions.ts`（先頭のimport群、末尾に新規export）

**Interfaces:**
- Consumes: `probeGradingCliLive(): Promise<GradingProbeResult>`（`src/lib/grading-probe.ts`、Task 1以前から存在、無変更）
- Produces: `runGradingProbeLiveAction(): Promise<GradingProbeResult>`

- [ ] **Step 1: importを追加**

`src/lib/actions.ts`の先頭import群（6行目付近、`import { gradeGate } from "@/lib/gate";`の直後）に追加:

```ts
import {
  probeGradingCliLive,
  type GradingProbeResult,
} from "@/lib/grading-probe";
```

- [ ] **Step 2: アクション本体をファイル末尾に追加**

```ts
/** /setup の「賢者に伺いを立てる」ボタン用: live probe を手動実行する */
export async function runGradingProbeLiveAction(): Promise<GradingProbeResult> {
  await requireAuth();
  return probeGradingCliLive();
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 4: commit**

```bash
git add src/lib/actions.ts
git commit -m "feat(actions): grading probeを手動実行するサーバーアクションを追加する"
```

---

### Task 5: `AtlasGradingProbeButton`コンポーネント新規作成

**Files:**
- Create: `src/components/living-atlas/atlas-grading-probe-button.tsx`

**Interfaces:**
- Consumes: `runGradingProbeLiveAction()`（Task 4）、`AtlasSpellWait`（既存、`src/components/living-atlas/atlas-spell-wait.tsx`）、`type GradingProbeResult`（`@/lib/grading-probe`、**型のみimport**）
- Produces: `AtlasGradingProbeButton({ onResult: (result: GradingProbeResult) => void })`

**重要:** `grading-probe.ts`は`node:fs`等のNode専用モジュールに依存するため、クライアントコンポーネントからは**型のみ**（`import type`）でimportすること。値としてimportすると client bundle が壊れる。

- [ ] **Step 1: コンポーネントを作成**

```tsx
"use client";

import { useState, useTransition } from "react";
import { runGradingProbeLiveAction } from "@/lib/actions";
import { AtlasSpellWait } from "./atlas-spell-wait";
import type { GradingProbeResult } from "@/lib/grading-probe";

export function AtlasGradingProbeButton({
  onResult,
}: {
  onResult: (result: GradingProbeResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="dq-btn dq-btn-ghost !px-2 !py-1.5 text-[7px]"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await runGradingProbeLiveAction();
              onResult(result);
            } catch {
              setError("確認できなかった。もう一度試してほしい。");
            }
          });
        }}
      >
        {pending ? "伺いを立てておる…" : "賢者に伺いを立てる"}
      </button>
      <AtlasSpellWait
        variant="inline"
        active={pending}
        label="めくりんが賢者に伺いを立てておる……"
      />
      {error ? (
        <p className="mt-1 mb-0 text-[11px] text-[#e84848]">{error}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: 新規エラーなし（既存の警告のみ）

- [ ] **Step 4: commit**

```bash
git add src/components/living-atlas/atlas-grading-probe-button.tsx
git commit -m "feat(living-atlas): 賢者に伺いを立てるボタンを追加する"
```

---

### Task 6: `atlas-onboarding.tsx`の`CheckRow`へ組み込み

**Files:**
- Modify: `src/components/living-atlas/atlas-onboarding.tsx:1118-1161`（`CheckRow`関数）

**Interfaces:**
- Consumes: `AtlasGradingProbeButton`（Task 5）、`type GradingProbeResult`（`@/lib/grading-probe`、**型のみimport**）

- [ ] **Step 1: importを追加**

`src/components/living-atlas/atlas-onboarding.tsx`の先頭import群、`import { AtlasCloudMcpWizardSection } from "./atlas-cloud-mcp-wizard";`の直後に追加:

```ts
import { AtlasGradingProbeButton } from "./atlas-grading-probe-button";
import type { GradingProbeResult } from "@/lib/grading-probe";
```

- [ ] **Step 2: `CheckRow`にlocal override stateとボタンを組み込む**

`src/components/living-atlas/atlas-onboarding.tsx:1118-1161`の`CheckRow`関数全体を以下に置き換える:

```tsx
function CheckRow({
  check,
  highlight,
}: {
  check: SetupCheck;
  highlight: boolean;
}) {
  const [override, setOverride] = useState<GradingProbeResult | null>(null);
  const effective =
    check.id === "grading_cli" && override
      ? {
          ...check,
          ok: override.ok,
          detail: `${override.detail}（たった今確認）`,
          howTo: override.howTo,
        }
      : check;

  return (
    <li
      className={`flex min-w-0 items-start gap-2 py-1.5 text-[13px] ${
        highlight ? "text-[#f7f3d9]" : "text-[#c9c3a0]"
      }`}
    >
      <span
        className={`shrink-0 font-[family-name:var(--font-pixel)] text-[10px] ${
          effective.ok ? "text-[#3ecf5a]" : "text-[#e84848]"
        }`}
      >
        {effective.ok ? "✓" : "！"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 leading-snug">
          {effective.label}
          {!effective.required ? (
            <span className="ml-1 text-[10px] text-[#9ec0ff]">任意</span>
          ) : null}
        </p>
        <p className="mt-0.5 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          {effective.plain}
        </p>
        {effective.detail ? (
          <p className="mt-0.5 mb-0 text-[11px] leading-relaxed text-[#9a9470]">
            {effective.detail}
          </p>
        ) : null}
        {!effective.ok ? (
          <p className="mt-0.5 mb-0 font-mono text-[10px] leading-relaxed text-[#c9c3a0]">
            → {effective.howTo}
          </p>
        ) : null}
        {check.id === "grading_cli" ? (
          <AtlasGradingProbeButton onResult={setOverride} />
        ) : null}
      </div>
    </li>
  );
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 4: lint**

Run: `npm run lint`
Expected: 新規エラーなし

- [ ] **Step 5: commit**

```bash
git add src/components/living-atlas/atlas-onboarding.tsx
git commit -m "feat(living-atlas): 採点の賢者チェック行に伺いを立てるボタンを組み込む"
```

---

### Task 7: 統合検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全体テスト**

Run: `npx tsc --noEmit -p . && npm run lint && npm test`
Expected: tscエラーなし・lint新規エラーなし・test全件PASS（Task 1の新規テスト含む）

- [ ] **Step 2: 冷えたキャッシュでの実機確認**

```bash
mv ~/.applied-loop/grading-probe-cache.json ~/.applied-loop/grading-probe-cache.json.bak 2>/dev/null || true
```

devサーバーで`/setup`を開き、即座に開くこと（8秒ブロックが発生しないこと）、「採点の賢者」項目が「未確認」表示になっていることを確認する。

- [ ] **Step 3: 手動ボタンの実機確認**

「賢者に伺いを立てる」ボタンを押し、`AtlasSpellWait`（「めくりんが賢者に伺いを立てておる……」）が表示され、完了後にその場で結果（✓/！・detail・howTo）が更新されることを確認する。

- [ ] **Step 4: キャッシュ復元と鮮度表示の確認**

`/setup`をリロードし、直前の手動確認結果がキャッシュから表示され「たった今確認」等の鮮度ラベルが付いていることを確認する。バックアップを復元する:

```bash
mv ~/.applied-loop/grading-probe-cache.json.bak ~/.applied-loop/grading-probe-cache.json 2>/dev/null || true
```

- [ ] **Step 5: 自動再採点（B5-3）の回帰確認**

`prisma.gate`に`status: "grading_failed"`の行が存在する場合、`/setup`を開いた後にその行が`status: "answered"`へ遷移し再採点が走ることを確認する（該当データが無ければこのステップはスキップしてよい。ロジック自体は無変更のため低リスク）。

- [ ] **Step 6: 最終commit（該当があれば）**

Task 1〜6で個別commit済みのため、追加の差分が無ければcommit不要。バックアップファイルの移動はrepo外の操作なのでcommit対象外。
