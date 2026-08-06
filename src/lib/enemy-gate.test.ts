import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_ENEMIES,
  enemyForGate,
  enemyForSystem,
} from "@/components/living-atlas/atlas-enemies";

describe("enemy roster", () => {
  it("has 10 distinct kinds", () => {
    assert.equal(ALL_ENEMIES.length, 10);
    const ids = new Set(ALL_ENEMIES.map((e) => e.id));
    assert.equal(ids.size, 10);
  });

  it("maps each SystemKind to a sprite", () => {
    for (const system of [
      "cache",
      "harness",
      "design",
      "ops",
      "knowledge",
      "verification",
      "premise",
      "other",
    ] as const) {
      assert.equal(enemyForSystem(system).id, system);
    }
  });

  it("prefers auth keywords over system", () => {
    const e = enemyForGate({
      system: "ops",
      text: "OIDC のログイン障害を切り分けよ",
    });
    assert.equal(e.id, "auth");
  });

  it("picks fog for empty clues", () => {
    const e = enemyForGate({ system: "other", text: "" });
    assert.equal(e.id, "fog");
  });
});
