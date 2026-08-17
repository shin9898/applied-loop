# Applied Loop

*[English README](README.en.md)*

実装の足跡を**材料**として貯め、1日の**教科書（きょうのしょ）**に圧縮し、確認で理解状態（Mastery）を振り分けて翌日を進めるローカルツール（[ADR-0020](docs/adr/0020-daily-retro-knowledge-loop.md)）。

即時の理解チェック（しれん）も過渡期の互換として残る。答えたつまずきは**ずかん**に貯まる。UI は Living Atlas。操作の正典は **MCP**（Web は地図・診断・提出入口）。

**紹介 LP:** ローカル `/lp` · GitHub Pages 用静的版 [docs/lp/](docs/lp/)（repo Settings → Pages → Deploy from branch → `/docs`）  
**進捗正本（Phase）:** [docs/phase-progress.md](docs/phase-progress.md) · [ADR-0019](docs/adr/0019-core-loop-phases.md) · P4 日次振り返り [ADR-0020](docs/adr/0020-daily-retro-knowledge-loop.md)  
初回セットアップ詳細: [docs/onboarding.md](docs/onboarding.md)  
同僚ウォークスルー: [docs/walkthrough-checklist.md](docs/walkthrough-checklist.md)  
運用ログ・再出題/queue: [docs/ops-logs.md](docs/ops-logs.md)  
面・周辺の解放条件: [docs/surface-unlock.md](docs/surface-unlock.md)

---

## 仲間向け・最短（これだけ）

1. 起動（2コマンド）

```bash
npm run setup          # preflight / install / .env生成 / migrate / sample seed
                        # 採点CLI検出 → 使うLLMを選ぶとMCP登録コマンドをそのまま出す
npm run dev:all        # http://localhost:3100
```

2. ブラウザで **[じゅんび](http://localhost:3100/setup)** → サンプルしれんを1問提出（合否は待たなくてよい）
3. LLM を選び、`npm run setup` が出した MCP 登録コマンドをそのまま貼る → 先に `list_pending_gates` が走る
4. 本運用の供給（どちらか）: じゅんびで**監視リポジトリ**＋鉤、または会話で `request_gate`

つまずきやすい3点:
- **採点が出ない** → headless の Claude/Codex CLI にログイン済みか。`npm run regrade -- <gateId>`
- **ポート** → `npm run preflight`（3100 / 3101）
- **hook** → アプリ停止中は `~/.applied-loop/event-queue.jsonl` に退避。`dev:all` 後の次コミットで flush（[ops-logs.md](docs/ops-logs.md)）

---

## クイックスタート（手動）

```bash
cp .env.example .env   # MCP_TOKEN / MCP_SURFACE=core
npm install
npx prisma migrate dev
npm run dev:all
```

## 主な画面（コア）

| パス | 役割 |
|---|---|
| `/` | ちず（ホーム） |
| `/setup` | じゅんび（チュートリアル＋診断） |
| `/gates` | しれん（理解度チェック・あとまわし可） |
| `/zukan` | ずかん（つまずき） |
| `/retro` | きょうのしょ（日次教科書 → 確認 → Mastery） |

本人用の周辺（goals / harness / requirements / Cloud など）は Phase 進行で段階復帰。直 URL と `MCP_SURFACE=full` でも到達可。

## 構成

- Next.js (App Router) + TypeScript + Tailwind
- Prisma + SQLite（公開時は Postgres 移行予定）
- MCP: `POST /api/mcp`（Streamable HTTP）
- アプリ内じゅもん: `scripts/terminal-server.mjs`（`ENABLE_TERMINAL=true`）
- ライセンス: [FSL-1.1-MIT](LICENSE.md)（個人利用・改変・再配布は自由。競合サービス化のみ2年間制限、以後 MIT）

## よく使うスクリプト

```bash
npm run dev:all          # UI + じゅもん
npm run mcp:cloud-config # Cloud Agent 向け MCP 設定片（要 APPLIED_LOOP_URL）
./scripts/setup-git-hook.sh ~/path/to/repo
npm run import:data      # 既存 pm-learn 等の取込
npm run digest           # 週次ダイジェスト投影
```

## 運用メモ

- 意思決定は `docs/adr/` に ADR として記録する
- 書き込みの正本は MCP。しれん提出は `acceptGateAnswer` 一本（バトル直接提出も同経路）。`/entries/new` フォームは廃止（ADR-0010）
- ハーネスは会話本文を読まない（メタデータのみ, ADR-0009）
- 発信用ドラフト（Zenn 想定・紹介→設計判断）: [docs/blog/2026-08-why-mcp-async-grade-metadata.md](docs/blog/2026-08-why-mcp-async-grade-metadata.md)
