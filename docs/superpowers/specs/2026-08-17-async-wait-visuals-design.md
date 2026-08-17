---
type: design
status: draft
date: 2026-08-17
tags: [living-atlas, ui, loading-state, async-wait]
source_refs:
  [
    src/components/terminal-panel.tsx,
    src/components/living-atlas/atlas-battle.tsx,
    src/components/living-atlas/atlas-route-loading-provider.tsx,
    src/components/living-atlas/atlas-lumina.ts,
    src/app/atlas-living.css,
    docs/mcp-setup.md,
  ]
---

# AI回答待ち（じゅもん詠唱中）演出 設計

## 改訂履歴

- 2026-08-17: Obsidian起票済み human_task「AI回答待ち（じゅもん実行中・埋め込みターミナル等）の演出設計」（2026-08-14起票）を受け、`superpowers:brainstorming`（architectural）で着手。Fableへ2ラウンドの独立コンセプト立案を依頼（1ラウンド目: ビジュアル方向性3案、2ラウンド目: 案2のキャラクター再検討）し、koki実機確認（Artifactモックアップ）を経て確定

## 背景・問題

Living Atlas には「AIの応答を待つ」瞬間が3か所に散らばっているが、専用の演出が無い:

1. 埋め込みターミナル（`terminal-panel.tsx`）で CLI が応答を生成している間
2. しれん（`atlas-battle.tsx`）の採点結果（verdict）ポーリング待ち（最長2分、3秒×最大40回）
3. 週のしょ・にっき等のバックグラウンド生成待ち

ページ遷移時のロードUI（`AtlasRouteLoading`、地形帯 repeat-x ループ16s + キャラ歩行 steps(9)）は既にあるが、koki 本人の指定で「今回はそれとは別の新しい表現」を求められている（2026-08-14 に一度この演出テーマが Issue #2 サブタスク2の協議中に提起され、スコープが異なるため別タスクとして分離した経緯あり）。

## 検討した案と却下理由

Fable へ2ラウンドの独立コンセプト立案を依頼した。

**1ラウンド目（ビジュアル方向性）**

| 案 | 概要 | 判定 |
|---|---|---|
| 案1「ふっかつのじゅもん」 | じゅもんが一文字ずつ書き記されていく。生成の実体（LLMのトークン生成）と同型の演出 | **採用**（共通基盤） |
| 案2「(相棒キャラ)の祈り」 | 相棒キャラが浮遊しながら金のオーラ・足元のルーン輪・立ち上る光の粒をまとって儀式をしている | **採用**（大きい待ち限定の加飾） |
| 案3「旅の扉」 | 同心のドット矩形リングが中心へ吸い込まれる。3案中もっとも実装が軽い | 不採用。「上等なスピナー」に近く、AIが何をしているかとの意味的な結びつきが他2案より弱い |

案1のイチオシ理由: LLMは実際に1トークンずつ生成しており、かなが一文字ずつ刻まれる絵は待ちの実体そのもの。最長2分のポーリングでも「進んでいるフリ」が嘘にならない。テキストベースなのでターミナル横の1行チップ〜戦闘のナレーター窓〜インラインカードまで同一コンポーネントのサイズ違いで成立し、3シーンへのスケーラビリティが構造的に最良。新規アセットも不要で実装コストが最小。

**2ラウンド目（案2のキャラクター）**

初回ラウンドでは仮に既存キャラ「ルミナ」（`atlas-lumina.ts`、ナビ姫。別役割で既存使用中）を当てて実装検証したが、koki により不採用と判定された（周辺演出＝オーラ・ルーン輪・光の粒・浮遊構造自体は良いという評価は変わらず）。この演出専用のオリジナル新キャラを再度Fableへ依頼し、3案（めくりん＝本の使い魔／トモシ＝ともしびの精霊／ホウホウ＝しらせふくろう）を得た。Artifact モックアップで実機比較の上、**めくりん**を採用。

理由（Fableの推奨、koki承認）:

1. プロダクトの語彙そのもの（ぼうけんのしょ・週のしょ・ずかん・書庫・にっきと、日々触れるものが全て「本」）
2. 待機の意味と絵が一致する唯一の案（フレームAで空白だった行にフレームBでインク線が現れる＝「AIがいま書いている」を2フレームのループだけで正直に表現できる）
3. 3シーンへの汎用性（しれん採点＝「採点のじゅもんを書き取っている審判の書」、週のしょ生成＝「まさにその『しょ』が編まれている」、ターミナル＝「CLIの出力を書き写している」と、同じキャラが3シーンで別の意味を自然に背負える）

トモシ（視認性・実装コストで最強）・ホウホウ（配達メタファーで verdict 待ち単独になら最適）は次点。今回はコードに残さない。

## スコープ

### 対象（本設計）

- `AtlasSpellWait` 共有コンポーネント（案1、テキストタイピング演出。3シーン共通）
- `AtlasWaitCompanion` コンポーネント（案2、めくりん＋オーラ＋ルーン輪＋光の粒。しれん採点限定）
- 3シーンへの配線（ターミナル・しれん採点・週のしょ等バックグラウンド生成）
- めくりんのドット絵データ（`atlas-lumina.ts` と同形式）の正式収録

### 対象外（別トラック）

- ターミナルの「AI応答生成中」を厳密検知する仕組み（PTY出力ストリームの意味解析等）。出力アクティビティの緩い判定で代替する
- めくりん以外の新キャラ（トモシ・ホウホウ）の実装。Artifact検討のみで終了、コードには残さない
- ページ遷移ロードUI（`AtlasRouteLoading`）自体の変更
- 週のしょ等バックグラウンド生成への `AtlasWaitCompanion` 追加（生成は数秒〜十数秒程度で「大きい待ち」ほどではないため、過剰実装を避けて`AtlasSpellWait`単体に留める）

## コンポーネント設計

### `AtlasSpellWait`（案1: じゅもんタイピング演出）

```tsx
// src/components/living-atlas/atlas-spell-wait.tsx
type Props = {
  variant: "inline" | "panel";
  label: string; // 例: "じゅもんを かきとめている……"
  active: boolean; // false の間はレンダリングしない（呼び出し元が isWaiting 相当を渡す）
};
```

- 内部状態: 固定のダミーかな列（複数候補を持ち、マウント時にランダム選択。例:「ふるいけや　かはずとびこむ　みずのおと」等）を `setInterval`（140ms間隔）で1文字ずつ追加。末尾1文字だけ金→白→クリームにフラッシュ。右端に DQ 伝統の「▼」を `steps(1)` で点滅させ、そのままカーソルとして機能させる
- 実際のLLM出力内容とは連動させない（内容に意味を持たせる必要はなく、あくまで「書かれている」という演出のみ。実出力を流用すると個人情報・機密混入のリスクもある）
- `variant="inline"`: 高さ1行のミニチップ（ターミナル用）
- `variant="panel"`: `dq-win` 相当のカード（しれん採点のナレーター窓・週のしょ生成カード用）
- `prefers-reduced-motion` 時はタイピングループを止め、かな列を静的に表示する（`AtlasRouteLoading` と同じ規約）
- `role="status"` `aria-live="polite"`

### `AtlasWaitCompanion`（案2: めくりん）

```tsx
// src/components/living-atlas/atlas-wait-companion.tsx
type Props = {
  active: boolean;
};
```

- `atlas-lumina.ts` と同形式（`pack` / `assertFrame` / `paintXFrame`）で新規ファイル `src/components/living-atlas/atlas-mekurin.ts` を作る。以下のドット絵データを正式収録する（Fable立案、桁数・パレット文字を検証済み）:

```ts
/**
 * めくりん（魔導書の使い魔）ドット絵（20×16・2フレーム）。
 * AI回答待ち演出「案2」専用キャラ。ルミナ（atlas-lumina.ts）とは別役割。
 *
 * パレット: 8 outline, w ページ(cream), m インク線(cream-dim),
 * a 表紙(navy系), g しおり(gold), d しおり先端(gold-dark),
 * e 目のハイライト(white), c 星屑(star)
 */
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
```

  > 上記データは行数・桁数・パレット文字の整合性を Node スクリプトで機械検証済み（20列×16行、全行OK）。実装コミット時は `atlas-lumina.ts` と同じ `assertFrame` をモジュール読み込み時に自走させ、正典をソースファイル側に置く。

- 表示: `dq-bob` 相当の `steps(2)` 浮遊、金のオーラ（`radial-gradient` + `scale` パルス 2.8s）、足元のルーン輪（`border-dashed` 円、`steps(8)` 回転）、立ち上る光の粒（3〜5個、stagger）。2.6秒おきにFRAME_Bへ160ms切り替えて瞬き
- `AtlasSpellWait` の**横に**配置する（置き換えではない）。「めくりんが書いている」というじゅもんタイピング演出との意味的な二重化を狙う

## 3シーンへの配線

### 1. 埋め込みターミナル（`terminal-panel.tsx`）

- ステータス行（`STATE_LABEL` 表示の隣）に `AtlasSpellWait variant="inline"` を追加。xterm の出力自体は隠さない
- トリガー: `ws.onmessage` の `case "output":` で `lastOutputAtRef.current = Date.now()` を更新。300ms間隔の軽量ポーリング（または `setTimeout` の再帰予約）で `Date.now() - lastOutputAtRef.current < 1500` の間だけ `active=true`。PTYストリームの意味解析はしない（対象外）
- `connState !== "ready"` の間は非表示（接続中・エラー時にじゅもん演出を出すと誤解を招く）

### 2. しれん採点（`atlas-battle.tsx`、待機フェーズ 551-585, 852行付近）

- 既存の「採点中…」ステータス表示を `AtlasSpellWait variant="panel"` + `AtlasWaitCompanion` の横並びに置き換える
- `active` は既存のポーリング中フラグ（verdict未確定の間）にそのまま連動

### 3. にっき画面のバックグラウンド生成（`atlas-nikki-retro.tsx` の `NikkiBulkPanel`）

- 「未作成の日をまとめて教科書化」パネルの `pending`（`useTransition`）中に出る「教科書にしている…」ボタン表示の隣に `AtlasSpellWait variant="inline"` を配置
- 週のしょの `/retro` 訪問時 lazy フォールバック（`ensureRecentWeeklyTextbooks`）はサーバーコンポーネントのレンダリング前処理であり、既存のページ遷移ロードUI（`loading.tsx` / `AtlasRouteLoading`）の守備範囲に既に含まれる。クライアント側の待機状態を持たないため今回の対象外とする
- `AtlasWaitCompanion` は付けない（過剰実装回避）

## アクセシビリティ

- `AtlasSpellWait` / `AtlasWaitCompanion` ともに `role="status"` + `aria-live="polite"`（`AtlasRouteLoading` と同じ規約）
- `prefers-reduced-motion: reduce` 時は両コンポーネントとも静止フレームに切替（タイピングループ停止、めくりんは瞬きなしFRAME_A固定、粒・オーラのアニメーションも停止）

## 実装時の注意点

1. **かな列に実データを流用しない**: LLM出力の一部を流用すると機密混入・処理コストの懸念があるため、固定のダミー列のみを使う（意味を持たせない）
2. **ターミナルのアクティビティ判定は緩い判定でよい**: 対象外セクションの通り、PTY出力の意味解析はしない。誤検知（実際は止まっているのに演出だけ続く/その逆）は許容範囲とし、体感の改善を目的にする
3. **`AtlasWaitCompanion` はしれん採点専用**: 週のしょ等への拡張は本設計のスコープ外。将来必要になれば `active` props だけの薄いラッパーなので追加コストは小さい
4. **`atlas-mekurin.ts` は `atlas-lumina.ts` と同じ検証パターンに揃える**: `assertFrame` で行数・桁数を機械チェックしてから export する（Fable提案データは検証済みだが、実装コミット時に改めて通すこと）

## テスト方針

- `atlas-mekurin.ts` の `assertFrame` はモジュール読み込み時に自走する（`atlas-lumina.ts` と同じパターン）。追加のユニットテストは不要
- `AtlasSpellWait` のかな進行ロジック（何ms後に何文字目まで進むか）が純関数として切り出せる場合は `node:test` でユニットテスト化する。切り出しが不自然なら省略しコンポーネントの実機確認に委ねる
- 3シーンとも実機ブラウザで `active` の on/off・`prefers-reduced-motion` on/off の組み合わせを確認する
