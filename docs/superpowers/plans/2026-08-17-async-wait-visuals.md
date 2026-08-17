# AI回答待ち（じゅもん詠唱中）演出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Living Atlas の3シーン（埋め込みターミナル・しれん採点ポーリング・週のしょ等バックグラウンド生成）に、AIが応答している最中であることを示す専用の待機演出（じゅもんタイピング＋しれん採点限定でめくりんキャラ）を追加する。

**Architecture:** 2つの新規共有コンポーネント — `AtlasSpellWait`（かな列タイピング演出、`inline`/`panel` の2バリアント）と `AtlasWaitCompanion`（めくりんの2フレームCanvasアニメーション＋オーラ・ルーン輪・光の粒のCSS装飾）を作成し、`active` フラグで3つの既存シーンへ配線する。ドット絵データは `atlas-lumina.ts` の `pack`/`assertFrame`/`paintXFrame` パターンをそのまま踏襲、CSS は `atlas-route-loading` の `dq-win`・`prefers-reduced-motion` 規約を踏襲する。

**Tech Stack:** Next.js (App Router) / React (Client Components) / TypeScript / Canvas 2D / CSS keyframes / `node:test`（`tsx --test`）

**Spec:** `docs/superpowers/specs/2026-08-17-async-wait-visuals-design.md`

## Global Constraints

- 対象シーンは以下の3つのみ（spec スコープ節）: (1) 埋め込みターミナル `terminal-panel.tsx`、(2) しれん採点ポーリング待ち `atlas-battle.tsx`、(3) 週のしょ等バックグラウンド生成 `atlas-nikki-retro.tsx` の `NikkiBulkPanel`
- `AtlasWaitCompanion` はしれん採点シーン限定。他シーンには追加しない（spec 対象外節）
- ページ遷移ロードUI（`AtlasRouteLoadingProvider`/`AtlasRouteLoading`）は変更しない
- ターミナルのアクティビティ判定は「直近1.5秒以内に output があったか」の緩い判定でよい。PTY出力の意味解析はしない
- かな列は固定のダミー候補からのみ選ぶ。実際のLLM出力を流用しない（機密混入・処理コスト回避）
- `AtlasSpellWait` / `AtlasWaitCompanion` はともに `role="status"` + `aria-live="polite"` を持つ
- `prefers-reduced-motion: reduce` 時は両コンポーネントとも静止表示に切り替える（タイピングループ停止・かな列は静的に全文表示、めくりんは瞬きなしFRAME_A固定、オーラ・ルーン輪・光の粒のアニメーションも停止）
- `atlas-mekurin.ts` は `atlas-lumina.ts` と同じ `pack`/`assertFrame`/`paintXFrame` パターンに揃え、モジュール読み込み時に `assertFrame` を自走させる
- commit / push は明示依頼があるまでしない（このリポジトリの既定運用）

---

## ファイル構成

**新規作成:**
- `src/components/living-atlas/atlas-mekurin.ts` — めくりんドット絵データ（`atlas-lumina.ts` と同形式）
- `src/components/living-atlas/atlas-spell-wait.tsx` — `AtlasSpellWait` 共有コンポーネント（かな列タイピング演出）
- `src/components/living-atlas/atlas-spell-wait.test.ts` — かな進行の純関数ユニットテスト
- `src/components/living-atlas/atlas-wait-companion.tsx` — `AtlasWaitCompanion`（めくりん＋オーラ＋ルーン輪＋光の粒）

**変更:**
- `src/app/atlas-living.css` — 上記2コンポーネント用CSSブロックをファイル末尾に追記
- `src/components/terminal-panel.tsx` — ステータス行に `AtlasSpellWait variant="inline"` を配線（シーン1）
- `src/components/living-atlas/atlas-battle.tsx` — 「あなた」ステータスカードの採点待ち表示を `AtlasSpellWait variant="panel"` + `AtlasWaitCompanion` に置き換え（シーン2）
- `src/components/living-atlas/atlas-nikki-retro.tsx` — `NikkiBulkPanel` の生成中ボタン隣に `AtlasSpellWait variant="inline"` を配線（シーン3）

---

### Task 1: `atlas-mekurin.ts`（めくりんドット絵データ）

**Files:**
- Create: `src/components/living-atlas/atlas-mekurin.ts`

**Interfaces:**
- Produces: `export type MekurinDef = { name: string; width: number; height: number; frames: string[]; palette: Record<string, string | null> }`、`export const MEKURIN: MekurinDef`、`export function paintMekurinFrame(ctx: CanvasRenderingContext2D, def: MekurinDef, frameIndex: number, scale?: number): void`

- [ ] **Step 1: `atlas-lumina.ts` と同形式でファイルを作成する**

`src/components/living-atlas/atlas-mekurin.ts`:

```ts
/**
 * めくりん（魔導書の使い魔）ドット絵（20×16・2フレーム）。
 * AI回答待ち演出「案2」専用キャラ。ルミナ（atlas-lumina.ts）とは別役割。
 *
 * パレット: 8 outline, w ページ(cream), m インク線(cream-dim),
 * a 表紙(navy系), g しおり(gold), d しおり先端(gold-dark),
 * e 目のハイライト(white), c 星屑(star)
 */

export type MekurinDef = {
  name: string;
  width: number;
  height: number;
  frames: string[];
  palette: Record<string, string | null>;
};

function pack(rows: string[]): string {
  return rows.join("\n");
}

const W = 20;
const H = 16;

const PALETTE: Record<string, string | null> = {
  ".": null,
  "8": "#140c18",
  w: "#f7f3d9",
  m: "#c9c3a0",
  a: "#1838b0",
  g: "#f0d25a",
  d: "#b88818",
  e: "#ffffff",
  c: "#9ec0ff",
};

/** A: 目開き・右ページ最後の行はまだ空白 */
const FRAME_A = [
  "................c...",
  "..c.................",
  ".88..............88.",
  ".8w88..........88w8.",
  ".8www88......88www8.",
  ".8wwwww88..88wwwww8.",
  ".8wwww8ew88w8ewwww8.",
  ".8wwww88w88w88wwww8.",
  ".8wmmmwwwmmwwwmmmw8.",
  ".8wmmwmmwmmwmmwwww8.", // 右ページ最後の行はまだ空白
  ".88wwwwwwmmwwwwww88.",
  "..8aaaaaaaaaaaaaa8..",
  "...8aaaa8gg8aaaa8...",
  "........8gg8........",
  "........8dd8........",
  "....................",
];

/** B: 瞬き + 右ページに新しい1行が書かれる + しおりが1pxスウェイ + 星屑入れ替え */
const FRAME_B = [
  "...c................",
  ".................c..",
  ".88..............88.",
  ".8w88..........88w8.",
  ".8www88......88www8.",
  ".8wwwww88..88wwwww8.",
  ".8wwwwwww88wwwwwww8.", // 目を閉じる
  ".8wwww88w88w88wwww8.",
  ".8wmmmwwwmmwwwmmmw8.",
  ".8wmmwmmwmmwmmwmmw8.", // ← 空白だった行にインク線が現れる
  ".88wwwwwwmmwwwwww88.",
  "..8aaaaaaaaaaaaaa8..",
  "...8aaaa8gg8aaaa8...",
  ".........8gg8.......", // しおりスウェイ
  ".........8dd8.......",
  "....................",
];

function assertFrame(rows: string[], label: string) {
  if (rows.length !== H) {
    throw new Error(`Mekurin ${label}: expected ${H} rows, got ${rows.length}`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.length !== W) {
      throw new Error(
        `Mekurin ${label} row ${i}: expected ${W} cols, got ${rows[i]!.length}`,
      );
    }
  }
}

assertFrame(FRAME_A, "A");
assertFrame(FRAME_B, "B");

export const MEKURIN: MekurinDef = {
  name: "めくりん",
  width: W,
  height: H,
  palette: PALETTE,
  frames: [pack(FRAME_A), pack(FRAME_B)],
};

export function paintMekurinFrame(
  ctx: CanvasRenderingContext2D,
  def: MekurinDef = MEKURIN,
  frameIndex: number,
  scale = 4,
) {
  const rows = def.frames[frameIndex % def.frames.length]!.split("\n");
  const pw = def.width * scale;
  const ph = def.height * scale;
  ctx.clearRect(0, 0, pw, ph);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const col = def.palette[row[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
```

- [ ] **Step 2: モジュール読み込み時の `assertFrame` 自走を確認する**

Run: `npx tsx -e "import('./src/components/living-atlas/atlas-mekurin.ts').then(() => console.log('OK: no assertFrame throw'))"`
Expected: `OK: no assertFrame throw`（行数・桁数はTask記述前に別途Nodeスクリプトで検証済みのデータそのままなので、ここでは import 時に例外が出ないことだけ確認すればよい。追加のユニットテストは不要 — spec のテスト方針節の通り）

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add src/components/living-atlas/atlas-mekurin.ts
git commit -m "feat(living-atlas): めくりんのドット絵データを追加する"
```

---

### Task 2: `AtlasSpellWait`（じゅもんタイピング演出）

**Files:**
- Create: `src/components/living-atlas/atlas-spell-wait.tsx`
- Test: `src/components/living-atlas/atlas-spell-wait.test.ts`
- Modify: `src/app/atlas-living.css`（末尾に追記）

**Interfaces:**
- Produces: `export function visibleCharsForElapsed(elapsedMs: number, phraseLength: number, charIntervalMs?: number, holdMs?: number): number`（純関数、タイピング＋ホールドを1サイクルとしてループする経過時間→表示文字数の変換）、`export function AtlasSpellWait(props: { variant: "inline" | "panel"; label: string; active: boolean }): JSX.Element | null`

**設計メモ（実装者向け）:** spec はタイピング完了後のループ挙動を明記していない（最長2分のポーリングに対しダミー句が数秒で書き終わってしまうため、何かしらのループが要る）。本タスクでは「1文字ずつタイピング → 全文表示のままホールド → 同じ句を最初から再タイピング」を1サイクルとし、経過時間から表示文字数を導出する純関数 `visibleCharsForElapsed` として実装する（`setInterval` の毎回のtickで単調カウントアップするのではなく、経過時間からの導出にすることでタブのスロットリングに強くなり、かつ純関数としてテストしやすくなる）。かな列自体は「マウント時にランダム選択」（spec通り）で、以後は同じ句をループする。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/living-atlas/atlas-spell-wait.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleCharsForElapsed } from "./atlas-spell-wait";

describe("visibleCharsForElapsed", () => {
  it("t=0 では0文字", () => {
    assert.equal(visibleCharsForElapsed(0, 10, 140, 900), 0);
  });

  it("charIntervalMs ごとに1文字ずつ進む", () => {
    assert.equal(visibleCharsForElapsed(140, 10, 140, 900), 1);
    assert.equal(visibleCharsForElapsed(700, 10, 140, 900), 5);
  });

  it("全文表示後はholdMsの間、文字数が満了のまま止まる", () => {
    assert.equal(visibleCharsForElapsed(10 * 140, 10, 140, 900), 10);
    assert.equal(visibleCharsForElapsed(10 * 140 + 500, 10, 140, 900), 10);
  });

  it("1サイクル（タイピング+ホールド）を過ぎると0文字から再開する", () => {
    const cycle = 10 * 140 + 900;
    assert.equal(visibleCharsForElapsed(cycle, 10, 140, 900), 0);
    assert.equal(visibleCharsForElapsed(cycle + 140, 10, 140, 900), 1);
  });

  it("phraseLength が0以下なら常に0", () => {
    assert.equal(visibleCharsForElapsed(500, 0, 140, 900), 0);
    assert.equal(visibleCharsForElapsed(500, -1, 140, 900), 0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx tsx --test src/components/living-atlas/atlas-spell-wait.test.ts`
Expected: FAIL（`atlas-spell-wait.tsx` が存在せず import エラー）

- [ ] **Step 3: `visibleCharsForElapsed` を含むコンポーネントを実装する**

`src/components/living-atlas/atlas-spell-wait.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Props = {
  variant: "inline" | "panel";
  /** 例: "じゅもんを かきとめている……" */
  label: string;
  active: boolean;
};

const PHRASES = [
  "ふるいけや　かはずとびこむ　みずのおと",
  "つきひかり　もりのおくより　こえひとつ",
  "かぜのおと　しずかにきざむ　しるしかな",
];

const CHAR_INTERVAL_MS = 140;
const HOLD_MS = 900;
const TICK_MS = 100;

/**
 * 経過時間から表示すべき文字数を返す。
 * 「1文字ずつタイピング → 全文表示のままホールド」を1サイクルとしてループする。
 */
export function visibleCharsForElapsed(
  elapsedMs: number,
  phraseLength: number,
  charIntervalMs = CHAR_INTERVAL_MS,
  holdMs = HOLD_MS,
): number {
  if (phraseLength <= 0) return 0;
  const cycleMs = phraseLength * charIntervalMs + holdMs;
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  return Math.min(phraseLength, Math.floor(t / charIntervalMs));
}

function pickPhrase(): string {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)]!;
}

export function AtlasSpellWait({ variant, label, active }: Props) {
  const [phrase] = useState(pickPhrase);
  const [charsShown, setCharsShown] = useState(0);

  useEffect(() => {
    if (!active) {
      setCharsShown(0);
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setCharsShown(phrase.length);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setCharsShown(
        visibleCharsForElapsed(Date.now() - startedAt, phrase.length),
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, phrase]);

  if (!active) return null;

  const visible = phrase.slice(0, charsShown).split("");

  return (
    <div
      className={`atlas-spell-wait atlas-spell-wait--${variant}${
        variant === "panel" ? " dq-win" : ""
      }`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {variant === "panel" ? (
        <p className="atlas-spell-wait__label">{label}</p>
      ) : null}
      <p className="atlas-spell-wait__line">
        {visible.map((ch, i) => (
          <span
            key={i}
            className={
              i === visible.length - 1
                ? "atlas-spell-wait__char atlas-spell-wait__char--active"
                : "atlas-spell-wait__char"
            }
          >
            {ch}
          </span>
        ))}
        <span className="atlas-cursor" />
      </p>
    </div>
  );
}
```

**設計メモ:** `variant="inline"` は1行のミニチップとして使うため `label` を視覚的には出さず `aria-label` のみに回し、`variant="panel"` は `label` を見出しとして表示する（`dq-win` 相当のカードは表示領域に余裕があるため）。DQ伝統の「▼」カーソルは、既存の `.atlas-cursor`（`src/app/atlas-living.css:3734`、box-shadowでドット矩形▼を組む、既に `prefers-reduced-motion` 無効化リストに含まれている）をそのまま再利用する — 新規CSSを増やさない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx tsx --test src/components/living-atlas/atlas-spell-wait.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: CSSを追記する**

`src/app/atlas-living.css` の末尾に追記:

```css

/* —— AI回答待ち演出「じゅもんタイピング」（AtlasSpellWait） —— */
.atlas-spell-wait {
  font-family: var(--font-jp);
  color: var(--atlas-cream);
}

.atlas-spell-wait--inline {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  font-size: 11px;
  color: var(--atlas-cream-dim);
  white-space: nowrap;
}

.atlas-spell-wait--panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  min-width: 180px;
}

.atlas-spell-wait__label {
  margin: 0;
  font-size: 11px;
  color: var(--atlas-cream-dim);
}

.atlas-spell-wait__line {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.atlas-spell-wait--inline .atlas-spell-wait__line {
  font-size: 11px;
}

@keyframes atlas-spell-wait-flash {
  0% {
    color: var(--atlas-gold);
  }
  50% {
    color: var(--atlas-edge);
  }
  100% {
    color: var(--atlas-cream);
  }
}

.atlas-spell-wait__char--active {
  animation: atlas-spell-wait-flash 0.5s steps(3) both;
}

@media (prefers-reduced-motion: reduce) {
  .atlas-spell-wait__char--active {
    animation: none !important;
  }
}
```

- [ ] **Step 6: 型チェック・全体テスト**

Run: `npx tsc --noEmit -p . && npm test`
Expected: どちらもエラーなし・全件PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/living-atlas/atlas-spell-wait.tsx src/components/living-atlas/atlas-spell-wait.test.ts src/app/atlas-living.css
git commit -m "feat(living-atlas): AtlasSpellWait（じゅもんタイピング演出）を追加する"
```

---

### Task 3: `AtlasWaitCompanion`（めくりん）

**Files:**
- Create: `src/components/living-atlas/atlas-wait-companion.tsx`
- Modify: `src/app/atlas-living.css`（末尾に追記）

**Interfaces:**
- Consumes: `MEKURIN`, `paintMekurinFrame` from `./atlas-mekurin`（Task 1）
- Produces: `export function AtlasWaitCompanion(props: { active: boolean }): JSX.Element | null`

- [ ] **Step 1: コンポーネントを実装する**

`src/components/living-atlas/atlas-wait-companion.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { MEKURIN, paintMekurinFrame } from "./atlas-mekurin";

const SCALE = 3;
const BLINK_INTERVAL_MS = 2600;
const BLINK_HOLD_MS = 160;

export function AtlasWaitCompanion({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    paintMekurinFrame(ctx, MEKURIN, 0, SCALE);

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
    const blinkInterval = window.setInterval(() => {
      paintMekurinFrame(ctx, MEKURIN, 1, SCALE);
      blinkTimeout = window.setTimeout(() => {
        paintMekurinFrame(ctx, MEKURIN, 0, SCALE);
      }, BLINK_HOLD_MS);
    }, BLINK_INTERVAL_MS);

    return () => {
      window.clearInterval(blinkInterval);
      if (blinkTimeout) window.clearTimeout(blinkTimeout);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="atlas-wait-companion" role="status" aria-live="polite">
      <span className="atlas-wait-companion__aura" aria-hidden />
      <span className="atlas-wait-companion__ring" aria-hidden />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--0"
        aria-hidden
      />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--1"
        aria-hidden
      />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--2"
        aria-hidden
      />
      <span
        className="atlas-wait-companion__mote atlas-wait-companion__mote--3"
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className="atlas-wait-companion__canvas"
        width={MEKURIN.width * SCALE}
        height={MEKURIN.height * SCALE}
        aria-hidden
      />
    </div>
  );
}
```

- [ ] **Step 2: CSSを追記する**

`src/app/atlas-living.css` の末尾に追記:

```css

/* —— AI回答待ち演出「めくりん」（AtlasWaitCompanion、しれん採点限定） —— */
.atlas-wait-companion {
  position: relative;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.atlas-wait-companion__aura {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(240, 210, 90, 0.35),
    transparent 70%
  );
  animation: atlas-wait-companion-pulse 2.8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes atlas-wait-companion-pulse {
  0%,
  100% {
    transform: scale(0.85);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
}

.atlas-wait-companion__ring {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  border: 2px dashed var(--atlas-gold);
  animation: atlas-wait-companion-spin 3.2s steps(8) infinite;
  pointer-events: none;
}

@keyframes atlas-wait-companion-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.atlas-wait-companion__mote {
  position: absolute;
  bottom: 10px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--atlas-gold);
  animation: atlas-float-up 2.6s steps(6) infinite;
  pointer-events: none;
}

.atlas-wait-companion__mote--0 {
  left: 26%;
  animation-delay: 0s;
}
.atlas-wait-companion__mote--1 {
  left: 46%;
  animation-delay: 0.65s;
}
.atlas-wait-companion__mote--2 {
  left: 64%;
  animation-delay: 1.3s;
}
.atlas-wait-companion__mote--3 {
  left: 38%;
  animation-delay: 1.95s;
}

.atlas-wait-companion__canvas {
  position: relative;
  z-index: 1;
  image-rendering: pixelated;
  animation: dq-bob 1.2s steps(2) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .atlas-wait-companion__aura,
  .atlas-wait-companion__ring,
  .atlas-wait-companion__mote,
  .atlas-wait-companion__canvas {
    animation: none !important;
  }
}
```

**設計メモ:** `atlas-wait-companion__mote` の浮遊は既存の `atlas-float-up`（`src/app/atlas-living.css` 内、`.atlas-dg-nest__joy .atlas-dot` で使用中）キーフレームをそのまま再利用する（新規キーフレーム不要、DRY）。同様に浮遊本体は既存の `dq-bob` キーフレーム（`.dq-enemy-idle` 等で使用中）を再利用する。ルーン輪の回転秒数（3.2s）と光の粒の個数（4個・3〜5個の範囲内）は spec が数値を指定していない箇所のため、既存の類似演出のテンポに合わせて実装者が決めた値。

- [ ] **Step 3: 型チェック・全体テスト**

Run: `npx tsc --noEmit -p . && npm test`
Expected: どちらもエラーなし・全件PASS（本タスクはCanvas描画・タイマーのみでロジックの純関数切り出しがないため新規ユニットテストは追加しない。spec のテスト方針節の通り、実機確認は Task 7 で行う）

- [ ] **Step 4: Commit**

```bash
git add src/components/living-atlas/atlas-wait-companion.tsx src/app/atlas-living.css
git commit -m "feat(living-atlas): AtlasWaitCompanion（めくりん）を追加する"
```

---

### Task 4: シーン1 — 埋め込みターミナルへの配線

**Files:**
- Modify: `src/components/terminal-panel.tsx`

**Interfaces:**
- Consumes: `AtlasSpellWait` from `./living-atlas/atlas-spell-wait`（Task 2）

- [ ] **Step 1: importを追加する**

`src/components/terminal-panel.tsx` 冒頭の import 群（5行目、`import "xterm/css/xterm.css";` の直後）に追加:

```tsx
import { AtlasSpellWait } from "./living-atlas/atlas-spell-wait";
```

- [ ] **Step 2: refとstateを追加する**

`ptyAliveRef` の宣言（61行目）の直後に追加:

```tsx
  const ptyAliveRef = useRef(false);
  const lastOutputAtRef = useRef(0);
  const [spellActive, setSpellActive] = useState(false);
```

- [ ] **Step 3: `case "output":` で最終出力時刻を記録する**

`ws.onmessage` 内の `case "output":`（180-182行目）を変更:

```tsx
          case "output":
            if (typeof msg.data === "string") term?.write(msg.data);
            lastOutputAtRef.current = Date.now();
            break;
```

- [ ] **Step 4: アクティビティ判定用の軽量ポーリングeffectを追加する**

メインの `useEffect(...)`（`}, [gateId, wsToken, session, intent, context, initialCmd, initialModel]);` で終わるブロック、284行目）の直後、`const handleRestart = ...`（286行目）の直前に追加:

```tsx
  useEffect(() => {
    if (connState !== "ready") {
      setSpellActive(false);
      return;
    }
    const id = window.setInterval(() => {
      setSpellActive(Date.now() - lastOutputAtRef.current < 1500);
    }, 300);
    return () => window.clearInterval(id);
  }, [connState]);
```

- [ ] **Step 5: ステータス行にJSXを追加する**

`{statusMessage && (...)}` ブロック（304-306行目）の直後に追加:

```tsx
        {connState === "ready" ? (
          <AtlasSpellWait
            variant="inline"
            active={spellActive}
            label="じゅもんを かきとめている……"
          />
        ) : null}
```

- [ ] **Step 6: 型チェック・全体テスト**

Run: `npx tsc --noEmit -p . && npm test`
Expected: どちらもエラーなし・全件PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/terminal-panel.tsx
git commit -m "feat(terminal): AI応答待ち中にAtlasSpellWaitを表示する"
```

---

### Task 5: シーン2 — しれん採点ポーリング待ちへの配線

**Files:**
- Modify: `src/components/living-atlas/atlas-battle.tsx`

**Interfaces:**
- Consumes: `AtlasSpellWait` from `./atlas-spell-wait`（Task 2）, `AtlasWaitCompanion` from `./atlas-wait-companion`（Task 3）

- [ ] **Step 1: importを追加する**

`atlas-battle.tsx` の `import { AtlasMicroDrill, AtlasRecallDrill } from "./atlas-micro-drill";`（21行目）の直後に追加:

```tsx
import { AtlasSpellWait } from "./atlas-spell-wait";
import { AtlasWaitCompanion } from "./atlas-wait-companion";
```

- [ ] **Step 2: 「あなた」ステータスカードの採点待ち表示を置き換える**

`atlas-battle.tsx` の以下のブロック（844-863行目）:

```tsx
        <div className="grid grid-cols-1 gap-2 border-t-4 border-black bg-[#000c4a] p-2.5 md:grid-cols-[0.85fr_1.15fr]">
          <div className="dq-win p-3">
            <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[12px] text-[#f0d25a]">
              あなた
            </div>
            <div className="mt-2 flex justify-between text-[14px]">
              <span>状態</span>
              <span className="truncate pl-2 text-[#c9c3a0]">
                {phase === "waiting"
                  ? "採点中…"
                  : verdict === "pass"
                    ? "CLEAR"
                    : verdict === "retry"
                      ? "miss"
                      : verdict === "grading_failed"
                        ? "保留"
                        : "たたかい中"}
              </span>
            </div>
          </div>
```

を、次のように置き換える（「採点中…」の分岐を専用パネルへ切り出し、通常時のカードは残す）:

```tsx
        <div className="grid grid-cols-1 gap-2 border-t-4 border-black bg-[#000c4a] p-2.5 md:grid-cols-[0.85fr_1.15fr]">
          {phase === "waiting" ? (
            <div className="flex flex-wrap items-start gap-2">
              <AtlasSpellWait
                variant="panel"
                active={phase === "waiting"}
                label="さいばんの じゅもんを かきとめている……"
              />
              <AtlasWaitCompanion active={phase === "waiting"} />
            </div>
          ) : (
            <div className="dq-win p-3">
              <div className="mb-1.5 font-[family-name:var(--font-pixel)] text-[12px] text-[#f0d25a]">
                あなた
              </div>
              <div className="mt-2 flex justify-between text-[14px]">
                <span>状態</span>
                <span className="truncate pl-2 text-[#c9c3a0]">
                  {verdict === "pass"
                    ? "CLEAR"
                    : verdict === "retry"
                      ? "miss"
                      : verdict === "grading_failed"
                        ? "保留"
                        : "たたかい中"}
                </span>
              </div>
            </div>
          )}
```

**設計メモ:** `AtlasSpellWait variant="panel"` は自身が `dq-win` 相当のカード（背景・枠・影）を持つため、既存の `dq-win p-3` ラッパーの中に入れ子にすると二重枠になる。そのため採点待ち中は「あなた」カード自体をこの2コンポーネントの横並びに丸ごと差し替える（`grid-cols-[0.85fr_1.15fr]` の左セルはそのまま維持されるのでレイアウト崩れはない）。

- [ ] **Step 3: 型チェック・全体テスト**

Run: `npx tsc --noEmit -p . && npm test`
Expected: どちらもエラーなし・全件PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/living-atlas/atlas-battle.tsx
git commit -m "feat(atlas-battle): 採点待ち表示をAtlasSpellWait+AtlasWaitCompanionに置き換える"
```

---

### Task 6: シーン3 — 週のしょ等バックグラウンド生成への配線

**Files:**
- Modify: `src/components/living-atlas/atlas-nikki-retro.tsx`

**Interfaces:**
- Consumes: `AtlasSpellWait` from `./atlas-spell-wait`（Task 2）

- [ ] **Step 1: importを追加する**

`atlas-nikki-retro.tsx` の `import { AtlasSurfaceIcon } from "./atlas-surface-icons";`（8行目）の直後に追加:

```tsx
import { AtlasSpellWait } from "./atlas-spell-wait";
```

- [ ] **Step 2: 生成中ボタンの隣にAtlasSpellWaitを配置する**

`NikkiBulkPanel` 内の以下のブロック（236-257行目）:

```tsx
      <div className="atlas-nikki-bulk__foot">
        <button
          type="button"
          className="dq-btn !px-3 !py-2 text-[8px]"
          disabled={pending || selected.length === 0}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const res = await bulkGenerateDailyTextbooksAction(selected);
              setResult(
                res.failed.length > 0
                  ? `${res.done.length}日ぶん作成。${res.failed.length}日は失敗（材料なしかも）。`
                  : `${res.done.length}日ぶん、教科書にした。`,
              );
              router.refresh();
            });
          }}
        >
          {pending
            ? "教科書にしている…"
            : `えらんだ日を教科書化する（${selected.length}日）`}
        </button>
        <p className="atlas-nikki-bulk__caution">
```

を、次のように置き換える（ボタンを `flex` の行でラップし、隣に `AtlasSpellWait` を置く）:

```tsx
      <div className="atlas-nikki-bulk__foot">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="dq-btn !px-3 !py-2 text-[8px]"
            disabled={pending || selected.length === 0}
            onClick={() => {
              setResult(null);
              startTransition(async () => {
                const res = await bulkGenerateDailyTextbooksAction(selected);
                setResult(
                  res.failed.length > 0
                    ? `${res.done.length}日ぶん作成。${res.failed.length}日は失敗（材料なしかも）。`
                    : `${res.done.length}日ぶん、教科書にした。`,
                );
                router.refresh();
              });
            }}
          >
            {pending
              ? "教科書にしている…"
              : `えらんだ日を教科書化する（${selected.length}日）`}
          </button>
          <AtlasSpellWait
            variant="inline"
            active={pending}
            label="しょを あんでいる……"
          />
        </div>
        <p className="atlas-nikki-bulk__caution">
```

（`.atlas-nikki-bulk__foot` の閉じ `</div>` の直前、`.atlas-nikki-bulk__caution` 以降のブロックは変更なし。新しく開いた `<div className="flex ...">` の閉じタグをボタン＋`AtlasSpellWait` の直後に追加することを忘れないこと）

- [ ] **Step 3: 型チェック・全体テスト**

Run: `npx tsc --noEmit -p . && npm test`
Expected: どちらもエラーなし・全件PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/living-atlas/atlas-nikki-retro.tsx
git commit -m "feat(nikki-retro): 教科書化バックグラウンド生成中にAtlasSpellWaitを表示する"
```

---

### Task 7: 3シーン実機確認

**Files:** なし（コード変更なし、確認のみ）

**Interfaces:** なし

- [ ] **Step 1: devサーバーを再起動する**

前セッションから稼働し続けている古いプロセス（PID 63898/63864）は今回のマージを反映していないため、必ず再起動してから確認する。

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN
lsof -nP -iTCP:3101 -sTCP:LISTEN
# 生きていれば該当PIDをkillしてから
npm run dev:all
```

- [ ] **Step 2: シーン1（ターミナル）を確認する**

`/harness` 等の埋め込みターミナルが使えるページを開き、CLIに何か出力させ、ステータス行に `AtlasSpellWait variant="inline"` が現れる／出力が1.5秒止まると消えることを確認する。

- [ ] **Step 3: シーン2（しれん採点）を確認する**

しれんで解答を提出し、`phase === "waiting"` の間、「あなた」カードの位置に `AtlasSpellWait variant="panel"` と `AtlasWaitCompanion`（めくりん・オーラ・ルーン輪・光の粒）が横並びで表示されることを確認する。

- [ ] **Step 4: シーン3（週のしょ生成）を確認する**

`/retro` の「未作成の日をまとめて教科書化」パネルで生成を実行し、ボタン隣に `AtlasSpellWait variant="inline"` が表示されることを確認する。

- [ ] **Step 5: `prefers-reduced-motion: reduce` を確認する**

Chrome DevTools の Rendering タブ（または `mcp__claude-in-chrome__javascript_tool` 等）で `prefers-reduced-motion: reduce` をエミュレートし、上記3シーンいずれもタイピングループ・めくりんの瞬き・オーラ・ルーン輪・光の粒のアニメーションが止まり、静止表示になることを確認する。

- [ ] **Step 6: koki確認**

スクリーンショット（`mcp__claude-in-chrome__computer` のscreenshot、または `read_page`）を撮ってkokiに見せ、問題なければ実行完了とする。

---

## Self-Review 記録

- **Spec coverage:** `AtlasSpellWait`（案1、Task 2）／`AtlasWaitCompanion`（案2、Task 1・3）／3シーン配線（Task 4-6）／アクセシビリティ（role/aria-live、全コンポーネントで実装）／`prefers-reduced-motion`（JS側・CSS側の両方で全コンポーネントに実装）／テスト方針（`atlas-mekurin.ts`は自己検証のみ・`AtlasSpellWait`純関数はnode:testでカバー・実機確認はTask 7）を、spec の該当節ごとに1つ以上のタスクへ対応付け済み。対象外節（PTY意味解析・トモシ/ホウホウ・`AtlasRouteLoading`変更・週のしょへの`AtlasWaitCompanion`追加）はいずれのタスクにも含めていないことを確認した
- **Placeholder scan:** 「TBD」「後で実装」「適切なエラーハンドリングを追加」等の記述なし。各Stepのコードはコピペで動く完全な内容
- **Type consistency:** `AtlasSpellWait` の props（`variant`/`label`/`active`）と `AtlasWaitCompanion` の props（`active`）は Task 2/3 で定義した型のまま Task 4-6 の呼び出し側で一致させた。`MekurinDef`/`MEKURIN`/`paintMekurinFrame` の名称も Task 1→3 で一致
