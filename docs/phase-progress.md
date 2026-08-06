# コア1ループ Phase 進捗表（正本）

ADR: [0019-core-loop-phases.md](./adr/0019-core-loop-phases.md)  
更新ルール: 実装・検証が終わったら **同じ PR/コミットで** Status を変える。推測で `done` にしない。

Status: `todo` | `doing` | `done` | `blocked` | `wont`

---

## Phase 概要

| Phase | ねらい | 完了の定義 | Status |
|---|---|---|---|
| P0 | 渡せる土台 | クリーン環境＋1枚で30分以内に初回完走 | doing |
| P1 | 供給と検証 | 同僚1名無介入完走＋詰まり全クローズ | todo |
| P2 | 翌日以降 | D2以降自発回答＋再出題発火 | todo |
| P3 | 周辺復帰 | 一つずつ戻し指標悪化なし | todo |

---

## P0 — 渡せる土台（Must）

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B1-1 | MCP `MCP_SURFACE=core\|full`（既定 core） | done | 初回接続で見えるツール ≤6 | `src/lib/mcp-surface.ts`。core 4本（request_gate は P1） |
| B1-3 | コアツール description 全面書き直し | done | 貼る文後に list を自発呼び出しやすい文面 | route.ts の4本 |
| B2-1 | hook 1コマンド＋失敗時の次の一手 | done | setup-git-hook 一発、失敗で手順が出る | 引数なしで usage＋次の一手 |
| B2-2 | 供給失敗の可視化 | todo | setup 診断＋しれん空に理由 | |
| B3-1 | ナビをコア4面に縮小 | done | 初回ナビ ≤4 | ちず/しれん/ずかん/じゅんび＋一般語 |
| B3-2 | ホーム単一 CTA | todo | どの状態でも CTA 1個 | 次コミット |
| B4-1 | サンプルしれん質＋採点まで体験 | todo | 3分で提出、当日判定確認可 | |
| B4-2 | 貼る文統一＋ list_pending_gates を脚本に | done | 貼ってから初 MCP &lt;5分 | tutorialPastePrompt 先頭を list |
| B4-3 | 疎通直後に pending 非空保証 | todo | MCP 疎通時 pending≥1 or briefing 実データ | seed と連動 |
| B4-4 | 完了画面→供給の橋（hook） | done | 完了から1クリックで次へ | request_gate 分岐は P1 |
| B5-1 | 出題3点セット（Web/MCP） | doing | context→問い→リソース | MCP list 順は済。Web 側は未 |
| B5-2 | 採点状態4表示 | todo | 受理/採点中/CLEAR・miss/保留 | |
| B5-3 | 採点失敗リカバリ導線 | todo | 保留＋復帰手順 | |
| B6-1 | setup に採点疎通診断 | todo | ✓/✗ と復帰手順 | |
| B6-2 | `npm run setup` 等で起動集約 | done | clone→/setup までコマンド2個以内 | `npm run setup` + `dev:all` |
| B7-1 | 初 CLEAR/miss 後ずかん導線 | todo | 初回完走者がずかんを開く | |
| B7-2 | ずかん空状態 | todo | データゼロでも意味が伝わる | |
| B7-3 | しれん空を供給状態で出し分け | todo | 3状態で次の一手が違う | |
| B8-1 | DQ語＋一般語並記 | done | 用語表なしで完走 | ナビ title/plain |
| B9-1 | Activation ファネル記録 | todo | 7点がスクリプト1本で出る | |
| B9-2 | 主指標=初回完走率・時間 | todo | 完走定義がコード判定 | |
| B10-1 | 仲間向け1枚（README 冒頭） | done | その1枚だけで完走 | README「仲間向け・最短」 |
| B10-2 | 本 ADR（0019） | done | ADR 存在 | このファイルとセット |
| B12-3 | Cloud 青カードを初回視界から外す | done | 既定で閉じる／下げる | 明示オープンのみ |

### P0 完了チェック

- [ ] 上表の Must がすべて `done`（B10-2 除く既 done 以外）
- [ ] クリーン環境セルフラン 30分以内成功
- [ ] `docs/phase-progress.md` の P0 Status = done

---

## P1 — 供給と検証

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B1-2 | `request_gate`（diff 引数・非保存） | todo | hook なしで1しれん生成→回答 | |
| B1-4 | answer_gate 固定文言 | todo | 合否表現なし＋次アクション | |
| B2-3 | チュートリアル中スロットル免除 | todo | 当日初コミットで1件 | |
| B4-4b | 完了画面に request_gate 分岐追記 | todo | B4-4 の拡張 | |
| B4-5 | チュートリアル完了判定テスト | todo | 分岐網羅 | |
| B5-4 | 悪問スキップ理由 | todo | DB に残り集計可 | |
| B6-3 | MCP_TOKEN 自動生成 | todo | .env 編集なしで診断✓ | |
| B6-4 | Node/ポート preflight | todo | 不足時日本語理由 | |
| B11-1 | 出題 eval 回帰 | todo | 代表 diff 5件 | |
| B11-3 | サンプル miss 時フィードバック | todo | 観点別 | |
| B10-3 | 同僚1名ウォークスルー | todo | 無介入完走＋詰まりリスト | **P1 合否** |

### P1 完了チェック

- [ ] 上表すべて `done`
- [ ] 詰まり所全クローズ
- [ ] ファネル欠測ゼロ

---

## P2 — 翌日以降

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B3-3 | 段階開示（初 CLEAR で証跡面） | todo | 初回に露出せず解放される | |
| B5-5 | 再出題予告 | todo | CLEAR に次回日付 | |
| B9-3 | 供給健全性の週次化 | todo | 週次3数値 | |
| B10-4 | 別ハーネス検証 | todo | 2ハーネス目無介入 | |
| B11-2 | 採点再現性スポット | todo | 一致率測定 | |
| B12-1 | 再出題スケジューラ明文化＋実発火 | todo | 仲間環境で発火 | |
| B12-2 | 失敗ログ置き場一本化 | todo | docs に1行 | |
| B2-4 | event-queue 復帰手順 | todo | 再現・復帰可 | |
| — | briefing を今日のしれん＋昨日の判定に | todo | 冒頭に単一推奨 | |

### P2 完了チェック

- [ ] D2以降自発回答あり
- [ ] 再出題≥1 発火・回答
- [ ] open 誤解≥1

---

## P3 — 周辺復帰（一括禁止）

| ID | 項目 | Status | 完了条件（要約） | メモ |
|---|---|---|---|---|
| B1-5 | full 解放条件ドキュメント | todo | docs に1行ずつ | |
| B12-4 | harness 復帰（観測→canon） | todo | コア指標悪化なし | 1つずつ |
| B12-5 | goals / requirements 復帰 | todo | 同上 | |
| B12-3b | Cloud MCP 導線復帰 | todo | 同上 | |
| — | 4象限・週次/音声 | todo | 同上 | |

各復帰の前後で Activation / 回答率を記録すること。

---

## Should / Could（Phase 任意枠・忘れ防止）

| ID | Phase 目安 | Status | 項目 |
|---|---|---|---|
| B3-4 | P0〜P1 | todo | lp/setup/onboarding 文言同期監査 |
| B6-5 | P1 | todo | DB リセット1コマンド |
| B7-4 | P2 | todo | 根因分類の1行説明 |
| B8-2 | P0〜P1 | todo | コア面の内部語ゼロ監査 |

---

## Won't（今はやらない・再議論禁止に近い）

| 内容 | 理由 |
|---|---|
| request_gate 以外の供給乱立 | 初週は hook＋会話の2本で十分 |
| ツール物理削除 | 隠すだけ。本人運用を壊さない |
| SaaS / マルチユーザー | 各自ローカル clone |
| サンプル複数問・コース化 | 学習コンテンツ非作成 |
| DQ 演出強化 | コア完走を助けない |
| Obsidian 初回必須 | 前提が重い |
| ルールベース採点 fallback | NSM 汚染防止 |
| ADR 歴史改ざん | 追記のみ |

---

## 変更ログ

| 日付 | 内容 |
|---|---|
| 2026-08-06 | 初版。ADR-0019 と同時作成。P0 = doing |
| 2026-08-06 | P0 着手: B1-1/1-3, B2-1, B3-1, B4-2/4-4, B6-2, B8-1, B10-1/10-2, B12-3 |
