# 筐体UI サイズ圧縮・ディテール強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DS筐体UI（`AtlasConsoleShell`）とその中身（`AtlasWorldMap`・`StatusCommandPanel`・`TerminalPanel`表示領域）を、13インチデスクトップの標準ビューポート（実寸1440×750想定）に収まるサイズへ圧縮し、同時に筐体自体のディテール（立体感・質感）を強化する。

**Architecture:** 3層の変更を独立して積む。①`AtlasWorldMap`のアスペクト比固定を撤去してコンテナ高さに追従させる、②`StatusCommandPanel`の情報量を削り上画面が340px（グロー枠込み）に収まるようにする、③`AtlasConsoleShell`のCSSを筐体の見た目強化＋高さ指定（上340px/下303px）に全面更新し、`TerminalPanel`の既定の高さ（`h-[60vh] min-h-[420px]`）をCSS属性セレクタで上書きする。

**Tech Stack:** Next.js 16 (App Router), React, Tailwind CSS (JIT arbitrary values), Canvas 2D API（`AtlasWorldMap`の地形描画）

## Global Constraints

- 実寸 1440×750 ビューポート想定で、筐体全体が **749px以内**（ヘッダー余白40px＋筐体padding32px＋上画面348px＋ヒンジ26px＋下画面303px）に収まること
- 上画面（グロー枠込み）の目標高さ: **340px**。グロー枠の`padding`が上下各4px（`atlas-living.css`の`.atlas-console-glow`定義通り）なので、中身（`topScreenContent`）の使える高さは **332px**
- 下画面（グロー枠込み）の目標高さ: **303px**。同様に中身の使える高さは **295px**
- `TerminalPanel`（`src/components/terminal-panel.tsx`）自体は無改造。高さの上書きは`AtlasConsoleShell`側のCSSでのみ行う。他の呼び出し元（`src/components/gate-terminal-section.tsx`、`AtlasAssist`の`AtlasConsoleShell`外での利用）は影響を受けないこと
- マップ側の「いまの一手」CTA（`primaryCta`のUI、`atlas-dashboard.tsx`内 `topScreenContent`の`mt-auto border-t-2...`ブロック）は上画面から削除する（koki確認済み。デイリークエストと内容が重複するため）
- デイリークエストの表示件数は4件から**2件**に絞る（3件目以降は非表示、別動線は設けない）
- コミットは通常のフローで進めてよい（各タスク完了時にcommitする）
- テストランナーは Node.js 組み込み `node:test`（`npm test`）。UIコンポーネントの自動テストの慣習はこのプロジェクトに存在しない（ブラウザ実機確認が正）
- 既存の演出ロジック（SSEイベント購読、`pulse`/`banner`/`bounceIcon`、`clearedGateId`によるquestピン変化）は無変更

---

## Task 1: `AtlasWorldMap` のアスペクト比をコンテナ追従に変更する

**Files:**
- Modify: `src/components/living-atlas/atlas-world-map.tsx`

**Interfaces:**
- Consumes: なし
- Produces: `AtlasWorldMap`の外枠`div`から`aspect-[16/11]`を撤去し、代わりに`h-full`で親コンテナの高さに追従する（Props・戻り値の型は無変更、`MapMarker`型・コンポーネントの呼び出しシグネチャに影響なし）

**Note:** `AtlasWorldMap`は現在 `<canvas width={320} height={220} ...>` に固定解像度で地形を描画し、外側の`div`が`aspect-[16/11]`でCanvas全体を表示比率に収めている（`atlas-world-map.tsx:278-286`）。内部のタイル座標系（`W=40`, `H=27`のグリッド、`TW = canvas.width / W`, `TH = canvas.height / H`）は Canvas の `width`/`height` 属性から比率を自動導出しているため、**Canvas の `width`/`height` 属性だけを新しい比率に変更すれば、`fillBlob`等のタイル描画ロジックは無改造で新しい比率に追従する**（テキスト量を減らすため、`fillBlob`等の座標値そのものは変更しない）。

- [ ] **Step 1: Canvas解像度と外枠のaspect比を変更する**

`src/components/living-atlas/atlas-world-map.tsx:277-286` の現在のコード:

```tsx
  return (
    <div className="relative w-full overflow-hidden border-4 border-black aspect-[16/11] bg-[#0d2f70] shadow-[inset_0_0_0_3px_#4a7fd4]">
      <canvas
        ref={ref}
        width={320}
        height={220}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
        aria-hidden
      />
```

次のように変更する（外枠の `aspect-[16/11]` を `h-full` に置き換え、Canvas の `height` を `160` に変更 — `width` は据え置き、比率は 320:160 = 2:1 の横長になる）:

```tsx
  return (
    <div className="relative h-full w-full overflow-hidden border-4 border-black bg-[#0d2f70] shadow-[inset_0_0_0_3px_#4a7fd4]">
      <canvas
        ref={ref}
        width={320}
        height={160}
        className="block h-full w-full"
        style={{ imageRendering: "pixelated" }}
        aria-hidden
      />
```

- [ ] **Step 2: 呼び出し元のコンテナに高さを与える**

`AtlasWorldMap`が`h-full`で追従するには、親コンテナ（`.atlas-worldmap-frame`）に明示的な高さが必要になる。これは Task 3 で上画面のレイアウト全体を再構成する際に一緒に設定するため、このタスクでは`atlas-world-map.tsx`の変更のみ行い、コンテナ側の高さ指定は Task 3 に委ねる。

- [ ] **Step 3: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし（既知の無関係エラー `src/lib/textbook-chapter-polish.ts:186` のみ残る）

- [ ] **Step 4: 既存テストを実行**

Run: `npm test`
Expected: 全件 PASS（`AtlasWorldMap`に対する既存の直接テストはないため、既存件数のまま）

- [ ] **Step 5: Commit**

```bash
git add src/components/living-atlas/atlas-world-map.tsx
git commit -m "AtlasWorldMapのアスペクト比固定を撤去し、コンテナ高さに追従させる。"
```

---

## Task 2: `StatusCommandPanel` を圧縮し、「いまの一手」CTA を上画面から削除する

**Files:**
- Modify: `src/components/living-atlas/atlas-dashboard.tsx`

**Interfaces:**
- Consumes: なし（既存コンポーネントの内部調整のみ）
- Produces: なし（`StatusCommandPanel`・`AtlasDashboard`のシグネチャは無変更）

- [ ] **Step 1: デイリークエストの表示件数を2件に絞る**

`src/components/living-atlas/atlas-dashboard.tsx:256`（`{todos.map((t) => ...)}`）を次のように変更する:

変更前:
```tsx
                {todos.map((t) =>
```

変更後:
```tsx
                {todos.slice(0, 2).map((t) =>
```

- [ ] **Step 2: デイリークエスト項目のフォントサイズ・余白を圧縮する**

`src/components/living-atlas/atlas-dashboard.tsx:255-296` のリスト項目内、以下の3箇所のクラスを変更する（テキストサイズを1段階小さく、パディングを縮小）:

`atlas-dashboard.tsx:261`（リンク行のクラス）変更前:
```tsx
                        className="flex items-center gap-2.5 border-2 border-[#002070] bg-white/[0.04] px-2 py-2 no-underline transition-colors hover:border-[#f0d25a]"
```
変更後:
```tsx
                        className="flex items-center gap-2 border-2 border-[#002070] bg-white/[0.04] px-1.5 py-1.5 no-underline transition-colors hover:border-[#f0d25a]"
```

`atlas-dashboard.tsx:270`（タイトルテキスト）変更前:
```tsx
                          <span className="block truncate text-[13px] text-[#f7f3d9]">
```
変更後:
```tsx
                          <span className="block truncate text-[11px] text-[#f7f3d9]">
```

`atlas-dashboard.tsx:273`（メタテキスト）変更前:
```tsx
                          <span className="mt-0.5 block truncate text-[11px] text-[#c9c3a0]">
```
変更後:
```tsx
                          <span className="mt-0.5 block truncate text-[9px] text-[#c9c3a0]">
```

- [ ] **Step 3: 「いまの一手」CTA ブロックを上画面から削除する**

`src/components/living-atlas/atlas-dashboard.tsx:518-535` の以下のブロックを丸ごと削除する:

```tsx
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
```

削除後、`primaryCta` 変数（`atlas-dashboard.tsx:465-474`で定義）はこの `topScreenContent` 内では未使用になる。`resolveHomeCta` の呼び出し自体と `primaryCta` 変数定義は削除しない（他の用途がないか確認するため、次のステップで確認する）。

- [ ] **Step 4: `primaryCta` が他で使われていないか確認する**

Run: `grep -n "primaryCta" src/components/living-atlas/atlas-dashboard.tsx`
Expected: `const primaryCta = resolveHomeCta({...})` の定義行のみ残り、参照箇所がなくなっているはず。もし本当に未使用なら、`primaryCta` 変数の定義と `resolveHomeCta` の呼び出し、および今後使われなくなる `Link`/`resolveHomeCta` の import があれば、それも削除する（未使用変数として `tsc`/lint が警告するため）。`resolveHomeCta` の呼び出しには副作用がないことを `src/lib/home-cta.ts` で確認してから削除すること。

- [ ] **Step 5: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラー・新規未使用変数警告なし

- [ ] **Step 6: 既存テストを実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/living-atlas/atlas-dashboard.tsx
git commit -m "StatusCommandPanelを圧縮し、上画面から「いまの一手」CTAを削除する。"
```

---

## Task 3: `AtlasConsoleShell` の見た目強化とサイズ指定

**Files:**
- Modify: `src/app/atlas-living.css`
- Modify: `src/components/living-atlas/atlas-console-shell.tsx`
- Modify: `src/components/living-atlas/atlas-dashboard.tsx`（`topScreenContent` に高さクラスを追加）

**Interfaces:**
- Consumes: `AtlasWorldMap`（Task 1 で `h-full` 追従に変更済み）
- Produces: なし（`AtlasConsoleShell`の`{topScreen, bottomScreen, pulse}` propsシグネチャは無変更）

koki 承認済みビジュアル（visual companion、`full-compression-v2.html` 相当）: ブランドプレート「Living Atlas」の刻印、スピーカーグリル風ドットパターン、多層グラデーションの筐体表面、金属シリンダー風ヒンジ、inset ハイライト/シャドウで凹凸感のある十字キー・ABXYボタン。上画面340px・下画面303px（いずれもグロー枠込み）。

- [ ] **Step 1: `atlas-living.css` の既存 `.atlas-console-*` ルールを置き換える**

`src/app/atlas-living.css` の既存の以下のルール群（`.atlas-console-shell` から `.atlas-console-abxy span` まで）を、次の内容に**全置換**する。**注意**: この範囲の途中（`.atlas-console-glow--offline` の直後）に、DS筐体とは無関係な既存ルール `.atlas-exp-fill { transition: width 0.6s ease; }`（EXPバーのアニメーション用、PR #1 で追加済み）が挟まっている。誤って消さないよう、下記の置き換え後CSSブロックにも `.atlas-exp-fill` をそのまま含めてある（`.atlas-console-glow--offline` の直後）。`@media (prefers-reduced-motion: reduce)` 内の `.atlas-console-glow, .atlas-exp-fill { transition: none; }` は範囲外なので変更しない。

まず現状を確認する:

Run: `grep -n "^\.atlas-console-\|^\.atlas-exp-fill" src/app/atlas-living.css`

表示された行番号の範囲（`.atlas-console-shell {` から `.atlas-console-abxy span {...}` の閉じ `}` まで）を、次のブロックで置き換える:

```css
.atlas-console-shell {
  padding: 17px 20px 15px;
  border-radius: 22px;
  background:
    radial-gradient(ellipse 130% 80% at 20% -15%, rgba(255, 255, 255, 0.14), transparent 50%),
    linear-gradient(
      160deg,
      #52555f 0%,
      #3a3c44 25%,
      #26272c 55%,
      #16171a 85%,
      #0c0d0f 100%
    );
  box-shadow:
    0 24px 50px rgba(0, 0, 0, 0.55),
    0 6px 12px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 -6px 14px rgba(0, 0, 0, 0.5);
  position: relative;
}

.atlas-console-shell::before {
  content: "";
  position: absolute;
  left: 6%;
  right: 6%;
  bottom: -14px;
  height: 20px;
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.35), transparent 70%);
  filter: blur(3px);
  z-index: -1;
}

.atlas-console-brand {
  position: absolute;
  top: 6px;
  right: 20px;
  font-size: 9px;
  letter-spacing: 2.5px;
  color: rgba(210, 212, 220, 0.4);
  font-weight: 700;
  text-transform: uppercase;
}

.atlas-console-speaker {
  position: absolute;
  top: 9px;
  left: 18px;
  width: 30px;
  height: 9px;
  background-image: radial-gradient(circle, rgba(0, 0, 0, 0.6) 0.8px, transparent 0.8px);
  background-size: 4px 4px;
  opacity: 0.85;
}

.atlas-console-glow {
  border-radius: 7px;
  padding: 4px;
  background: linear-gradient(150deg, #08090a 0%, #000 60%, #08090a 100%);
  box-shadow:
    inset 0 0 0 1.5px rgba(240, 210, 90, 0.35),
    inset 0 0 14px rgba(240, 210, 90, 0.14),
    inset 0 2px 4px rgba(0, 0, 0, 0.8);
  position: relative;
  overflow: hidden;
  transition: box-shadow 0.25s ease;
}

.atlas-console-glow::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    122deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.03) 18%,
    transparent 32%,
    transparent 68%,
    rgba(255, 255, 255, 0.05) 100%
  );
  pointer-events: none;
}

.atlas-console-glow--pulse {
  box-shadow:
    inset 0 0 0 2px rgba(240, 210, 90, 0.9),
    0 0 28px rgba(240, 210, 90, 0.55);
}

.atlas-console-glow--offline {
  background: linear-gradient(160deg, #1a1a1c, #050505);
  box-shadow:
    inset 0 0 0 2px rgba(140, 140, 140, 0.25),
    0 0 0 rgba(0, 0, 0, 0);
}

.atlas-exp-fill {
  transition: width 0.6s ease;
}

.atlas-console-top-screen {
  height: 340px;
}

.atlas-console-hinge {
  height: 12px;
  margin: 7px auto;
  width: 90%;
  border-radius: 6px;
  background: linear-gradient(
    180deg,
    #24262b 0%,
    #0a0a0c 45%,
    #24262b 55%,
    #050506 100%
  );
  position: relative;
  box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.8);
}

.atlas-console-hinge::before,
.atlas-console-hinge::after {
  content: "";
  position: absolute;
  top: 1.5px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #9a9ea8 0%, #55585f 45%, #0e0f11 100%);
}

.atlas-console-hinge::before {
  left: -4.5px;
}

.atlas-console-hinge::after {
  right: -4.5px;
}

.atlas-console-lower-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
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

.atlas-console-lower-screen [class*="min-h-[420px]"] {
  height: 295px;
  min-height: 295px;
}

.atlas-console-dpad {
  width: 36px;
  height: 36px;
  position: relative;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.7));
}

.atlas-console-dpad::before,
.atlas-console-dpad::after {
  content: "";
  position: absolute;
  background: linear-gradient(160deg, #7a7e88 0%, #45474f 45%, #1c1d21 100%);
  border-radius: 3px;
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.25),
    inset 0 -2px 3px rgba(0, 0, 0, 0.6);
}

.atlas-console-dpad::before {
  width: 36px;
  height: 12px;
  top: 12px;
  left: 0;
}

.atlas-console-dpad::after {
  width: 12px;
  height: 36px;
  top: 0;
  left: 12px;
}

.atlas-console-abxy {
  display: grid;
  grid-template-columns: repeat(2, 17px);
  grid-template-rows: repeat(2, 17px);
  gap: 4px;
}

.atlas-console-abxy span {
  border-radius: 50%;
  background: radial-gradient(
    circle at 32% 26%,
    #9a9ea8 0%,
    #6a6e78 30%,
    #3a3c42 65%,
    #17181b 100%
  );
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.35),
    inset 0 -2px 3px rgba(0, 0, 0, 0.4);
}
```

`@media (prefers-reduced-motion: reduce)` ブロック内の `.atlas-console-glow, .atlas-exp-fill { transition: none; }` はそのまま残す（変更不要）。

- [ ] **Step 2: `AtlasConsoleShell` に筐体装飾要素とクラスを追加する**

`src/components/living-atlas/atlas-console-shell.tsx` の現在の内容:

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

  return (
    <div className="atlas-console-shell">
      <div className={glowClass}>{topScreen}</div>
      <div className="atlas-console-hinge" aria-hidden />
      <div className="atlas-console-lower-row">
        <div className="atlas-console-side-pad" aria-hidden>
          <div className="atlas-console-dpad" />
        </div>
        <div className="atlas-console-lower-screen">
          <div className={glowClass}>{bottomScreen}</div>
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

次のように変更する（`atlas-console-brand`・`atlas-console-speaker` の装飾要素を追加し、上画面のグロー要素に `atlas-console-top-screen` クラスを足して高さ340pxを与える）:

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
  const topGlowClass = `${glowClass} atlas-console-top-screen`;

  return (
    <div className="atlas-console-shell">
      <div className="atlas-console-brand">Living Atlas</div>
      <div className="atlas-console-speaker" aria-hidden />
      <div className={topGlowClass}>{topScreen}</div>
      <div className="atlas-console-hinge" aria-hidden />
      <div className="atlas-console-lower-row">
        <div className="atlas-console-side-pad" aria-hidden>
          <div className="atlas-console-dpad" />
        </div>
        <div className="atlas-console-lower-screen">
          <div className={glowClass}>{bottomScreen}</div>
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

- [ ] **Step 3: 上画面コンテンツが新しい高さいっぱいに広がるようにする**

`.atlas-console-top-screen` は `height: 340px` を持つが、`padding: 4px`（`.atlas-console-glow`）を差し引いた中身の高さは332pxになる。中の `topScreenContent`（`atlas-dashboard.tsx:492` の `grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]`）がこの高さいっぱいに広がるよう、`atlas-dashboard.tsx:492` を次のように変更する:

変更前:
```tsx
  const topScreenContent = (
    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
```

変更後:
```tsx
  const topScreenContent = (
    <div className="grid h-full grid-cols-1 items-stretch gap-3 md:grid-cols-[1.6fr_0.9fr]">
```

マップ側の `AtlasReveal as="section"`（`atlas-dashboard.tsx:494`）と `StatusCommandPanel`（`atlas-dashboard.tsx:538`、既に `h-full` を持つ）は、この grid の中で `items-stretch` により自動的に高さいっぱいに引き伸ばされる。`atlas-worldmap-frame`（`atlas-dashboard.tsx:504`）に高さクラス `flex-1 min-h-0` を追加し、`AtlasWorldMap` の `h-full` が正しく効くようにする:

`atlas-dashboard.tsx:494-511` の `AtlasReveal` セクションを次のように変更する（`flex-1 min-h-0` を `atlas-worldmap-frame` の div に追加）:

変更前:
```tsx
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
      </AtlasReveal>
```

変更後:
```tsx
      <AtlasReveal as="section" className="dq-win flex h-full min-h-0 flex-col gap-2 p-3">
        <AtlasPageTitle
          title="ちず"
          sub={
            pendingGate
              ? `！＝いまのしれん（未クリア ${pendingGateCount ?? 1} 件）`
              : "領＝学びの系統じゃ"
          }
          surface="map"
        />
        <div className="atlas-worldmap-frame min-h-0 flex-1">
          <AtlasWorldMap
            markers={mapMarkers}
            activeId={activeId}
            onSelect={setActiveId}
            regionBrightness={regionBrightness}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#c9c3a0]">
          <span className="text-[#f0d25a]">！＝未クリアのしれん</span>
          <span>自キャラ＝いま</span>
          <span>領＝学びの系統</span>
        </div>
      </AtlasReveal>
```

（`p-3.5`→`p-3`、`gap-3`→`gap-2`、凡例行の`text-[11px]`→`text-[9px]`・`gap-y-1.5`→`gap-y-1` は、Task 2 で「いまの一手」を削除した後も332pxの高さ制約に収まるようにするための圧縮。`min-h-0`は`flex`子要素がコンテンツの自然サイズで溢れず縮小できるようにするCSSの定石）

- [ ] **Step 4: 型チェックを実行**

Run: `npx tsc --noEmit -p .`
Expected: 新規エラーなし

- [ ] **Step 5: 既存テストを実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 6: dev server の生死を確認し、ブラウザで実際の高さを計測する**

Run: `lsof -nP -iTCP:3100 -sTCP:LISTEN`
生きていなければ `npm run dev -- -p 3100` で起動する（`npm run dev:all` はターミナルWS(3101)も起動するが、この計測にはWeb側のみで十分）。

ブラウザでトップページ（`http://localhost:3100/`）をウィンドウ幅1440pxで開き、`cmd+shift+r`でハードリロードしたのち、以下を devtools コンソール等で実行して実測する:

```js
JSON.stringify({
  shellHeight: document.querySelector('.atlas-console-shell')?.getBoundingClientRect().height,
  topGlowHeight: document.querySelector('.atlas-console-top-screen')?.getBoundingClientRect().height,
  hingeHeight: document.querySelector('.atlas-console-hinge')?.getBoundingClientRect().height,
  lowerRowHeight: document.querySelector('.atlas-console-lower-row')?.getBoundingClientRect().height,
}, null, 2)
```

Expected: `shellHeight` がおよそ 700px 以内（`topGlowHeight` ≒340px、`hingeHeight` ≒26px、`lowerRowHeight` ≒303px の合計 + padding分）。

`topGlowHeight` が 340px を大幅に超えている場合（中身が `min-h-0` を無視して自然サイズのまま溢れている状態）、次の順で1つずつ適用し、再計測しながら340pxに近づける（すべて `atlas-dashboard.tsx` 内、Step 3 で変更した `AtlasReveal` セクション）:

1. 凡例行（`！＝未クリアのしれん` 等）のクラスを `text-[9px]` から更に `text-[8px]` に、`gap-y-1` を `gap-y-0.5` に変更する
2. `AtlasPageTitle` を包む `.mb-3`（`atlas-page-title.tsx:24` の `<div className="mb-3 flex items-baseline...">`）を `.mb-1` に変更する（このファイルは `AtlasPageTitle` 自身の実装であり、DS筐体外の他ページ表示にも影響するため、変更前に `grep -rn "AtlasPageTitle" src/app` で他の呼び出し元を確認し、影響が許容範囲か判断すること）
3. それでも収まらない場合は凡例行（`flex flex-wrap items-center gap-x-3...` のブロック）自体を削除する

`StatusCommandPanel` 側が溢れている場合は、Task 2 Step 2 で圧縮したデイリークエスト項目の `py-1.5` を `py-1` に、`gap-2.5`（`atlas-dashboard.tsx` の `flex items-center gap-2.5` ステータス一覧部分）を `gap-1.5` に、それぞれ1段階ずつ縮小して再計測する。

- [ ] **Step 7: Commit**

```bash
git add src/app/atlas-living.css src/components/living-atlas/atlas-console-shell.tsx src/components/living-atlas/atlas-dashboard.tsx
git commit -m "AtlasConsoleShellの見た目を強化し、13インチビューポートに収まるサイズへ圧縮する。"
```

---

## Task 4: ブラウザ実機での最終確認

**Files:** なし（確認・微調整のみ。Task 3 の調整で収まらなかった場合はここで追加調整し、変更があれば追加commitする）

**Interfaces:**
- Consumes: Task 1〜3 の全成果物
- Produces: なし

- [ ] **Step 1: dev server の生死を確認**

Run: `lsof -nP -iTCP:3100 -sTCP:LISTEN && lsof -nP -iTCP:3101 -sTCP:LISTEN`
Expected: 両方生存。生きていなければ `npm run dev:all` で起動

- [ ] **Step 2: 実際の見た目を1440×800ウィンドウで確認**

ブラウザウィンドウを1440×800にリサイズし、`http://localhost:3100/`をハードリロードして開く。以下を目視確認する:
- 筐体全体（上画面・ヒンジ・下画面）がスクロールなしでウィンドウ内に収まっているか
- ブランドプレート「Living Atlas」、スピーカーグリル風ドット、立体的な十字キー/ABXYボタン、金属質のヒンジが視認できるか
- マップの地形（タイル）が横長になっても大きく歪んで見えないか（Task 1 の Canvas 解像度変更の影響を確認）
- デイリークエストが2件のみ表示され、「いまの一手」ブロックが上画面から消えていることを確認
- ステータスパネル（Lv./EXP、ステータス一覧、デイリークエスト2件）が上画面内に収まり、はみ出ていないこと

- [ ] **Step 3: ターミナルの表示・操作を確認**

下画面のターミナルが295px程度の高さで表示され、既存の「じゅもんをとなえる」開閉・「拡大」ボタンによるフルスクリーン切り替えが問題なく動作することを確認する（Task 4以前のPR #1で修正済みの「offline glow の filter がフルスクリーンを壊す」問題が再発していないか、SSE接続状態が offline のときに一度フルスクリーンボタンを押して確認する）。

- [ ] **Step 4: 他の呼び出し元でTerminalPanelの高さが変わっていないことを確認**

`http://localhost:3100/gates/<任意の未クリアgateId>` を開き、しれん画面のターミナル（`gate-terminal-section.tsx`経由、`AtlasConsoleShell`の外）が従来通り `h-[60vh] min-h-[420px]` の高さで表示されていることを確認する（`.atlas-console-lower-screen [class*="min-h-[420px]"]` のCSSはこのページには存在しないため、影響を受けないはず）。

- [ ] **Step 5: 気になる点があれば調整し、最終commit**

Step 2〜4で見つかった見た目の問題（余白の詰まりすぎ、要素の潰れ等）があれば、`atlas-living.css` / `atlas-dashboard.tsx` / `atlas-console-shell.tsx` を微調整する。変更した場合は以下でcommitする:

```bash
git add -u
git commit -m "筐体UI実機確認での微調整を反映する。"
```

変更がなければこのタスクはcommitなしで完了する。
