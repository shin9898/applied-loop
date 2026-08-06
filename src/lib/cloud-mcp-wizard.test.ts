import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloudTunnelReady,
  cloudVerifyDetected,
  cloudWizardCanAdvance,
  defaultCloudWizardState,
  nextCloudWizardStep,
  parseCloudWizardState,
  prevCloudWizardStep,
} from "./cloud-mcp-wizard";

describe("cloud-mcp-wizard", () => {
  it("parses and defaults state", () => {
    assert.deepEqual(parseCloudWizardState(null), defaultCloudWizardState());
    assert.equal(parseCloudWizardState({ client: "cursor", step: "tunnel" }).client, "cursor");
    assert.equal(parseCloudWizardState({ client: "nope", step: "x" }).step, "pick");
  });

  it("requires reachable + token for tunnel", () => {
    assert.equal(cloudTunnelReady({ reachable: true, tokenConfigured: true }), true);
    assert.equal(cloudTunnelReady({ reachable: true, tokenConfigured: false }), false);
    assert.equal(cloudTunnelReady({ reachable: false, tokenConfigured: true }), false);
  });

  it("detects MCP after verifyEnteredAt", () => {
    assert.equal(
      cloudVerifyDetected({
        verifyEnteredAt: "2026-08-06T00:00:00.000Z",
        mcpLastAt: "2026-08-06T00:01:00.000Z",
      }),
      true,
    );
    assert.equal(
      cloudVerifyDetected({
        verifyEnteredAt: "2026-08-06T00:02:00.000Z",
        mcpLastAt: "2026-08-06T00:01:00.000Z",
      }),
      false,
    );
    assert.equal(
      cloudVerifyDetected({
        verifyEnteredAt: "2026-08-06T00:00:00.000Z",
        mcpLastAt: null,
        verifiedAt: "2026-08-06T00:03:00.000Z",
      }),
      true,
    );
  });

  it("gates advance per step", () => {
    const tunnel = { reachable: true, tokenConfigured: true };
    assert.equal(
      cloudWizardCanAdvance("pick", { client: null, step: "pick" }, tunnel),
      false,
    );
    assert.equal(
      cloudWizardCanAdvance("pick", { client: "cursor", step: "pick" }, tunnel),
      true,
    );
    assert.equal(
      cloudWizardCanAdvance(
        "tunnel",
        { client: "cursor", step: "tunnel" },
        { reachable: false, tokenConfigured: true },
      ),
      false,
    );
    assert.equal(
      cloudWizardCanAdvance(
        "register",
        { client: "cursor", step: "register", registeredAt: "t" },
        tunnel,
      ),
      true,
    );
  });

  it("navigates steps", () => {
    assert.equal(nextCloudWizardStep("pick"), "tunnel");
    assert.equal(nextCloudWizardStep("verify"), "done");
    assert.equal(nextCloudWizardStep("done"), null);
    assert.equal(prevCloudWizardStep("tunnel"), "pick");
    assert.equal(prevCloudWizardStep("pick"), null);
  });
});
