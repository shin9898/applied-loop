import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTaskMappings } from "./task-map";

describe("parseTaskMappings", () => {
  it("accepts valid mappings and trims fields", () => {
    const { mappings, warnings } = parseTaskMappings([
      {
        task: "  deploy fix  ",
        related: [
          { type: "entry", id: " e1 ", reason: " related " },
          { type: "gate", id: "g1" },
        ],
      },
    ]);
    assert.equal(warnings.length, 0);
    assert.deepEqual(mappings, [
      {
        task: "deploy fix",
        related: [
          { type: "entry", id: "e1", reason: "related" },
          { type: "gate", id: "g1", reason: undefined },
        ],
      },
    ]);
  });

  it("drops bad elements and records warnings", () => {
    const { mappings, warnings } = parseTaskMappings([
      null,
      { task: "" },
      { task: "ok", related: [{ type: "nope", id: "x" }] },
      "string",
    ]);
    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].task, "ok");
    assert.equal(mappings[0].related.length, 0);
    assert.ok(warnings.length >= 3);
  });

  it("rejects non-array root", () => {
    const { mappings, warnings } = parseTaskMappings({ task: "x" });
    assert.equal(mappings.length, 0);
    assert.match(warnings[0] ?? "", /配列/);
  });
});
