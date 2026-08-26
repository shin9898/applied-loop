import { createHash } from "node:crypto";

export const HARNESS_CONTEXT_FINGERPRINT_VERSION =
  "harness-context-fingerprint-v1";
export const CONTEXT_FINGERPRINT_ENV = "APPLIED_LOOP_CONTEXT_FINGERPRINT";

const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;

function normalizeLabel(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isHarnessContextFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

/**
 * Return the operator-owned context identity when explicitly configured;
 * otherwise derive a stable cohort identity from metadata already allowed by
 * the collector. Conversation/prompt content and observed tool calls are
 * deliberately excluded because they are dynamic or privacy-sensitive.
 */
export function createHarnessContextFingerprint({
  harness,
  model,
  repo,
  configuredFingerprint = process.env[CONTEXT_FINGERPRINT_ENV],
}) {
  const configured = normalizeLabel(configuredFingerprint);
  if (isHarnessContextFingerprint(configured)) return configured;

  const canonical = JSON.stringify([
    HARNESS_CONTEXT_FINGERPRINT_VERSION,
    normalizeLabel(harness),
    normalizeLabel(model),
    normalizeLabel(repo),
  ]);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}
