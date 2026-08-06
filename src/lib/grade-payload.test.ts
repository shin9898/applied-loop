import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGateDebrief,
  parseRootCause,
  rootCauseOneLiner,
} from "./grade-payload";

describe("buildGateDebrief tutorial fallback", () => {
  it("fills weakAspects from rubricCriteria when result empty", () => {
    const d = buildGateDebrief("もう少し具体が要る", null, {
      ensureAspects: true,
      rubricCriteriaJson: JSON.stringify([
        "具体的な場面が1つある",
        "動いたと説明できるの差に触れている",
      ]),
    });
    assert.ok(d.weakAspects.length >= 2);
    assert.equal(d.weakAspects[0]?.aspect, "具体的な場面が1つある");
    assert.ok(d.weakAspects[0]?.prompt.includes("具体的な場面"));
  });
});

describe("rootCauseOneLiner", () => {
  it("explains knowledge / verification / premise", () => {
    assert.match(rootCauseOneLiner("knowledge") ?? "", /知識不足/);
    assert.match(rootCauseOneLiner(parseRootCause("verification")) ?? "", /確認不足/);
    assert.match(rootCauseOneLiner("premise") ?? "", /前提/);
    assert.equal(rootCauseOneLiner(null), null);
  });
});
