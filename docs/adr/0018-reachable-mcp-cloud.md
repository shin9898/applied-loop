---
type: decision
status: accepted
date: 2026-08-06
tags: [mcp, cloud, distribution, architecture]
source_refs: [docs/cloud-mcp.md, docs/adr/0005-mcp-distribution.md, docs/adr/0010-action-surface-mcp.md]
---

# ADR-0018: Cloud Agent 向けは Reachable MCP（トンネル／公開 URL）で届ける

## 背景

LLM 作業がローカル端末だけでなく Cloud VM / リモートエージェント上で
走る流れが増えた。Applied Loop の前提（localhost MCP・ローカル git hook・
ローカル headless 採点）と衝突する。

ADR-0005 は「接続先 URL で環境を切り替える」と既に書いており、
公開用はデプロイ URL + per-user キーを想定していた。当面の dogfood では
フルホスト前に、**手元プロセスをトンネルで届ける**段階が必要。

## 決定

1. **薄い楔: Reachable MCP**  
   既存 `/api/mcp` を `APPLIED_LOOP_URL` または `MCP_PUBLIC_URL` で示す。
   ツール面・受理・非同期採点の契約は変えない。
2. **データと採点の正本はアプリ稼働ホスト**  
   Cloud は MCP クライアント。SQLite と `after(gradeGate)` はトンネル先。
3. **外に出した瞬間トークン必須**  
   非ローカル Host、または Reachable URL 設定時は `MCP_TOKEN` 無しを拒否。
4. **git hook はベストエフォート**  
   Cloud 本線はセッション内 capture / answer。hook 欠落を欠陥扱いにしない。
5. **運用手順の正本**  
   [docs/cloud-mcp.md](../cloud-mcp.md)。設定片は `npm run mcp:cloud-config`。
   UI は `/setup` の「Cloud で使いたい場合」ウィザード（選ぶ→トンネル→登録→疎通。LLM は最後のみ）。

## 理由

- ADR-0005 の「URL 切替」を実装に落とす最小変更
- フル SaaS / 認証プロダクト化より先に、自分の Cloud Agent dogfood が回る
- 採点を Cloud に移さないことで、合否非即時・CLI 依存の境界を維持できる

## 結果・トレードオフ

- 得られるもの: Cloud から同じツール面 / 手元採点の継続 / ドキュメント一本化
- 失うもの: トンネル運用の手作業、URL 漏洩リスク（個人・短命前提で受容）
- 将来: 常時公開時に per-user API キーとホスト移行（ADR-0005 公開用）へ

## 非目標

- マルチテナント SaaS
- 認証なしの公開デモ
- Cloud 上だけで完結する採点ワーカー（当面）
