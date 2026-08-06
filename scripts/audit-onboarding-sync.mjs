#!/usr/bin/env node
/**
 * B3-4: onboarding.md（正本）と README / LP / setup UI の文言ドリフト検出。
 * Usage: npm run audit:onboarding
 * exit 1 = 欠けあり
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  {
    path: "docs/onboarding.md",
    must: ["npm run setup", "サンプルしれん", "貼る", "/setup"],
  },
  {
    path: "README.md",
    must: ["npm run setup", "サンプルしれん", "貼る", "list_pending_gates"],
  },
  {
    path: "src/app/(marketing)/lp/page.tsx",
    must: ["/setup", "サンプル", "貼る"],
  },
  {
    path: "src/components/living-atlas/atlas-onboarding.tsx",
    must: ["サンプルしれん", "貼る"],
  },
];

let failed = 0;
for (const t of targets) {
  const full = resolve(root, t.path);
  if (!existsSync(full)) {
    console.error(`✗ missing file: ${t.path}`);
    failed++;
    continue;
  }
  const text = readFileSync(full, "utf8");
  const missing = t.must.filter((m) => !text.includes(m));
  if (missing.length) {
    console.error(`✗ ${t.path}`);
    for (const m of missing) console.error(`    欠: ${JSON.stringify(m)}`);
    failed++;
  } else {
    console.log(`✓ ${t.path}`);
  }
}

if (failed) {
  console.error(`\n${failed} ファイルが正本とズレている。docs/onboarding.md に合わせて直せ。`);
  process.exit(1);
}
console.log("\nonboarding 同期: OK");
