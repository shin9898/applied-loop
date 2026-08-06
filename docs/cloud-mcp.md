# Cloud Agent 向け Reachable MCP（1ページ設計）

ローカル dogfood を壊さず、**Cloud VM / リモートエージェントから同じ MCP ツール面を叩ける**ための薄い楔。  
フル SaaS・マルチテナントはしない。

関連: [ADR-0018](./adr/0018-reachable-mcp-cloud.md) · 登録手順の正本は引き続き [mcp-setup.md](./mcp-setup.md)。

---

## 問題

| 壊れる点 | 中身 |
|---|---|
| MCP | Cloud から `localhost:3100` に届かない |
| hook | Cloud worktree のコミットでは手元 git hook が発火しない |
| 採点 | Cloud 側に `claude`/`codex` CLI が無いことが多い |

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
| Bearer | `.env` の `MCP_TOKEN` |
| ルール | [mcp-setup.md §2](./mcp-setup.md) のスニペット（Cloud プロジェクトの Rules / AGENTS にも可） |

Cursor Cloud Agent の場合、エージェントが読める場所（Dashboard の MCP / リポジトリの `.cursor/mcp.json` 等）に **上記 URL + Bearer** を置く。stdio は使わない。

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

出てきた JSON / CLI / toml を Cloud Agent 側の MCP 設定に貼る。  
疎通確認: Cloud セッションで `morning_briefing` が返れば成功。

`/setup`（じゅんび）でも、Reachable URL が設定されていれば同じスニペットを表示する。

---

## 責任分界

```
[Cloud Agent] --HTTPS+Bearer--> [トンネル] --> [手元 Next /api/mcp]
                                              |-- SQLite に受理
                                              |-- after() でヘッドレス採点（手元 CLI）
[手元ブラウザ] ---------------- localhost ----> 同じアプリ（地図・ずかん）
```

- 合否は会話中に返さない（既存どおり `get_gate_result`）
- git hook が Cloud で動かなくても、学び・回答は MCP で本線が回る

---

## セキュリティ（個人楔の下限）

- トンネル URL は**秘密扱い**（ログ・PR・ブログに載せない）
- `MCP_TOKEN` は十分長い乱数。トンネル公開中は必須（未設定なら非ローカル Host からの MCP は 401）
- 使い終わったらトンネルを落とす／URL をローカルに戻す
- 第三者に常時見せる段階で、共有トークン運用をやめて per-user キーへ進む（別 ADR）

---

## 受け入れ条件

- [ ] `APPLIED_LOOP_URL`（非 localhost）+ `MCP_TOKEN` で `npm run mcp:cloud-config` が有効な設定を出す
- [ ] その URL へ Cloud（または別マシン）から Bearer 付きで `morning_briefing` 相当が通る
- [ ] Bearer なし / 誤トークンは 401
- [ ] 採点はトンネル先の手元プロセスで継続する（Cloud に CLI 不要）
