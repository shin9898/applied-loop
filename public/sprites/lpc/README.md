# LPC 由来スプライト（人型キャラ専用）

このフォルダは Universal LPC Spritesheet Generator
（https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/）
で生成した「人型キャラクター」のスプライトだけを置く場所。

Living Atlas の他のドット絵（アイコン・モンスター・ペット等）は
`src/app/atlas-living.css` の `.atlas-px-*` / `<rect>` ベースの自前描画のまま。
LPC はここに限定し、混ぜない。

## 収録物

- `self-avatar-idle-1.png` / `self-avatar-idle-2.png` — ちずマーカーに使う、正面向き idle の
  2 フレーム（64x64px）。交互に出して呼吸アニメーションにする
- `self-avatar-walk.png` — 同キャラの全アニメーション込みマスターシート（832x3456px）。
  将来 4 方向の歩行等を使うときの元データとして保持
- `self-avatar-credits.txt` — 上記の生成時に発行された、パーツごとの正式なクレジット原文

## ライセンス

各パーツは OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 2.0 or 3.0 のいずれかを選べる複数ライセンス
（作者がどれか一つを選んで遵守すればよい）。本プロジェクトは **OGA-BY 3.0**
（帰属表示のみで足りる、コピーレフト無し）を選んで遵守する。

## 帰属表示（OGA-BY 3.0 準拠）

body: bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert,
Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani,
Johannes Sjölund (wulax), Stephen Challener (Redshrike)

head: bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike)

face/expression: JaidynReiman, ElizaWy, Stephen Challener (Redshrike)

hair (spiked): kcilds/Rocetti/Eredah

torso (leather armour): Johannes Sjölund (wulax), bluecarrot16, JaidynReiman

legs (pants): JaidynReiman, ElizaWy, bluecarrot16, Johannes Sjölund (wulax),
Stephen Challener (Redshrike)

feet (basic boots): JaidynReiman, bluecarrot16, Nila122

原典・詳細クレジットは `self-avatar-credits.txt` を参照。アプリ内の
表示箇所（例: 設定画面のクレジット、フッター）にもこの帰属表示を出すこと。
