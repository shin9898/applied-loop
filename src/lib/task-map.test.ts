import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTaskMappings, pickTaskMapDisplay } from "./task-map";

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

describe("pickTaskMapDisplay", () => {
  const today = { dateKey: "2026-08-05", tasks: [{ task: "a" }] };
  const yesterday = { dateKey: "2026-08-04", tasks: [{ task: "b" }] };
  const empty = { dateKey: "2026-08-05", tasks: [] as { task: string }[] };

  it("prefers today when present", () => {
    const r = pickTaskMapDisplay(today, yesterday);
    assert.equal(r.source, "today");
    assert.equal(r.map, today);
  });

  it("falls back to yesterday when today empty", () => {
    const r = pickTaskMapDisplay(empty, yesterday);
    assert.equal(r.source, "yesterday");
    assert.equal(r.map, yesterday);
  });

  it("returns none when both empty", () => {
    const r = pickTaskMapDisplay(empty, { ...yesterday, tasks: [] });
    assert.equal(r.source, "none");
    assert.equal(r.map, null);
  });
});
