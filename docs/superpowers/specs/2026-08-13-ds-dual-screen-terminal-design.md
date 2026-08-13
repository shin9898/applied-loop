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
- 反応対象の MCP ツール3種: `submit_gate_answer` / `save_task_mappings` / `capture_add`
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

```
[ターミナル内 Claude/Codex]
  → MCP ツール呼び出し (submit_gate_answer 等)
  → route.ts の既存 registerTool ラッパー（サーフェスフィルタ用、行70-75）に相乗り
  → ツール呼び出し成功時のみ、in-memory pub/sub にイベント発行
  → SSE Route Handler が購読中の接続へ配信
  → ブラウザの EventSource が受信
  → 上画面（マップ／ステータス）が対応する演出を発火
```

- イベント発行は**ツール呼び出しが成功した場合のみ**。失敗時は演出を出さない
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
| `submit_gate_answer` 成功 | マップの該当 gate ピンが撃破済み表示に変化 **＋** ステータスパネルの EXP バーがその場で伸びるアニメーション（両方同時） |
| `save_task_mappings` | 画面下部に薄い通知バナー（「今の任務と関連しそうな学びを検知」等） |
| `capture_add` | マップ／ステータス脇に小さなアイコンがバウンドする軽量アニメーション |

- 通知バナーが複数同時発火した場合はスタックして縦に積み、数秒で自動フェードアウトする

## エラーハンドリング

- SSE 接続断: `EventSource` の自動再接続に委ねる（ブラウザ標準機能）。UI 上は画面縁のグローを消灯/グレーアウトして「未接続」を視覚的に示す
- MCP ツール呼び出し自体が失敗した場合: イベントを発行しない（演出なし）。既存のターミナル出力・デブリーフ表示で失敗は別途分かるため、演出面での追加のエラー表現は持たせない
- 開発中の Route Handler 再コンパイルによる SSE 切断: `EventSource` の自動再接続で実害は小さい見込み（Web 調査より）

## テスト方針

- イベント発行ロジック（`registerTool` ラッパーへの相乗り、成功時のみ発火）は単体テストで検証
- SSE Route Handler の疎通・イベント配信はブラウザ実機で確認（`npm run dev:all` 起動状態で対象ツールを実際に叫び、演出が発火するか目視）
- 既存の `TerminalPanel` / `AtlasAssist` の動作（xterm.js 接続、認証、再起動 UI）は無改造なので回帰テスト対象外

## 将来の拡張（本設計のスコープ外）

- 全ページへの展開（今回はトップページのみ検証してから判断、と koki 確定）
- 対象 MCP ツールの追加
- ホスティング・配布戦略の見直し（クラウドデプロイ時は SSE の前提「単一プロセス・単一ユーザー」が崩れるため、別途設計要。Obsidian に人間タスクとして起票済み）

## 参照

- ENTRY: `.claude/progress/living-atlas-ui-handoff.md`
- Obsidian human_task（企画練り直し起票）: `00 Inbox/Tasks/2026/08/2026-08-13T131551+0900-humantask-DS風二画面タ-ミナル連動UIを企画として練り直す-d9481581f1.md`
- Obsidian human_task（ホスティング戦略、本設計のスコープ外として分離）: `00 Inbox/Tasks/2026/08/2026-08-13T140138+0900-humantask-applied-loopのホスティング-配布戦略を検討する-Vercel等クラウドデプロイ-vs-プラグイン配布してロ-カル起動-0eebac9132.md`
- 既存実装: `src/components/terminal-panel.tsx`, `src/components/living-atlas/atlas-assist.tsx`, `src/components/living-atlas/atlas-dashboard.tsx`, `src/app/api/mcp/route.ts`
