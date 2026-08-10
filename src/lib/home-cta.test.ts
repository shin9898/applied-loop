import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveHomeCta } from "./home-cta";
import type { TextbookGuidance } from "./textbook-guidance";

const stuckGuidance: TextbookGuidance = {
  kind: "stuck",
  href: "/zukan",
  label: "ずかんへ",
  title: "昨日のつまずきをずかんで追う",
  body: "stuck あり",
  briefingLine: "stuck",
  dateKey: "2026-08-09",
  counts: {
    clear: 0,
    partial: 0,
    stuck: 1,
    parked: 0,
    unanswered: 0,
    total: 1,
  },
};

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

  it("textbook mastery beats pending fight", () => {
    const cta = resolveHomeCta({
      essentialsReady: true,
      tutorialSampleSubmitted: true,
      tutorialReady: true,
      pendingGateId: "g1",
      gitHookInstalled: true,
      textbookGuidance: stuckGuidance,
    });
    assert.equal(cta.kind, "textbook");
    assert.equal(cta.href, "/zukan");
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

  it("wait points to retro when hook installed and no pending", () => {
    const cta = resolveHomeCta({
      essentialsReady: true,
      tutorialSampleSubmitted: true,
      tutorialReady: true,
      pendingGateId: null,
      gitHookInstalled: true,
    });
    assert.equal(cta.kind, "wait");
    assert.equal(cta.href, "/retro");
  });
});
