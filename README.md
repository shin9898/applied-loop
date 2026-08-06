# Applied Loop

LLM 作業中の学びと、vibe coding の理解ギャップを、**証跡が残るループ**に変える。

UI は Living Atlas（ぼうけんのしょ）。操作の正典は **MCP**（アプリは地図・診断・じゅもんの入口）。

プロダクト基盤: [docs/adr/0001-product-foundation.md](docs/adr/0001-product-foundation.md)  
**初回セットアップ正本: [docs/onboarding.md](docs/onboarding.md)**  
MCP 詳細: [docs/mcp-setup.md](docs/mcp-setup.md)

## クイックスタート

```bash
cp .env.example .env   # MCP_TOKEN と ENABLE_TERMINAL を編集
npm install
npx prisma migrate dev
npm run dev:all        # http://localhost:3100  +  WS :3101
```

ブラウザを開く。初回は短い案内のあと、**`/setup`（コマンド「じゅんび」）** のウィザードへ進む。  
最短は「サンプルしれんを Web で1問提出 → LLM に貼る文で1回呼ぶ」。詳細は [docs/onboarding.md](docs/onboarding.md)。

## 主な画面

| パス | 役割 |
|---|---|
| `/` | WORLD MAP・司令塔・じゅもん（準備不足時は1行バナー） |
| `/setup` | じゅんび（進行つきチュートリアル＋診断） |
| `/gates` `/gates/[id]` | しれん一覧／バトル |
| `/zukan` | つまずきずかん |
| `/entries` `/inbox/[id]` | にっき・受信箱（棚。仕分けは MCP） |
| `/goals` | もくひょう（証跡密度） |
| `/harness` | どうぐ・キャッシュ処方 |
| `/requirements` | メテオフォール（要件↔理解） |
| `/lp` | ランディング（waitlist） |

## 構成

- Next.js (App Router) + TypeScript + Tailwind
- Prisma + SQLite（公開時は Postgres 移行予定）
- MCP: `POST /api/mcp`（Streamable HTTP）
- アプリ内じゅもん: `scripts/terminal-server.mjs`（`ENABLE_TERMINAL=true`）

## よく使うスクリプト

```bash
npm run dev:all          # UI + じゅもん
./scripts/setup-git-hook.sh ~/path/to/repo
npm run import:data      # 既存 pm-learn 等の取込
npm run digest           # 週次ダイジェスト投影
```

## 運用メモ

- 意思決定は `docs/adr/` に ADR として記録する
- 書き込みの正本は MCP。しれん提出は `acceptGateAnswer` 一本（バトル直接提出も同経路）。`/entries/new` フォームは廃止（ADR-0010）
- ハーネスは会話本文を読まない（メタデータのみ, ADR-0009）
- 発信用ドラフト（Zenn 想定・紹介→設計判断）: [docs/blog/2026-08-why-mcp-async-grade-metadata.md](docs/blog/2026-08-why-mcp-async-grade-metadata.md)
