import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRAND_COLORS,
  BRAND_GRID,
  BRAND_ROWS,
  renderBrandMarkSvg,
} from "./brand-mark";

describe("brand-mark", () => {
  it("is a filled 32x32 grid", () => {
    assert.equal(BRAND_ROWS.length, BRAND_GRID);
    for (const [i, row] of BRAND_ROWS.entries()) {
      assert.equal(row.length, BRAND_GRID, `row ${i}`);
    }
  });

  it("renders svg with navy background and pixel rects", () => {
    const svg = renderBrandMarkSvg({ size: 32, withBackground: true });
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.match(svg, new RegExp(`fill="${BRAND_COLORS.N}"`));
    assert.match(svg, /<rect x="/);
  });
});
