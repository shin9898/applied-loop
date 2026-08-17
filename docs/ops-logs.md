# 運用ログ・復帰手順（P2）

## 失敗ログの置き場（B12-2）

生成失敗は `DevEvent.skipReason`（`gen_failed*`）、採点失敗は `Gate.status=grading_failed`、オフライン退避は `~/.applied-loop/event-queue.jsonl`。週次集計は `npm run supply:health`。

**生成失敗の再試行（2026-08-16 追加）**: CLI 認証切れ等の復旧後に `npm run requeue:gen`（`--dry-run` で対象確認、`--limit N` で件数指定、既定5件）。hook がコミット時点の diff を `DevEvent.diffSnapshot` に添付保存するため、worktree 削除後でも再試行できる（ADR-0006 追記）。

**opt-in 匿名テレメトリ（2026-08-16 追加, W5-8 #15）**: `/setup` 下部で同意すると、正本7点（`ACTIVATION_STEPS`）のイベント名・匿名ID（`~/.applied-loop/telemetry-opt-in.json` で永続化）・タイムスタンプのみを `TELEMETRY_URL`（`.env`、未設定なら送らない）へ POST する。会話本文・repo 名・`meta` は送らない（ADR-0009 継承）。ローカル JSONL（`~/.applied-loop/activation-events.jsonl`）への記録は同意の有無に関わらず従来どおり。送信は fire-and-forget・3秒タイムアウトで失敗しても学習ループは止めない（`src/lib/activation-funnel.ts` の `maybeForwardTelemetry`）。

## 再出題スケジューラ（B12-1）

`scheduleDueGates()` は cron ではなく次で発火する:

1. **MCP `morning_briefing`**（朝の起点）
2. **ホーム読み込み**（`loadHomeProps`）

条件: `Misconception.nextReviewAt <= now` かつ、当該誤解に `pending` / `answered` / `grading` の Gate が無い。最大5件。生成後 `nextReviewAt` を null にする。

手動検証:

```bash
npx tsx scripts/debug-misconception.ts
# または nextReviewAt を過去に戻してから morning_briefing / ホーム再読込
```

## event-queue 復帰（B2-4）

1. アプリ停止中にコミットすると hook が `~/.applied-loop/event-queue.jsonl` に追記する
2. `npm run dev:all` でアプリを起動する
3. **次のコミット**（どの repo でも可）で queue が先に flush される（`scripts/git-hook-post-commit.sh`）
4. 送れなかった行だけ queue に残る → URL / `MCP_TOKEN` / アプリ起動を確認

再現チェック:

```bash
# アプリ停止中に1コミット → queue に1行増える
# dev:all 起動後にもう1コミット → queue が空（または未達分のみ残る）
ls -la ~/.applied-loop/event-queue.jsonl
```
