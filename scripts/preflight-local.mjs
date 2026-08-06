#!/usr/bin/env node
/**
 * Node / ポート preflight（B6-4）。
 * 不足時は日本語で理由を出して exit 1。
 *
 * Usage:
 *   node scripts/preflight-local.mjs           # Node のみ
 *   node scripts/preflight-local.mjs --ports   # Node + 3100/3101 空き確認
 */
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MIN_MAJOR = 20;
const PORTS = [3100, 3101];
const checkPorts = process.argv.includes("--ports");

function nodeMajor() {
  const m = /^v?(\d+)/.exec(process.version);
  return m ? Number(m[1]) : 0;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

const major = nodeMajor();
if (major < MIN_MAJOR) {
  console.error(
    `Node.js の版が足りない: いま ${process.version}。v${MIN_MAJOR} 以上が必要じゃ。`,
  );
  console.error(
    "  直し方: https://nodejs.org/ か nvm / mise で Node 20+ を入れる。",
  );
  process.exit(1);
}
console.log(`Node: ${process.version}（≥${MIN_MAJOR} ✓）`);

if (checkPorts) {
  let busy = 0;
  for (const port of PORTS) {
    const free = await portFree(port);
    if (!free) {
      busy += 1;
      console.error(
        `ポート ${port} はすでに使われておる。\`npm run dev:all\` が二重起動か、別プロセスが占有しておるぞ。`,
      );
      console.error(
        `  直し方: lsof -iTCP:${port} -sTCP:LISTEN で PID を見て止める。`,
      );
    } else {
      console.log(`port ${port}: 空き ✓`);
    }
  }
  if (busy > 0) process.exit(1);
}

try {
  const pkg = require("../package.json");
  if (pkg.engines?.node) {
    console.log(`engines.node: ${pkg.engines.node}`);
  }
} catch {
  /* ignore */
}

console.log("preflight: ok");
