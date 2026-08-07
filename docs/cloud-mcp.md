# Cloud Agent 向け Reachable MCP（1ページ設計）

ローカル dogfood を壊さず、**Cloud VM / リモートエージェントから同じ MCP ツール面を叩ける**ための薄い楔。  
フル SaaS・マルチテナントはしない。

関連: [ADR-0018](./adr/0018-reachable-mcp-cloud.md) · 登録手順の正本は引き続き [mcp-setup.md](./mcp-setup.md)。  
UI 導線: `/setup` の青いカード **「Cloud の生成AIからも同じループ」**（任意ウィザード）。  
テキストの壁ではなく、**いまやる1手**だけ進める（選ぶ → トンネル → 登録 → 疎通）。LLM は最後の検証文だけ。

**確度**

| クライアント | 状態 |
|---|---|
| Cursor Cloud Agent | dogfood 済み（Agents 画面の Add MCP） |
| Claude Code | 公式 docs 準拠・**未 dogfood** |
| Codex | 公式 docs 準拠・**未 dogfood** |

「Cloud」はクライアントごとに別物。Desktop 設定が載るか／どこに書くかも違う。

---

## 問題

| 壊れる点 | 中身 |
|---|---|
| MCP | Cloud から `localhost:3100` に届かない |
| hook | Cloud worktree のコミットでは手元 git hook が発火しない |
| 採点 | Cloud 側に `claude`/`codex` CLI が無いことが多い |
| 設定面 | **Desktop の MCP 設定は別ホストのセッションに自動では載らない** |

## 決定（楔）

1. **Reachable MCP** — 既存の `/api/mcp`（Streamable HTTP）を、トンネルまたは軽いホスト URL で外から届ける。ツール面は変更しない。
2. **ダッシュボードと SQLite は当面ローカル** — 採点の `after(gradeGate)` も、アプリが動いているマシン（＝トンネルの先）で走る。Cloud は「受理」だけすればよい。
3. **認証トリガー** — URL を外に出した瞬間、`MCP_TOKEN`（長い乱数）必須。共有トークン1本で個人トンネルまでは可。常時公開・他人共有なら別設計（per-user キー）へ。
4. **hook はベストエフォート** — Cloud 本線はセッション内 `capture_*` / `answer_gate`。hook はローカル補助と明記。

やらない: 認証なし公開デモ、Cloud 完結の採点基盤、いきなりマルチテナント。

---

## Cloud に配るもの（1セット）

| 項目 | 内容 |
|---|---|
| MCP URL | `{APPLIED_LOOP_URL または MCP_PUBLIC_URL}/api/mcp` |
| Bearer | `.env` の `MCP_TOKEN`（クライアント側は env 経由が望ましい） |
| ルール | [mcp-setup.md §2](./mcp-setup.md) のスニペット（Cloud プロジェクトの Rules / AGENTS にも可） |

stdio は使わない。HTTP + Bearer のみ。

---

## 手元の手順（個人トンネル・推奨）

前提: 手元で `npm run dev:all` が動いている。

```bash
# 別ターミナル例（cloudflared）
cloudflared tunnel --url http://localhost:3100
# 表示された https://xxxx.trycloudflare.com を控える
```

`.env` に追記して Next を再起動:

```bash
APPLIED_LOOP_URL=https://xxxx.trycloudflare.com
# 別名でも可: MCP_PUBLIC_URL=https://xxxx.trycloudflare.com
MCP_TOKEN=（既存の長い乱数。必ず設定）
```

設定片を吐く:

```bash
npm run mcp:cloud-config
# トークン本文を出したくないとき
npm run mcp:cloud-config -- --redact
```

`/setup` でも同じスニペットとクライアント別手順を表示する。  
**quick tunnel は再起動で URL が変わる** → 変わったら **Cloud 側の登録だけ**更新する。

Desktop（`~/.cursor/mcp.json` 等）は常に `http://localhost:3100/api/mcp`。  
トンネル URL を Desktop に書かない（本線チュートリアルも localhost 固定）。

---

## クライアント別の登録先

### Cursor Cloud Agent（dogfood 済み）

| | |
|---|---|
| 登録先 | [cursor.com/agents](https://cursor.com/agents) →「+」→ MCP Servers → **Add MCP**（HTTP） |
| 罠 | Desktop の `~/.cursor/mcp.json` は Cloud Agent に効かない |
| Header | Key = `Authorization` ／ Value = `Bearer <MCP_TOKEN>`（Key に `Bearer` と書かない） |
| チーム | 代替: [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations) |

参考 JSON（UI に同じ値を入れる）:

```json
{
  "mcpServers": {
    "applied-loop": {
      "url": "https://xxxx.trycloudflare.com/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN>"
      }
    }
  }
}
```

### Claude Code（公式 docs・未 dogfood）

面ごとに登録先が違う。[Claude Code MCP docs](https://code.claude.com/docs/en/mcp) / [quickstart](https://code.claude.com/docs/en/mcp-quickstart):

| 面 | 登録先 |
|---|---|
| **Claude Code on the web** | リポジトリ根の **`.mcp.json`** を読む（公式: Connect from other surfaces） |
| 手元 / SSH の CLI | `claude mcp add --transport http …`（default は local scope → `~/.claude.json`） |
| project 共有 | `claude mcp add --scope project` または手書き `.mcp.json` |
| claude.ai Connectors | [claude.ai/customize/connectors](https://claude.ai/customize/connectors)（組織設定。個人トンネル+Bearer の主経路にはしない） |

罠:

- 手元の `~/.claude.json` は **Web セッションに載らない**
- HTTP エントリに **`"type": "http"` が必須**（`url` だけで `type` 無しは stdio 扱いの設定エラー）
- 秘密は `${MCP_TOKEN}` など env 展開（公式）。トークン直書きをコミットしない

Web / project 用 `.mcp.json` 例:

```json
{
  "mcpServers": {
    "applied-loop": {
      "type": "http",
      "url": "https://xxxx.trycloudflare.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
```

CLI（そのマシン上）:

```bash
claude mcp add --transport http applied-loop https://xxxx.trycloudflare.com/api/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
# リポジトリへ書くなら --scope project
```

確認: セッションで `/mcp` → `applied-loop`。project 初回は承認プロンプトあり。

### Codex（公式 docs・未 dogfood）

[Codex MCP](https://developers.openai.com/codex/mcp) / [config basics](https://developers.openai.com/codex/config-basic):

| | |
|---|---|
| 同一ホスト | ChatGPT desktop / Codex CLI / IDE は **同じホスト上で** `config.toml` を共有 |
| 持ち運び | リポジトリの **`.codex/config.toml`**（**trusted project のみ**読み込み） |
| user | `~/.codex/config.toml` |
| 認証 | 公式例は `bearer_token_env_var`（環境変数名）。`http_headers` も可だがトークン直書きは避ける |

罠 / 未確認:

- Mac の `~/.codex` は **別ホストのセッションに自動では載らない**
- Cursor のような「Cloud 専用 Add MCP UI」は **未確認**（ある前提で書かない）
- `experimental_environment = remote` は stdio 用。**streamable HTTP の remote placement は未実装**（設定リファレンス）。HTTP は「設定を持つホスト」から Reachable URL へ繋ぐ

推奨 TOML:

```toml
# .codex/config.toml または ~/.codex/config.toml
# 事前に: export MCP_TOKEN=...
[mcp_servers.applied-loop]
url = "https://xxxx.trycloudflare.com/api/mcp"
bearer_token_env_var = "MCP_TOKEN"
```

確認: `codex mcp list` またはセッションの `/mcp`。

---

## 疎通確認（共通）

新しいセッションに貼る:

```
applied-loop の morning_briefing を呼んで要点をまとめて。
続けて list_pending_gates で最大3件を見て、次に解くゲートを1つ提案して。
answer_gate は私が「解く」と言うまで呼ばない。
MCP が見えない / 401 / timeout ならそこで止めて原因を報告して。
```

| 結果 | 見立て |
|---|---|
| briefing が返る | 成功 |
| ツールが無い | 登録面が違う（Desktop のまま／`.mcp.json` 未配置／project 未承認） |
| 401 | Bearer 違い・未設定・env 未 export（ブラウザで `/api/mcp` が Unauthorized なのは認証が効いている証拠） |
| timeout | トンネル切れ・URL 古いまま・手元 `dev:all` 停止・そのホストから Reachable URL に出られない |

---

## 責任分界

```
[Cloud / remote client] --HTTPS+Bearer--> [トンネル] --> [手元 Next /api/mcp]
                                                      |-- SQLite に受理
                                                      |-- after() でヘッドレス採点（手元 CLI）
[手元ブラウザ] ---------------------- localhost ----> 同じアプリ（地図・ずかん）
```

- 合否は会話中に返さない（既存どおり `get_gate_result`）
- git hook が Cloud で動かなくても、学び・回答は MCP で本線が回る

---

## セキュリティ（個人楔の下限）

- トンネル URL は**秘密扱い**（ログ・PR・ブログに載せない）
- `MCP_TOKEN` は十分長い乱数。トンネル公開中は必須（未設定なら非ローカル Host からの MCP は 401）
- クライアント設定にトークン本文をコミットしない（Claude `${MCP_TOKEN}` / Codex `bearer_token_env_var`）
- 使い終わったらトンネルを落とす／URL をローカルに戻す
- 第三者に常時見せる段階で、共有トークン運用をやめて per-user キーへ進む（別 ADR）

---

## 受け入れ条件

- [ ] `APPLIED_LOOP_URL`（非 localhost）+ `MCP_TOKEN` で `npm run mcp:cloud-config` が有効な設定を出す
- [ ] `/setup` の Cloud ウィザードが 選ぶ→トンネル→登録→疎通 の順で、トンネル未準備時は次へ進めない
- [ ] Claude は Web 用 `.mcp.json`（`type: http`）と CLI を分けて示す
- [ ] Codex は `bearer_token_env_var` を示す（トークン直書きしない）
- [ ] Cursor ではその URL へ Cloud から Bearer 付きで `morning_briefing` 相当が通る（dogfood 済み）
- [ ] Bearer なし / 誤トークンは 401
- [ ] 採点はトンネル先の手元プロセスで継続する（Cloud に CLI 不要）
