/**
 * brand-mark グリッドから SVG を書き出す。
 * Usage: npx tsx scripts/generate-brand-assets.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_GRID, BRAND_ROWS, renderBrandMarkSvg } from "../src/lib/brand-mark";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (let i = 0; i < BRAND_ROWS.length; i++) {
  if (BRAND_ROWS[i].length !== BRAND_GRID) {
    throw new Error(`row ${i} length ${BRAND_ROWS[i].length} !== ${BRAND_GRID}`);
  }
}
if (BRAND_ROWS.length !== BRAND_GRID) {
  throw new Error(`row count ${BRAND_ROWS.length} !== ${BRAND_GRID}`);
}

const out: [string, string][] = [
  ["public/brand/mark.svg", renderBrandMarkSvg({ size: 128, withBackground: true })],
  [
    "public/brand/mark-transparent.svg",
    renderBrandMarkSvg({ size: 128, withBackground: false }),
  ],
  ["src/app/icon.svg", renderBrandMarkSvg({ size: 32, withBackground: true })],
];

for (const [rel, svg] of out) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg, "utf8");
  console.log("wrote", rel);
}
