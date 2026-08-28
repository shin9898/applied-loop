# MCP セットアップ — LLM ワークフローへの埋め込み

初回の全体像は **[onboarding.md](./onboarding.md)（正本）** を先に読む。

Applied Loop の配布物は 3 点セット (ADR-0005):

1. **MCP エンドポイント** (`/api/mcp`)
2. **ルールスニペット** (CLAUDE.md / Cursor Rules / AGENTS.md への追記)
3. **hook** (SessionStart で briefing 誘導 / git post-commit でしれん生成)

## 1. MCP エンドポイントの登録

前提: `npm run dev:all`（または `npm run dev -- -p 3100`）でアプリが起動していること。
手動起動を毎回忘れがちな場合は `scripts/com.applied-loop.dev.plist`（launchd 常駐化、KeepAlive で自動再起動）を使う。

| 使い方 | URL | 登録先 |
|---|---|---|
| **手元**（Cursor Desktop / 手元 Claude CLI / 手元 Codex） | 常に `http://localhost:3100/api/mcp` | Desktop 側の設定 |
| **Cloud**（Cursor Cloud Agent など別ホスト） | Reachable（`APPLIED_LOOP_URL` / トンネル）`/api/mcp` | Cloud 側だけ（Agents UI 等） |

**.env にトンネル URL があっても、Desktop の `mcp.json` には localhost だけ書く。**  
混ぜると quick tunnel 失効時に手元まで死ぬ。Cloud 手順は [cloud-mcp.md](./cloud-mcp.md)。

`.env` の `MCP_TOKEN` を Bearer に使う。**`npm run setup` を実行すると、実際のトークンを埋め込んだ下記スニペットを対話式で1つ選んで表示する**（W5-8 #14）。手動で組み立てる場合は以下を参照。

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
- applied-loop のツールが見当たらない／接続エラーになった場合、ローカルサーバー
  （`npm run dev:all`）が落ちている可能性が高い。回答本文は会話に残っているので
  失われてはいない。ユーザーへ「`npm run dev:all` で起動してから、もう一度
  『提出して』と言ってください」と案内し、推測で合否や受理を偽装しない。
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

## 3.5 Claude / Codex ハーネスメタデータの自動収集（macOS）

Claude Code / Codexのsession終了後に手動collectorを実行する必要はない。対話的macOSでは
`npm run setup`の成功経路がper-user LaunchAgentを冪等に登録し、初回catch-upも開始する。
追加コマンドは不要。

CI・macOS以外・非対話環境では安全のため自動登録をskipする。非対話の配布scriptから明示的に
有効化する場合は`APPLIED_LOOP_INSTALL_HARNESS_COLLECTOR=1 npm run setup`、対話環境でも登録を
抑止する場合は`APPLIED_LOOP_SKIP_HARNESS_COLLECTOR=1 npm run setup`を使う。clone移動後の再登録や
個別の修復には`npm run harness:collector:install`を使える。

登録時とログイン時にcatch-upし、その後は15分ごとに増分収集する。pending sessionは最古を先頭に、
oldest/newestを交互配置して次回tickへcheckpoint付きで継続する。1runの12分budgetはdirectory走査、
各sessionのparse/POST/retry、最終pending走査の呼出し境界で適用する。ただし、開始済みの単一の同期
filesystem syscall・`readFileSync`・parseやPOSTを途中中断するものではない。HTTP request timeout等の
終了処理もあるため、実wall-clockは12分を少し超える場合がある。Applied Loopサーバーやnetworkが
停止している間はcheckpointを進めず、復旧後の周期で未同期sessionを再送する。
収集対象はmodel/token/tool名/時刻/session ID/repo等のメタデータだけで、会話本文、thinking本文、
tool input/resultは保存・送信しない。

状態確認:

```bash
npm run harness:collector:status
# launchdを調べずcollector状態だけJSONで確認
node scripts/collect-harness.mjs --status --json
```

`status`には最終完全同期、最終checkpoint、未同期session数、直近errorが出る。永続state/status/logは
`~/.applied-loop/harness-collector/`、登録plistは
`~/Library/LaunchAgents/com.applied-loop.harness-collect.plist`に置かれる。cloneを移動した場合は
installを再実行して絶対pathを更新する。

解除（checkpoint/logは復旧用に残す）:

```bash
npm run harness:collector:uninstall
```

検証用のsnapshot/max-sendsは通常運用へ混ぜない。必要なときだけcollectorを直接呼ぶ。

```bash
node scripts/collect-harness.mjs --dry-run --snapshot-out /tmp/harness-targets.json --max-sends 100
node scripts/collect-harness.mjs --apply-snapshot /tmp/harness-targets.json --max-sends 100
```

設計・障害復旧・tradeoffの正本: [ADR-0040](./adr/0040-durable-automatic-harness-collection.md)。

## 3.6 ツール面（core / full）

既定は仲間向け **`MCP_SURFACE=core`**（`morning_briefing` / `list_pending_gates` / `request_gate` / `answer_gate` / `get_gate_result` / `watch_repos` の6本）。  
本人の全ツールは `.env` に `MCP_SURFACE=full`。ADR-0019。  
**いつ何を解放するか**は1行表: [surface-unlock.md](./surface-unlock.md)（P3 B1-5）。

## 4. Cloud Agent 向け（Reachable MCP）

Cloud VM からは `localhost` に届かない。トンネル等で手元の `/api/mcp` を届け、
**同じ Bearer** で登録する。設計と手順の正本: **[cloud-mcp.md](./cloud-mcp.md)**（ADR-0018）。  
UI: `/setup` の青いカード **「Cloud の生成AIからも同じループ」**（選ぶ→トンネル→登録→疎通）。

```bash
# 例: cloudflared でトンネル → 表示 URL を .env へ
# APPLIED_LOOP_URL=https://xxxx.trycloudflare.com
npm run mcp:cloud-config          # Cursor / Claude / Codex 用スニペット + 検証文
npm run mcp:cloud-config -- --redact
```

**Desktop ≠ 別ホスト**: Cursor Cloud は Agents 画面で Add。Claude Web は `.mcp.json`。  
Codex は同一ホストの `config.toml` 共有／持ち運びは `.codex/config.toml`（trusted）。  
詳細と確度表は [cloud-mcp.md](./cloud-mcp.md)。

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
| しれん | `request_gate`, `answer_gate`, `enrich_gate_places` |
| 学び | `capture_learning_candidate`, `triage_inbox`, `record_application`, `find_related_learnings` |
| 目標 | `register_goals`, `update_goal`, `approve_goal_link`, `reject_goal_link` |
| 任務×学び | `save_task_mappings` |
| どうぐ | `suggest_cache_prefix_fix` |
| 要件 | `register_requirement`, `list_requirements`, `link_requirement`, `approve_requirement_link`, `reject_requirement_link` |

## accept 率の計測

受信箱の 登録/(登録+無視) が捕捉精度。5 割を切ったら
`src/app/api/mcp/route.ts` のツール説明文（発火条件）をチューニングする。
