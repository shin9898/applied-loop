import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { surfaceIdFromHref, surfaceIdFromPathname } from "./atlas-surface-icons";

describe("atlas-surface-icons routing", () => {
  it("maps core and evidence hrefs", () => {
    assert.equal(surfaceIdFromHref("/"), "map");
    assert.equal(surfaceIdFromHref("/gates"), "gates");
    assert.equal(surfaceIdFromHref("/gates/abc"), "gates");
    assert.equal(surfaceIdFromHref("/retro/2026-08-10"), "retro");
    assert.equal(surfaceIdFromHref("/inbox/x"), "entries");
  });

  it("maps pathname the same way", () => {
    assert.equal(surfaceIdFromPathname("/harness/prescriptions/foo"), "harness");
  });
});
