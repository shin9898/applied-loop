#!/usr/bin/env node
/**
 * ADR-0016: プロンプトキャッシュ正典の誤解シード + module ゲートを冪等投入
 * 使い方: npx tsx scripts/seed-prompt-cache-module.ts
 */
import { ensurePromptCacheModuleGates } from "../src/lib/harness-canon";

async function main() {
  const result = await ensurePromptCacheModuleGates();
  console.log(
    JSON.stringify(
      { ok: true, createdGates: result.created, gateIds: result.gateIds },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
