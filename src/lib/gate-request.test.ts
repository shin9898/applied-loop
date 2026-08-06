import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIFF_MAX_CHARS,
  hasRequiredGateArtifacts,
  truncateDiffForGate,
} from "./gate";

describe("hasRequiredGateArtifacts", () => {
  it("requires both rubric and resources", () => {
    assert.equal(
      hasRequiredGateArtifacts({
        rubric: ["観点"],
        resources: [{ kind: "doc", label: "x", ref: "https://example.com" }],
      }),
      true,
    );
    assert.equal(
      hasRequiredGateArtifacts({ rubric: ["観点"], resources: null }),
      false,
    );
    assert.equal(
      hasRequiredGateArtifacts({
        rubric: null,
        resources: [{ kind: "doc", label: "x", ref: "https://example.com" }],
      }),
      false,
    );
  });
});

describe("truncateDiffForGate", () => {
  it("returns empty for blank", () => {
    assert.equal(truncateDiffForGate("   "), "");
  });

  it("keeps short diffs intact", () => {
    const d = "diff --git a/x b/x\n+hello";
    assert.equal(truncateDiffForGate(d), d);
  });

  it("truncates over DIFF_MAX_CHARS and marks truncated", () => {
    const d = "x".repeat(DIFF_MAX_CHARS + 50);
    const out = truncateDiffForGate(d);
    assert.ok(out.endsWith("...(truncated)"));
    assert.ok(out.length < d.length);
    assert.ok(out.length <= DIFF_MAX_CHARS + "\n...(truncated)".length);
  });
});
