# 面・周辺の解放条件（P3 B1-5）

隠す≠捨てる。いつ視界に戻すかを1行ずつ固定する（ADR-0019）。

## MCP 面

| 対象 | 解放条件 |
|---|---|
| core 5本（`morning_briefing` / `list_pending_gates` / `request_gate` / `answer_gate` / `get_gate_result`） | 既定（`MCP_SURFACE` 未設定 or `core`） |
| `capture_learning_candidate` / `triage_inbox` / `record_application` / `find_related_learnings` | `MCP_SURFACE=full` |
| goals 系（`register_goals` / `update_goal` / `list_goals` / `link_goal` 等） | `MCP_SURFACE=full` |
| requirements 系（`register_requirement` / `list_requirements` / `link_requirement` 等） | `MCP_SURFACE=full` |
| `suggest_cache_prefix_fix` | `MCP_SURFACE=full`（UI のどうぐ `/harness` は別フラグ） |
| `enrich_gate_places` / `save_task_mappings` | `MCP_SURFACE=full` |

MCP の物理的な出し分けは **`MCP_SURFACE` のみ**。`/harness` を開いても full ツールは増えない。

## UI ナビ

| 対象 | 解放条件 |
|---|---|
| コア4面（ちず / しれん / ずかん / じゅんび） | 初回から |
| 証跡ナビ（にっき / もくひょう / どうぐ / ようけん） | 初 CLEAR（サンプル以外）後に**一括**（`hasFirstClear`） |
| Cloud ウィザード本体 | 明示オープンのみ（既定たたみ・B12-3）。コア完走後に CTA 強調（B12-3b） |
| 4象限 | `/zukan` 内（ホーム CTA は増やさない） |
| 週次ナレーション | `/entries` → `/digest`（`docs/digest/weekly/` を表示）。音声化は外出し |

## 「一括禁止」の意味（2026-08-06 追記）

- **禁止するのは** `MCP_SURFACE=full` の既定化と、Cloud ウィザードの既定オープン。
- **証跡4面**（にっき／もくひょう／どうぐ／ようけん）は実装上 `hasFirstClear` 1フラグで同時解放する（細かい5段フラグは持たない）。
- 下の「復帰作業順」はドキュメント整備・観測復帰の**作業順番**であり、UI の段階フラグ実装ではない。

## 復帰作業順（観測・ドキュメント）

1. 本ドキュメント（B1-5）  
2. harness 観測グラフ → canon リンク（B12-4）  
3. goals / requirements ナビ確認（B12-5）  
4. Cloud 導線強調（B12-3b・既定オープンには戻さない）  
5. 4象限 → 週次リンク  

各ステップの前後で Activation / 回答率を見て、悪化したら再降格。

詳細手順: [mcp-setup.md](./mcp-setup.md) · [ops-logs.md](./ops-logs.md) · [cloud-mcp.md](./cloud-mcp.md)
