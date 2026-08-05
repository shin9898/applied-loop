# MCP セットアップ — LLM ワークフローへの埋め込み

Applied Loop の配布物は 3 点セット (ADR-0005):

1. **MCP エンドポイント** (`/api/mcp`)
2. **ルールスニペット** (CLAUDE.md / Cursor Rules への追記)
3. **hook 設定** (SessionEnd での捕捉誘導 / SessionStart での briefing)

## 1. MCP エンドポイントの登録

前提: `npm run dev` でアプリが起動していること
（自分用は `http://localhost:3100/api/mcp`）。

### Claude Code

```bash
claude mcp add --transport http applied-loop http://localhost:3100/api/mcp
```

`MCP_TOKEN` を `.env` に設定した場合はヘッダー付きで:

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
      "url": "http://localhost:3100/api/mcp"
    }
  }
}
```

### Codex

この環境の Codex は HTTP MCP を url 直指定できる (2026-08-01 検証済み)。
`~/.codex/config.toml` に追加:

```toml
[mcp_servers.applied-loop]
url = "http://localhost:3100/api/mcp"
```

※ url 直指定をサポートしない古い Codex では
`npx mcp-remote http://localhost:3100/api/mcp` ブリッジを使う。

## 2. ルールスニペット

CLAUDE.md（プロジェクト or グローバル）/ Cursor Rules に追記する文:

```markdown
## Applied Loop (学びの記録)

- この環境には MCP サーバー `applied-loop` がある。
- セッションのふりかえり時、またはユーザーが「学びを記録して」と
  明示した時に、そのセッションで判明した非自明な知見
  （デバッグの発見・設計判断の根拠）を
  `capture_learning_candidate` で受信箱に登録する。
  一般常識や作業ログは登録しない。
- ユーザーが「この学びを使った」と言った時は
  `record_application` で適用記録を残す。
```

## 3. hook 設定（Claude Code）

### SessionStart — 朝の briefing

その日最初のセッションで受信箱・問いかけを表示させる。
`~/.claude/settings.json` の hooks に追加（my-copy 既存 hook と併存可、
責務は別）:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"今日最初のセッションです。applied-loop MCP の morning_briefing ツールを呼んで、受信箱と今日の問いかけをユーザーに提示してください。\"}}'"
          }
        ]
      }
    ]
  }
}
```

### SessionEnd — セッション区切りでの捕捉

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'セッション終了前に: このセッションで判明した非自明な知見があれば applied-loop MCP の capture_learning_candidate で受信箱に登録してください（なければ何もしない）。' >> ~/.applied-loop/session-end.log"
          }
        ]
      }
    ]
  }
}
```

※ SessionEnd hook は LLM に指示を返せないため、捕捉の誘導は
実際にはルールスニペット側で担保する。hook 側は記録用。
Claude Code の Stop hook（additionalContext 対応）で誘導する構成に
変えてもよい。運用しながら調整する。

## ツール一覧（MVP は 3 つのみ）

| ツール | 用途 |
|---|---|
| `capture_learning_candidate` | 学び候補を受信箱へ（正典には直接書かない） |
| `record_application` | 適用記録（証跡）を残す |
| `morning_briefing` | 朝の受信箱・問いかけ・期限カードの提示 |

## accept 率の計測

受信箱の 登録/(登録+無視) が捕捉精度。5 割を切ったら
`src/app/api/mcp/route.ts` のツール説明文（発火条件）をチューニングする。
