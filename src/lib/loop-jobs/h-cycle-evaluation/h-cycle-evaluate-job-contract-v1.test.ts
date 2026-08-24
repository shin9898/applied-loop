import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createHCycleEvaluatePayloadV1,
  H_CYCLE_EVALUATE_JOB_REGISTRY,
} from "./h-cycle-evaluate-job-contract-v1";
import {
  canonicalJson,
  createLoopJobQueue,
  decodeLoopJobPayload,
  defineLoopJobRegistry,
  type LoopJobClient,
} from "../state-machine";

const FIXED_NOW = new Date("2026-08-24T00:00:00.000Z");

function payloadJsonHash(payload: Record<string, string>): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function decode(payload: Record<string, string>) {
  const payloadJson = canonicalJson(payload);
  return decodeLoopJobPayload(H_CYCLE_EVALUATE_JOB_REGISTRY, {
    kind: "h_cycle_evaluate",
    payloadJson,
    payloadHash: payloadJsonHash(payload),
  });
}

const dedupeProbeRegistry = defineLoopJobRegistry({
  h_cycle_evaluate_probe: {
    version: "v1",
    fields: {
      hypothesis: { type: "enum", values: ["h_cycle", "other_hypothesis"] as const },
      cadence: { type: "enum", values: ["weekly", "monthly"] as const },
      targetWeekKey: { type: "iso_week" },
      policyVersion: { type: "enum", values: ["h_cycle_evidence_v1", "other_policy"] as const },
      projectionSchemaVersion: { type: "enum", values: ["h_cycle_evidence_preview_v1", "other_projection"] as const },
    },
    dedupeFields: ["hypothesis", "cadence", "targetWeekKey", "policyVersion", "projectionSchemaVersion"] as const,
  },
});

function queueThatCapturesDedupeKeys() {
  const dedupeKeys: string[] = [];
  const client = {
    loopJob: {
      create: async ({ data }: { data: { dedupeKey: string } }) => {
        dedupeKeys.push(data.dedupeKey);
        return data;
      },
      findUnique: async () => null,
    },
  } as unknown as LoopJobClient;
  return {
    dedupeKeys,
    queue: createLoopJobQueue({
      client,
      registry: dedupeProbeRegistry,
      clock: {
        now: () => new Date(FIXED_NOW),
        addMilliseconds: (date, milliseconds) => new Date(date.getTime() + milliseconds),
        fromStorage: (value) => new Date(value),
      },
      randomBytes: () => new Uint8Array(16),
    }),
  };
}

test("A8B1-CG1-T1 h_cycle_evaluate accepts only five closed fields and real JST ISO weeks", async () => {
  const valid = createHCycleEvaluatePayloadV1({ targetWeekKey: "2026-W33" });
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(valid.payload, {
    hypothesis: "h_cycle",
    cadence: "weekly",
    targetWeekKey: "2026-W33",
    policyVersion: "h_cycle_evidence_v1",
    projectionSchemaVersion: "h_cycle_evidence_preview_v1",
  });

  for (const weekKey of ["2020-W53", "2025-W01", "2026-W33", "2026-W53"]) {
    const result = createHCycleEvaluatePayloadV1({ targetWeekKey: weekKey });
    assert.equal(result.ok, true, weekKey);
  }
  for (const input of [
    { targetWeekKey: "2025-W53" },
    { targetWeekKey: "2026-W54" },
    { targetWeekKey: "2026-W00" },
    { targetWeekKey: "2026-W3" },
    { targetWeekKey: "2026-W33", evidence: "answer-secret" },
    { targetWeekKey: "free-form-week" },
  ]) {
    assert.deepEqual(createHCycleEvaluatePayloadV1(input), { ok: false, code: "invalid_job_identity" });
  }

  assert.deepEqual(decode(valid.payload), { ok: true, payload: valid.payload });
  for (const payload of [
    { ...valid.payload, targetWeekKey: "2025-W53" },
    { ...valid.payload, targetWeekKey: "free-form-week" },
    { ...valid.payload, extra: "answer-secret" },
    { ...valid.payload, policyVersion: "caller-chosen-policy" },
  ]) {
    assert.deepEqual(decode(payload), { ok: false, code: "invalid_payload" });
  }
});

test("A8B1-CG1-T2 h_cycle_evaluate dedupe identity includes every closed payload field", async () => {
  const base = createHCycleEvaluatePayloadV1({ targetWeekKey: "2026-W33" });
  assert.equal(base.ok, true);
  if (!base.ok) return;

  assert.deepEqual(
    H_CYCLE_EVALUATE_JOB_REGISTRY.h_cycle_evaluate.dedupeFields,
    ["hypothesis", "cadence", "targetWeekKey", "policyVersion", "projectionSchemaVersion"],
  );

  const { queue, dedupeKeys } = queueThatCapturesDedupeKeys();
  const variations = [
    base.payload,
    { ...base.payload, hypothesis: "other_hypothesis" },
    { ...base.payload, cadence: "monthly" },
    { ...base.payload, targetWeekKey: "2026-W32" },
    { ...base.payload, policyVersion: "other_policy" },
    { ...base.payload, projectionSchemaVersion: "other_projection" },
  ];
  const duplicate = await queue.enqueue({
    kind: "h_cycle_evaluate_probe",
    payload: base.payload,
    maxAttempts: 1,
  });
  assert.equal(duplicate.ok, true);
  for (const payload of variations) {
    const result = await queue.enqueue({
      kind: "h_cycle_evaluate_probe",
      payload,
      maxAttempts: 1,
    });
    assert.equal(result.ok, true);
  }
  assert.equal(dedupeKeys[0], dedupeKeys[1]);
  assert.equal(new Set(dedupeKeys).size, variations.length);
});
