import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_FINGERPRINT_ENV,
  HARNESS_CONTEXT_FINGERPRINT_VERSION,
  createHarnessContextFingerprint,
  isHarnessContextFingerprint,
} from "../../scripts/harness-context-fingerprint.mjs";

test("context fingerprint is stable for the same collector-visible cohort", () => {
  const first = createHarnessContextFingerprint({
    harness: "codex",
    model: "gpt-5.6",
    repo: "applied-loop",
    configuredFingerprint: undefined,
  });
  const second = createHarnessContextFingerprint({
    harness: "codex",
    model: "gpt-5.6",
    repo: "applied-loop",
    configuredFingerprint: undefined,
  });

  assert.equal(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(isHarnessContextFingerprint(first), true);
  assert.equal(HARNESS_CONTEXT_FINGERPRINT_VERSION, "harness-context-fingerprint-v1");
  assert.equal(CONTEXT_FINGERPRINT_ENV, "APPLIED_LOOP_CONTEXT_FINGERPRINT");
});

test("operator-owned fingerprint overrides the derived cohort identity", () => {
  const configured = `sha256:${"b".repeat(64)}`;
  assert.equal(
    createHarnessContextFingerprint({
      harness: "codex",
      model: "gpt-5.6",
      repo: "applied-loop",
      configuredFingerprint: configured,
    }),
    configured,
  );
  assert.notEqual(
    createHarnessContextFingerprint({
      harness: "codex",
      model: "gpt-5.6",
      repo: "applied-loop",
      configuredFingerprint: "not-a-fingerprint",
    }),
    configured,
  );
});
