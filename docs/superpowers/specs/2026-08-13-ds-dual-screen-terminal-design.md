---
type: design
status: approved
date: 2026-08-13
tags: [living-atlas, ui, mcp, realtime]
source_refs:
  [
    docs/adr/0018-reachable-mcp-cloud.md,
    docs/adr/0019-core-loop-phases.md,
    .claude/progress/living-atlas-ui-handoff.md,
  ]
---

# DS風二画面ターミナル連動UI 設計

## 背景・目的

Living Atlas のトップページには既に「ちず/ステータス（上段）」と「じゅもんターミナル（`AtlasAssist`、下段・開閉トグル式）」が存在する。この2つを Nintendo DS 風の常設二画面レイアウトに統合し、ターミナル内で Claude/Codex が MCP ツールを呼ぶたびに上画面がリアルタイムに反応する体験を作る。

koki 確定の狙い（2026-08-13 brainstorming セッションより）: **実用性（今何が起きているかの可視化）とエンタメ性（DS を操作しているような没入感）を両方高品質に実現する**。どちらかを優先して他方を犠牲にしない。

## スコープ

### MVP（本設計の対象）

- 配置: トップページ（`src/app/(app)/page.tsx` → `AtlasDashboard`）に常設
- 反応対象の MCP ツール3種（正式名、2026-08-13 実装調査で訂正済み）: `answer_gate`（しれん回答） / `save_task_mappings`（任務紐付け） / `capture_learning_candidate`（うけばこ登録）
- 単一ユーザー・ローカル `next dev` 実行のみを前提

### 明示的にスコープ外（将来検討・Obsidian human_task 起票済み）

- 他ページ（`/gates/[id]` 等）への展開
- 対象ツールの追加（`route.ts` には24件の `registerTool` 呼び出しがある）
- Vercel 等クラウドデプロイ、他者へのプラグイン配布（`00 Inbox/Tasks/2026/08/2026-08-13T140138...applied-loopのホスティング-配布戦略...md` に別途起票済み）

## アーキテクチャ

### 制約となる事実

- MCP ツール呼び出しが発生する `src/app/api/mcp/route.ts` は Next.js 本体（`next dev -p 3100`）のプロセス内で動く
- ターミナルの WebSocket（`ws://127.0.0.1:3101`）は別プロセス `scripts/terminal-server.mjs`（PTY 中継専用）
- この2プロセスは `npm run dev:all` で `concurrently` 起動される、互いに独立したプロセス

### ライブ配信経路: SSE（3100番プロセス内、新規）

Web 調査済み（2026-08-13）: Next.js App Router の Route Handler は Web Streams API で SSE をネイティブサポートしており、カスタムサーバー不要。単一ユーザー・ローカル完結という要件下では Socket.io 等の自前 WS サーバー構築や Pusher/Ably/Supabase Realtime 等のマネージド Pub/Sub は複雑度が増すだけで恩恵が薄く、不採用。

- `route.ts` と同じプロセス内に SSE 用 Route Handler を新設し、ブラウザは `EventSource` で購読する
- 3101番のターミナル WS サーバーには一切手を入れない（PTY 中継専用の責務を維持）
- 実装時の注意点（調査結果）:
  - `ReadableStream` の `start()` 内でブロッキングせず即座に `Response` を返す（でないと Next.js がハンドラ完了までバッファリングする）
  - `export const dynamic = 'force-dynamic'` を明示、Content-Type は `text/event-stream`
  - Next.js の HMR は別チャンネル（`webpack-hmr`）なので衝突リスクは低いが、SSE 接続を確実にクローズしないと接続数上限に達し HMR を巻き込んで詰まる事例報告があるため、クリーンアップ（`disposed` フラグ等）は必須

### データフロー

イベント発行ポイントはツールごとに異なる（2026-08-13 実装調査で確定）。

**`save_task_mappings` / `capture_learning_candidate`**（同期的に完結する処理）:

```
[ターミナル内 Claude/Codex]
  → MCP ツール呼び出し
  → route.ts の各ハンドラ内で DB 保存が成功した直後にイベント発行
  → SSE Route Handler が購読中の接続へ配信
  → ブラウザの EventSource が受信 → 演出発火
```

**`answer_gate`**（合否は非同期採点で確定するため、ツール呼び出し自体ではフックできない）:

```
[ターミナル内 Claude/Codex]
  → answer_gate 呼び出し → acceptGateAnswer が status:"answered" を保存し即座に応答を返す
  → （応答後、Next.js の after() フックで）gradeGate(gateId) が非同期に走る
  → gradeGate 内、status を "passed"/"failed" に更新した直後（src/lib/gate.ts:791 付近）にイベント発行
  → SSE Route Handler が購読中の接続へ配信 → ブラウザが受信 → 演出発火
```

`gradeGate` は `gate-answer.ts`（MCP/terminal/battle 共通経路）・`actions.ts`（Server Action）・`requeue-failed-grading.ts`（再採点キュー）の計4箇所から呼ばれるが、フックを `gradeGate` 内部に置くことで呼び出し元ごとの個別対応なしに全経路をカバーできる。

- イベント発行は**成功した場合のみ**（`answer_gate` は pass 判定時のみ、他2ツールは処理成功時のみ）。失敗・fail 判定時は演出を出さない
- MVP は単一ブラウザ・単一セッション想定のため、イベントに宛先ルーティング（誰宛か）は持たせない。将来の複数タブ対応は将来検討事項

## レイアウト・コンポーネント設計

koki 承認済みモック（visual companion、2026-08-13）: DS実機風の筐体。

- 上画面: 全幅。既存の「ちず（`AtlasWorldMap`）＋ステータス（`StatusCommandPanel`）」横並び構成を維持
- ヒンジ: 上下画面の間に蝶番風の装飾（実機を模した意匠要素）
- 下段: 3カラム「十字キー（装飾）｜ターミナル画面（`AtlasAssist` 内の `TerminalPanel`）｜ABXYボタン（装飾）」。十字キー・ABXYボタンは実機を模した静的な装飾要素（操作機能は持たない）
- ターミナルの開閉: 初期表示は常時開いた状態（DS体験を常時見せる）。ただし**折りたたみボタンは残す**（マップを広く見たい時のための逃げ道）
- 画面縁の演出: 金色グロー。平常時は薄く発光、MCPツール発火時にパルス発光。SSE 未接続時はグローを消灯/グレーアウトして状態を示す

## 演出設計（C軸＝ステータス数値ライブ更新を基本に、A/B軸を要所に付加するハイブリッド）

| ツール | 演出 |
|---|---|
| `answer_gate`（`gradeGate` で pass 確定時） | マップの quest ピンが撃破済み表示に変化 **＋** ステータスパネルの EXP バーがその場で伸びるアニメーション（両方同時） |
| `save_task_mappings` | 画面下部に薄い通知バナー（「今の任務と関連しそうな学びを検知」等） |
| `capture_learning_candidate` | マップ／ステータス脇に小さなアイコンがバウンドする軽量アニメーション |

**制約（2026-08-13 実装調査で判明）**: `AtlasWorldMap` の quest ピン（！マーク）は `pendingGate`（単数）からのみ生成され、`id: "quest-1"` 固定。複数 gate の個別ピンは存在しない。そのため「quest ピンが撃破済みに変化」演出は、**今 pass したゲートが、現在表示中の唯一の quest ピンと一致する場合のみ**成立する。一致しない場合（別のゲートを裏で採点していた等）はピン演出をスキップし、EXP バー伸長のみ発火する。

- 通知バナーが複数同時発火した場合はスタックして縦に積み、数秒で自動フェードアウトする

## エラーハンドリング

- SSE 接続断: `EventSource` の自動再接続に委ねる（ブラウザ標準機能）。UI 上は画面縁のグローを消灯/グレーアウトして「未接続」を視覚的に示す
- MCP ツール呼び出し自体が失敗した場合: イベントを発行しない（演出なし）。既存のターミナル出力・デブリーフ表示で失敗は別途分かるため、演出面での追加のエラー表現は持たせない
- 開発中の Route Handler 再コンパイルによる SSE 切断: `EventSource` の自動再接続で実害は小さい見込み（Web 調査より）

## テスト方針

- このプロジェクトのテストは Node.js 組み込み test runner（`tsx --test src/lib/*.test.ts`、Vitest/Jest ではない）。UI コンポーネントの自動テストの慣習はなく、ブラウザ実機確認が正
- イベント発行ロジック（`gradeGate` 内フック・各ハンドラ内フックが成功時のみ発火するか）は `src/lib/*.test.ts` で単体テスト
- SSE Route Handler の疎通・イベント配信・演出はブラウザ実機で確認（`npm run dev:all` 起動状態で対象ツールを実際に叫び、演出が発火するか目視）
- 既存の `TerminalPanel` / `AtlasAssist` の動作（xterm.js 接続、認証、再起動 UI）は無改造なので回帰テスト対象外

## 追補: 筐体UIのサイズ・ディテール改善（2026-08-13 実機確認後）

koki が実機（`npm run dev:all`）でトップページを確認した結果、2点のFB:

1. **13インチデスクトップの標準的なビューポート（1440×750想定）内に筐体全体が収まらない**。旧実装は上画面（`AtlasWorldMap` aspect-[16/11] 相当）・下画面（`TerminalPanel` の `h-[60vh] min-h-[420px]`）とも高さ制約が緩く、合計すると常にスクロールが必要な高さになっていた
2. **筐体UI（`AtlasConsoleShell`）自体のディテールが単調で、内側のゲーム画面（DQ風のちず/ステータス/ターミナル）に見劣りする**。単純な3色グラデーション・3pxのシンプルな画面枠・単純な矩形/円のみのボタン装飾では実機のような質感が出ていない

koki 承認済みの方向性（visual companion、2026-08-13 追補セッション）: **横長レイアウトは許容**（"横長は仕方ないね" — 13インチの横幅に対して縦を大胆に圧縮する形で解決する）。

### サイズ

実寸 1440×750 ビューポートを想定し、以下の高さ配分で余裕を持って収める（実測合計 ≒683px、67pxの余裕）:

- ヘッダー等の余白: 60px
- 筐体 padding: 34px（`18px 20px 16px` 相当）
- 上画面（ちず＋ステータス）: 349px（高さ固定。既存の `AtlasWorldMap` の aspect-ratio 依存から、筐体側で高さを明示指定する形に変更）
- ヒンジ: 29px（高さ＋上下マージン込み）
- 下画面（ターミナル）: 211px（既存 `TerminalPanel` の `h-[60vh] min-h-[420px]` を、DS筐体内で使う場合に限り大幅に縮小する必要がある）

下画面の高さを 211px まで縮めるのは `TerminalPanel` 単体のデフォルト（`min-h-[420px]`）から見て大きな逸脱のため、`TerminalPanel` 自体は無改造のまま、`AtlasConsoleShell` の下画面ラッパー（`.atlas-console-lower-screen` 配下）に、`TerminalPanel` のルート要素の高さを上書きする CSS を追加する方式で実現する（`TerminalPanel` に新規 prop は追加しない）。他の呼び出し元（`gate-terminal-section.tsx`、独立した `AtlasAssist` 呼び出し）は `AtlasConsoleShell` 配下ではないため、CSS の影響を受けず見た目は変更されない。

### ディテール（立体感）

visual companion で承認済みの意匠要素（CSSのみ、画像不使用の既存方針を継続）:

- 筐体表面: 複数レイヤーのグラデーション（左上ハイライト＋左上→右下のダークグラデーション）、底面に設置影（machine が机上に置かれている質感）
- 画面ベゼル: 厚み5px、内側グロー＋斜めグレア＋inset シャドウの多層構成
- ヒンジ: 金属シリンダー風（放射グラデーションの軸受け、複数の影レイヤー）
- 十字キー／ABXYボタン: inset ハイライト＋シャドウで凹凸感、ABXYは放射グラデーションで光沢
- ブランドプレート「Living Atlas」の刻印風テキスト、スピーカーグリル風のドットパターン装飾

### スコープ

`AtlasConsoleShell`（`src/components/living-atlas/atlas-console-shell.tsx`）と `src/app/atlas-living.css` の該当ルール、および `TerminalPanel` の高さをDS筐体内でのみ上書きする仕組みの追加。それ以外（SSE配信・イベント発行ロジック・演出トリガーの仕組み）は無変更。

## 将来の拡張（本設計のスコープ外）

- 全ページへの展開（今回はトップページのみ検証してから判断、と koki 確定）
- 対象 MCP ツールの追加
- ホスティング・配布戦略の見直し（クラウドデプロイ時は SSE の前提「単一プロセス・単一ユーザー」が崩れるため、別途設計要。Obsidian に人間タスクとして起票済み）

## 参照

- ENTRY: `.claude/progress/living-atlas-ui-handoff.md`
- Obsidian human_task（企画練り直し起票）: `00 Inbox/Tasks/2026/08/2026-08-13T131551+0900-humantask-DS風二画面タ-ミナル連動UIを企画として練り直す-d9481581f1.md`
- Obsidian human_task（ホスティング戦略、本設計のスコープ外として分離）: `00 Inbox/Tasks/2026/08/2026-08-13T140138+0900-humantask-applied-loopのホスティング-配布戦略を検討する-Vercel等クラウドデプロイ-vs-プラグイン配布してロ-カル起動-0eebac9132.md`
- 既存実装: `src/components/terminal-panel.tsx`, `src/components/living-atlas/atlas-assist.tsx`, `src/components/living-atlas/atlas-dashboard.tsx`, `src/app/api/mcp/route.ts`
