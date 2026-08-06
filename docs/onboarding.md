# Applied Loop — はじめの道案内（正本）

ゼロから最初の価値（朝の briefing → しれん 1 問）までの最短路。  
UI の「はじめの道案内」パネル・README・LP は **この文書を正本** とする。

MCP の登録手順の詳細は [mcp-setup.md](./mcp-setup.md)。

## 所要の全体像（3 ステップ）

| # | 名前 | やること | 終わったサイン |
|---|---|---|---|
| ① | **つなぐ** | アプリ起動 + `MCP_TOKEN` + LLM に MCP 登録 | ホーム診断で必須が ✓、外部 LLM からツールが見える |
| ② | **集める** | ルールスニペット + git hook | コミットでしれんが増える／学びが受信箱に入る |
| ③ | **進める** | `morning_briefing` → たたかう／じゅもん | CLEAR または学びの証跡が 1 件残る |

操作の正典は **MCP**（ADR-0010）。アプリのバトル「こたえる」も使えるが、推奨経路は外部 LLM かアプリ内じゅもん経由の MCP。

---

## ① つなぐ

### 1. 起動

```bash
cp .env.example .env   # 無ければ手で .env を作る
# MCP_TOKEN=<長い乱数>
# ENABLE_TERMINAL=true   # UI じゅもんを使うなら
npm install
npx prisma migrate dev
npm run dev:all          # Next :3100 + terminal WS :3101
```

ブラウザ: http://localhost:3100

### 2. MCP を LLM に登録

[mcp-setup.md](./mcp-setup.md) の Claude Code / Cursor / Codex 節に従う。  
エンドポイント: `http://localhost:3100/api/mcp`（Bearer = `MCP_TOKEN`）。

### 3. UI じゅもん（任意）

`ENABLE_TERMINAL=true` で `dev:all` していれば、各画面の「じゅもんをとなえる」から同じ MCP 経路を開ける。

---

## ② 集める

### ルールスニペット

CLAUDE.md / Cursor Rules / Codex AGENTS に [mcp-setup.md §2](./mcp-setup.md) の文を追記。  
朝は `morning_briefing`、ふりかえりは `capture_learning_candidate`。

### git hook（しれん自動生成）

```bash
./scripts/setup-git-hook.sh /path/to/your-repo
```

`~/.applied-loop/hooks/post-commit` が入り、コミットを DevEvent → Gate 候補に流す。

---

## ③ 進める

1. LLM またはじゅもんで **`morning_briefing`**
2. 受信箱があれば **`triage_inbox`**
3. 任務×学びを残すなら **`save_task_mappings`**（空の朝対策）
4. ホームの『たたかう』またはじゅもんでしれんへ → **`answer_gate`** → 合否は **`get_gate_result`**

---

## UI での案内

| 場所 | 内容 |
|---|---|
| 初回のみモーダル | 地図・じゅもん・たたかうの世界観（ページ自動遷移なし） |
| ホーム | 必須欠けのときだけ1行バナー → `/setup` |
| `/setup`（コマンド「じゅんび」） | 診断フル＋3ステップ。正本はこの文書 |

## 診断項目との対応

| 診断項目 | この文書の節 |
|---|---|
| アプリが動いている | ①-1 |
| MCP_TOKEN | ①-1 |
| じゅもん有効 / WS :3101 | ①-3 |
| git post-commit hook | ② hook |
| しれんが1件以上 | ② hook 後のコミット、または既存データ |
| 学びの軌跡 | ③ capture |

---

## やらないこと（境界）

- 会話本文・コード断片をクラウドに溜めない（ハーネスはメタデータのみ）
- プロジェクトルールへの強制書き込みをしない（キャッシュ処方は提案のみ）
- タスク管理の正典にならない（Hermes/TODO 側。サーバーは DailyTaskMap のみ）
