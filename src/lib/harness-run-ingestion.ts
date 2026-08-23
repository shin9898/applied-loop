import { z } from "zod";

import { projectHarnessUsageEvidence } from "./harness-usage-evidence";

const safeCounter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const toolSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(40).optional(),
  calls: safeCounter,
}).strict();

const collectorVersionSchema = z.string().regex(
  /^[a-z][a-z0-9._-]{0,63}$/,
  "invalid collector version",
);

const contextFingerprintSchema = z.string().regex(
  /^sha256:[a-f0-9]{64}$/,
  "invalid context fingerprint",
);

/**
 * The collector submits only raw counters and bounded source metadata. Derived
 * evidence is deliberately not a client input: the server owns the sole
 * canonical projection from raw usage semantics.
 */
export const harnessRunPayloadSchema = z.object({
  harness: z.enum(["claude", "codex"]),
  sessionId: z.string().min(1).max(200),
  model: z.string().max(120).nullable().optional(),
  repo: z.string().max(200).nullable().optional(),
  tools: z.array(toolSchema).max(200).optional(),
  tokensIn: safeCounter.default(0),
  tokensOut: safeCounter.default(0),
  cacheRead: safeCounter.default(0),
  cacheCreate: safeCounter.default(0),
  thinking: safeCounter.default(0),
  turns: safeCounter.default(0),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  collectorVersion: collectorVersionSchema.nullable().optional(),
  contextFingerprint: contextFingerprintSchema.nullable().optional(),
}).strict();

export type HarnessRunPayload = z.infer<typeof harnessRunPayloadSchema>;

export type HarnessRunPersistenceData = Readonly<{
  model: string | null;
  repo: string | null;
  tools: string | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
  thinking: number;
  turns: number;
  startedAt: Date;
  endedAt: Date | null;
  collectorVersion: string | null;
  contextFingerprint: string | null;
  inputTotalTokens: number | null;
  inputUncachedTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usageSemanticsVersion: string;
  usageNormalizationStatus: string;
  usageNormalizationReason: string | null;
}>;

export function parseHarnessRunPayload(input: unknown) {
  return harnessRunPayloadSchema.safeParse(input);
}

export function buildHarnessRunPersistenceData(
  payload: HarnessRunPayload,
): HarnessRunPersistenceData {
  const evidence = projectHarnessUsageEvidence(payload);
  return {
    model: payload.model ?? null,
    repo: payload.repo ?? null,
    tools: payload.tools === undefined ? null : JSON.stringify(payload.tools),
    tokensIn: payload.tokensIn,
    tokensOut: payload.tokensOut,
    cacheRead: payload.cacheRead,
    cacheCreate: payload.cacheCreate,
    thinking: payload.thinking,
    turns: payload.turns,
    startedAt: new Date(payload.startedAt),
    endedAt: payload.endedAt === undefined || payload.endedAt === null
      ? null
      : new Date(payload.endedAt),
    collectorVersion: payload.collectorVersion ?? null,
    contextFingerprint: payload.contextFingerprint ?? null,
    ...evidence,
  };
}

/**
 * Keeps create and update arms of the `(harness, sessionId)` upsert on the
 * exact same server-derived evidence projection.
 */
export function buildHarnessRunUpsertArgs(payload: HarnessRunPayload) {
  const persistenceData = buildHarnessRunPersistenceData(payload);
  return {
    where: {
      harness_sessionId: {
        harness: payload.harness,
        sessionId: payload.sessionId,
      },
    },
    create: {
      harness: payload.harness,
      sessionId: payload.sessionId,
      ...persistenceData,
    },
    update: persistenceData,
  };
}
