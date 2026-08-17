# Applied Loop — はじめの道案内（正本）

ゼロから最初の価値までの道。UI の「じゅんび」（`/setup`）・README・LP は **この文書を正本** とする。

MCP の登録手順の詳細は [mcp-setup.md](./mcp-setup.md)。  
Cloud Agent から使う場合は [cloud-mcp.md](./cloud-mcp.md)（Reachable MCP）。

---

## 最短チュートリアル（初心者・まずここ）

LLM を入れたばかりでも、**ツール名を覚えなくてよい**。順番だけ守る。

| # | やること | 終わったサイン |
|---|---|---|
| 0 | アプリ起動 + `.env` に `MCP_TOKEN`（推奨: `ENABLE_TERMINAL=true`） | `/setup` で合言葉が ✓ |
| 1 | **サンプルしれんを Web で1問提出** | 『たたかう』→『提出する』→自動でじゅんびに戻る。合否は待たなくてよい |
| 2 | **自分の LLM を選ぶ**（Claude / Cursor / Codex / じゅもん） | `/setup` でつなぐ道を選択（この時刻より前の MCP 疎通はカウントしない） |
| 3 | **自分の LLM に MCP をつなぐ**（貼る文を1回） | 選択後の MCP 疎通、または「できた」。これが「自分の LLM とつなぐ」本体 |
| 4 | （任意）**監視リポジトリを選んで** 鉤をかける | `/setup` で repo パスを追加→鉤をかける。未選択のままではコミットからしれんは増えない。Cloud 作業が主なら飛ばしてよい |
| — | （任意）Cloud の生成AIからも | `/setup` 青いカード『Cloud の生成AIからも同じループ』（選ぶ→トンネル→登録→疎通）。正本 [cloud-mcp.md](./cloud-mcp.md) |

画面: ホームのバナー → **じゅんび（`/setup`）**。ウィザードが「いまやる1手」だけを大きく出す。

```bash
npm run setup          # preflight / install / .env生成 / migrate / sample seed
                        # → 採点CLI(claude/codex)の検出状況を表示
                        # → 使う LLM クライアントを選ぶと MCP 登録コマンドをそのまま表示
npm run dev:all        # http://localhost:3100  +  WS :3101
```

`npm run setup` の最後に出る MCP 登録コマンドは `.env` の実際の `MCP_TOKEN` が埋め込み済みなので、選んだクライアントにそのまま貼り付ければ #3 が完了する（詳細・他クライアント分は [mcp-setup.md](./mcp-setup.md)）。

手動でバラす場合は README「クイックスタート」へ。サンプルデータは `/setup` を開いたときにも入る。手動なら:

```bash
npm run seed:tutorial
```

### 用語（UI → 意味）

| UI | 意味 |
|---|---|
| ぼうけんのしょ | Web ダッシュボード |
| きょうのしょ | 日次教科書（材料→章→確認→Mastery。`/retro`） |
| しれん | 理解度チェック（出題。過渡期の即時経路） |
| じゅもん | アプリ内から LLM／MCP を開く導線 |
| ずかん | つまずき／誤解の一覧 |
| じゅんび | このチュートリアル画面（`/setup`） |
| たたかう | しれんの解答画面へ |

### なぜ最初は Web で解くのか

操作の正典は MCP だが、初日に MCP 登録で止まると価値に届かない。  
**最初の1勝だけ Web の提出**で体験し、同じ受理の道をあとから LLM 経由でも使う。

---

## 本運用（①つなぐ → ②集める → ③進める）

チュートリアル後の日常ループ（正本は [ADR-0020](./adr/0020-daily-retro-knowledge-loop.md)）。

| # | 名前 | やること | 終わったサイン |
|---|---|---|---|
| ① | **つなぐ** | アプリ + TOKEN + LLM に MCP 登録 | 外部 LLM からツールが見える |
| ② | **集める** | 監視 hook / capture。材料は無制限に残す | DevEvent・学び候補が増える（即時しれんが backlog でも材料は消えない） |
| ③ | **進める** | 夜 or 朝にきょうのしょ → 確認 → Mastery。朝は briefing / ちず CTA | Mastery が付き、翌日の一手が状態で変わる |

即時しれんは互換経路。溜まったら `/gates` で『あとまわし』／『閉じる』。本線は `/retro`。  
推奨操作経路は外部 LLM かアプリ内じゅもん経由の MCP。バトルの『提出する』も同じ受理経路。

### ① つなぐ（詳細）

1. 起動（上記 `dev:all`）
2. MCP を LLM に登録 → [mcp-setup.md](./mcp-setup.md)
3. UI じゅもん（任意）: `ENABLE_TERMINAL=true` で各画面の『じゅもんをとなえる』

### ② 集める（詳細）

ルールスニペットは [mcp-setup.md §2](./mcp-setup.md)。  
監視リポジトリ + git hook（推奨: UI）:

1. `/setup` の『監視リポジトリ』にパスを追加（例: `~/Desktop/triplethree/triple-onboarding`）
2. 『鉤をかける』→ 診断が「監視中」になる
3. その repo での **ローカル commit** が**材料**になる（即時しれんは backlog で止まることがあるが、材料は残る）

CLI でも可:

```bash
./scripts/setup-git-hook.sh /path/to/your-repo
```

登録一覧は `~/.applied-loop/watched-repos.json`。

### ③ 進める（詳細）

1. 夜 or 朝: `/retro` できょうのしょを生成・読む
2. 確認モードで Mastery（clear / partial / stuck / parked）を付ける
3. 朝: `morning_briefing` またはちずの「いまの一手」（Mastery 導線がしれんより先）
4. stuck はずかん、partial は教科書の再問。過渡期の pending しれんは `/gates` で解くかあとまわし

---

## UI での案内

| 場所 | 内容 |
|---|---|
| 初回モーダル | 1枚＋『じゅんびへ』 |
| ホーム | 必須欠け／チュートリアル未完のとき1行バナー → `/setup` |
| `/setup`（じゅんび） | 進行つきウィザード＋診断詳細＋用語表 |

## 診断項目との対応

| 診断 | この文書 |
|---|---|
| MCP_TOKEN | 最短 #0 |
| サンプルしれん提出 | 最短 #1 |
| MCP 疎通／できた（自分の LLM 接続） | 最短 #2〜3 |
| チュートリアル完了 | 最短 #1〜4 |
| 監視リポジトリ / git hook | 本運用 ②（任意）。未選択＝自動蓄積なし |
| じゅもん WS | 最短でじゅもん道を選ぶ場合 |

---

## やらないこと（境界）

- 会話本文・コード断片をクラウドに溜めない（ハーネスはメタデータのみ）
- プロジェクトルールへの強制書き込みをしない
- タスク管理の正典にならない（Hermes/TODO 側）
