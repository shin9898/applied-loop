# MCP セットアップ — LLM ワークフローへの埋め込み

初回の全体像は **[onboarding.md](./onboarding.md)（正本）** を先に読む。

Applied Loop の配布物は 3 点セット (ADR-0005):

1. **MCP エンドポイント** (`/api/mcp`)
2. **ルールスニペット** (CLAUDE.md / Cursor Rules / AGENTS.md への追記)
3. **hook** (SessionStart で briefing 誘導 / git post-commit でしれん生成)

## 1. MCP エンドポイントの登録

前提: `npm run dev:all`（または `npm run dev -- -p 3100`）でアプリが起動していること。  
自分用の既定: `http://localhost:3100/api/mcp`。  
`.env` の `MCP_TOKEN` を Bearer に使う。

### Claude Code

```bash
claude mcp add --transport http applied-loop http://localhost:3100/api/mcp \
  --header "Authorization: Bearer <token>"
```

### Cursor

`~/.cursor/mcp.json` に追加:

```json
{
  "mcpServers": {
    "applied-loop": {
      "url": "http://localhost:3100/api/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml` に追加:

```toml
[mcp_servers.applied-loop]
url = "http://localhost:3100/api/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

※ url 直指定をサポートしない古い Codex では
`npx mcp-remote http://localhost:3100/api/mcp` ブリッジを使う。

## 2. ルールスニペット

CLAUDE.md / Cursor Rules / Codex AGENTS に追記する文（必要に応じて短縮可）:

```markdown
## Applied Loop

- MCP サーバー `applied-loop` がある。
- その日最初のチャットでは `morning_briefing` を呼び、受信箱と今日の問いを簡潔に提示する。
- セッションのふりかえり時、または「学びを記録して」と言われた時は、
  非自明な知見だけ `capture_learning_candidate` で受信箱へ（一般常識・作業ログは不要）。
- 「この学びを使った」と言われた時は `record_application`。
- 理解度ゲートは `list_pending_gates` → 対話 → ユーザーが提出を明示したら `answer_gate`。
  合否は会話中に断定せず `get_gate_result` で確認する。
```

## 3. hook

### git post-commit（しれん生成）

```bash
./scripts/setup-git-hook.sh /path/to/your-repo
```

詳細はスクリプト先頭コメント。認証は `~/.applied-loop/env`（`.env` の `MCP_TOKEN` を転記）。

### Claude Code SessionStart（朝の briefing 誘導）

`~/.claude/settings.json` の hooks に追加（既存 hook と併存可）:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"今日最初のセッションです。applied-loop MCP の morning_briefing を呼んでください。\"}}'"
          }
        ]
      }
    ]
  }
}
```

## 4. Cloud Agent 向け（Reachable MCP）

Cloud VM からは `localhost` に届かない。トンネル等で手元の `/api/mcp` を届け、
**同じ Bearer** で登録する。設計と手順の正本: **[cloud-mcp.md](./cloud-mcp.md)**（ADR-0018）。

```bash
# 例: cloudflared でトンネル → 表示 URL を .env へ
# APPLIED_LOOP_URL=https://xxxx.trycloudflare.com
npm run mcp:cloud-config          # Cursor / Claude / Codex 用スニペット
npm run mcp:cloud-config -- --redact
```

git hook は Cloud worktree では動かないことが多い。学び・回答はセッション内 MCP が本線。

## 5. アプリ内じゅもん（任意）

`.env`:

```
ENABLE_TERMINAL=true
MCP_TOKEN=...
```

`npm run dev:all` で WS `127.0.0.1:3101` が立つ。  
Living Atlas 各画面の「じゅもんをとなえる」から Claude/Codex を起動し、同じ MCP で操作できる（ADR-0015）。

## ツール一覧（applied-loop 0.2.0）

| 領域 | ツール |
|---|---|
| 朝・把握 | `morning_briefing`, `list_pending_gates`, `get_gate_result` |
| しれん | `answer_gate`, `enrich_gate_places` |
| 学び | `capture_learning_candidate`, `triage_inbox`, `record_application`, `find_related_learnings` |
| 目標 | `register_goals`, `update_goal`, `approve_goal_link`, `reject_goal_link` |
| 任務×学び | `save_task_mappings` |
| どうぐ | `suggest_cache_prefix_fix` |
| 要件 | `register_requirement`, `list_requirements`, `link_requirement`, `approve_requirement_link`, `reject_requirement_link` |

## accept 率の計測

受信箱の 登録/(登録+無視) が捕捉精度。5 割を切ったら
`src/app/api/mcp/route.ts` のツール説明文（発火条件）をチューニングする。
