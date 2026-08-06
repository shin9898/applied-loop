import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveHomeCta } from "./home-cta";

describe("resolveHomeCta", () => {
  it("setup when essentials missing", () => {
    const cta = resolveHomeCta({
      essentialsReady: false,
      tutorialSampleSubmitted: false,
      tutorialReady: false,
      pendingGateId: "g1",
      gitHookInstalled: true,
    });
    assert.equal(cta.kind, "setup");
    assert.equal(cta.href, "/setup");
  });

  it("fight when pending after tutorial", () => {
    const cta = resolveHomeCta({
      essentialsReady: true,
      tutorialSampleSubmitted: true,
      tutorialReady: true,
      pendingGateId: "g1",
      pendingGateTitle: "題",
      gitHookInstalled: false,
    });
    assert.equal(cta.kind, "fight");
    assert.equal(cta.href, "/gates/g1");
  });

  it("hook when no pending and no hook", () => {
    const cta = resolveHomeCta({
      essentialsReady: true,
      tutorialSampleSubmitted: true,
      tutorialReady: true,
      pendingGateId: null,
      gitHookInstalled: false,
    });
    assert.equal(cta.kind, "hook");
  });

  it("wait when hook installed and no pending", () => {
    const cta = resolveHomeCta({
      essentialsReady: true,
      tutorialSampleSubmitted: true,
      tutorialReady: true,
      pendingGateId: null,
      gitHookInstalled: true,
    });
    assert.equal(cta.kind, "wait");
  });
});
