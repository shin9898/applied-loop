#!/usr/bin/env node
/**
 * Propose stable-prefix harness pack alignment (ADR-0017).
 * Prints template paths + checklist. Never writes to the target repo.
 *
 * Usage: node scripts/propose-harness-prefix.mjs [repo-path]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(__dirname, "../docs/harness-pack");
const target = path.resolve(process.argv[2] ?? process.cwd());

const candidates = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursor/rules",
];

console.log(`# harness-prefix proposal (advisory only)\n`);
console.log(`target: ${target}`);
console.log(`pack:   ${packRoot}\n`);

for (const rel of candidates) {
  const p = path.join(target, rel);
  const exists = fs.existsSync(p);
  console.log(`- ${rel}: ${exists ? "found" : "missing"}`);
}

console.log(`\n## Templates (copy/adapt manually)`);
for (const t of [
  "templates/claude-stable-prefix.md",
  "templates/codex-stable-prefix.md",
  "templates/cursor-stable-prefix.mdc",
]) {
  console.log(`- ${path.join(packRoot, t)}`);
}

console.log(`\n## Checklist`);
console.log(`- [ ] Leading block has no dated / temporary notes`);
console.log(`- [ ] Long procedures are pointers, not pasted bodies`);
console.log(`- [ ] Variable section is below the stable prefix`);
console.log(`\nDo not force-write. See docs/harness-pack/README.md`);
