# ハーネスパック: 安定プレフィックス（ADR-0017）

プロンプトキャッシュを効かせるための **横断規約**。適用は本人が差分を採択する。
強制上書きしない。原理は `/harness/concepts/prompt-cache`。

## 何が問題か

毎回短い指示でも、先頭に載る長い文脈（CLAUDE.md / AGENTS.md / Cursor rules）が
バイト単位で変わると、その後ろのキャッシュも無効になる。

## 安定プレフィックスの順序

先頭から後ろへ（不変 → 可変）:

1. **Identity** — 誰向けか・短い役割（めったに変えない）
2. **不変の作業方針** — 短い箇条書き（ポインタ優先、全文コピペしない）
3. **ツール横断ポインタ** — skill / hook への一行参照
4. **ここから後ろ（可変）** — プロジェクト固有・日付・一時的な制約

可変ブロックを先頭に置くと、毎回キャッシュが壊れやすい。

## ファイル配置（提案先）

| ハーネス | 典型パス | テンプレ |
|---|---|---|
| Claude Code | `CLAUDE.md`（repo 根）または `~/.claude/CLAUDE.md` の短い節 | [templates/claude-stable-prefix.md](templates/claude-stable-prefix.md) |
| Codex | `AGENTS.md` | [templates/codex-stable-prefix.md](templates/codex-stable-prefix.md) |
| Cursor | `.cursor/rules/*.mdc`（短い rule） | [templates/cursor-stable-prefix.mdc](templates/cursor-stable-prefix.mdc) |

## チェックリスト（trim / 安定）

- [ ] 先頭ブロックは先週と同じ並び・同じ文言か（日付・一時メモを先頭に足していないか）
- [ ] 「今日だけ」「今週の Issue」は先頭ではなく、会話または可変節の後ろか
- [ ] 長い手順書は skill / ドキュメントへのポインタに置き換えたか
- [ ] ツール定義や MCP 一覧を毎セッション全文で増やしていないか
- [ ] 変更したら `/harness` で当該 repo の cache read 率を翌週確認する

## 適用手順

1. 対象 repo で現状の先頭ファイルを読む
2. テンプレと突き合わせ、**提案 diff** を出す（自動書き込みしない）
3. 本人が採択したら、Applied Loop で `record_application`（`appliedTo` に repo）
4. 悪化している repo は AL の処方 UI / `suggest_cache_prefix_fix` も併用

my-copy: `/my-copy-harness-prefix-pack`
