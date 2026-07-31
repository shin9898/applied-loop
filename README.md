# Applied Loop

読んだ本を、実務の意思決定に変える。
学び → 実務適用 → 証跡のループで「使った」が残る学習ツール。

プロダクト基盤（Core/Why/What/How）は [docs/adr/0001-product-foundation.md](docs/adr/0001-product-foundation.md) を参照。

## セットアップ

```bash
npm install
npx prisma migrate dev   # dev.db 作成 (プロジェクトルート)
npx prisma generate      # Prisma Client 生成
npm run dev              # http://localhost:3000
```

## 初期データ移行

pm-learn (`~/.my-copy/pm-learn/entries.jsonl`) と
SR カード (`~/.claude/learning/sr-cards.json`) を取り込む。冪等なので再実行可。

```bash
npm run import:data      # dry-run は npx tsx scripts/import.ts --dry-run
npm run seed:exp1        # 実験#1 (メタ dogfooding) の seed
```

## 週次ダイジェスト

git log と新規 ADR を koki-central へ投影 (my-copy obsidian_capture 経由・read-only 投影)。

```bash
npm run digest           # dry-run は node scripts/weekly-digest.mjs --dry-run
```

## 構成

- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind CSS 4
- Prisma 7 + SQLite (better-sqlite3 driver adapter)
  - 公開時は Supabase (Postgres) へ adapter ごと移行予定
- `/` ダッシュボード (チェックイン・未適用リマインド・期限切れカード)
- `/entries` 学びの登録と適用記録 (イベント型ループの中核)
- `/experiments/[id]` オプションの30日実験
- `/cards` SR カード (SM-2 簡易版)
- `/lp` ランディングページ (waitlist 登録)

## 運用メモ

- appetite: 8週間 (2026-07-31 起算。業務 KDI 枠外・業務外時間)
- 意思決定は docs/adr/ に ADR として記録する (テンプレ: 0000-template.md)
- 週次ふりかえりで digest を投影し、埋もれ対策とする
