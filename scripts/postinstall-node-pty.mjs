#!/usr/bin/env node
/** node-pty の spawn-helper に実行ビットを付ける (ADR-0015) */
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = join(
  root,
  "node_modules/node-pty/prebuilds",
  `${process.platform}-${process.arch}`,
  "spawn-helper"
);
if (existsSync(helper)) {
  chmodSync(helper, 0o755);
}
