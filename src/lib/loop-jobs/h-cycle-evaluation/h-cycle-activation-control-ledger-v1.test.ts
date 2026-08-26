import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import ts from "typescript";

import { PrismaClient } from "../../../generated/prisma/client";
import {
  appendHCycleActivationEventV1,
  appendHCycleOperationEvidenceV1,
  readHCycleActivationControlStateV1,
  type HCycleActivationControlLedgerDependenciesV1,
} from "./h-cycle-activation-control-ledger-v1";

const CURRENT_JST_WEEK = new Date("2026-08-24T00:00:00.000Z");

type DisposableFixture = Readonly<{
  directory: string;
  databasePath: string;
  databaseUrl: string;
  dotenvConfigPath: string;
}>;

async function protectedDomainCounts(client: PrismaClient) {
  return {
    loopJobs: await client.loopJob.count(),
    evaluationRecords: await client.hCycleEvaluationRecord.count(),
    harnessRuns: await client.harnessRun.count(),
    textbookEvidence: await client.textbookCheckEvidence.count(),
    textbookGateStateEvents: await client.textbookCheckGateStateEvent.count(),
  };
}

async function withFixture<T>(
  run: (client: PrismaClient, fixture: DisposableFixture) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-a8c1-ledger-"));
  const databasePath = join(directory, "fixture.db");
  const dotenvConfigPath = join(directory, "dotenv-never-exists");
  const databaseUrl = `file:${databasePath}`;
  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: dotenvConfigPath,
        DATABASE_URL: databaseUrl,
      },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);

    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath, fileMustExist: true, timeout: 250 },
        { timestampFormat: "iso8601" },
      ),
    });
    try {
      const beforeDomainCounts = await protectedDomainCounts(client);
      const result = await run(client, Object.freeze({
        directory,
        databasePath,
        databaseUrl,
        dotenvConfigPath,
      }));
      assert.deepEqual(await protectedDomainCounts(client), beforeDomainCounts);
      return result;
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("A8C1-CG1-T1 records only the redacted W35 root and derives feature-off incomplete state", async () => {
  await withFixture(async (client) => {
    const dependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) },
    };
    const packet = {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "packet_attested",
      activationFloorWeekKey: "2026-W35",
    } as const;

    const appended = await appendHCycleActivationEventV1(dependencies, packet);
    assert.deepEqual(appended, { ok: true, featureState: "off", created: true });
    assert.equal(Object.isFrozen(appended), true);

    const rows = await client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } });
    assert.equal(rows.length, 1);
    assert.deepEqual(
      {
        eventSchema: rows[0]?.eventSchema,
        eventKind: rows[0]?.eventKind,
        generationSequence: rows[0]?.generationSequence,
        packetSchema: rows[0]?.packetSchema,
        packetStatus: rows[0]?.packetStatus,
        targetClass: rows[0]?.targetClass,
        activationFloorWeekKey: rows[0]?.activationFloorWeekKey,
        schedulerClass: rows[0]?.schedulerClass,
        schedulerOwnership: rows[0]?.schedulerOwnership,
        stopRouteClass: rows[0]?.stopRouteClass,
        recordedAt: rows[0]?.recordedAt.toISOString(),
      },
      {
        eventSchema: "h_cycle_activation_event_v1",
        eventKind: "packet_attested",
        generationSequence: null,
        packetSchema: "h_cycle_private_packet_attestation_v1",
        packetStatus: "approved",
        targetClass: "existing_local_applied_loop_development_sqlite",
        activationFloorWeekKey: "2026-W35",
        schedulerClass: "macos_user_launchd",
        schedulerOwnership: "operator_manual_install",
        stopRouteClass: "same_user_agent_unload_remove",
        recordedAt: "2026-08-24T00:00:00.000Z",
      },
    );

    const state = await readHCycleActivationControlStateV1(
      dependencies,
      { schema: "h_cycle_activation_control_read_v1" },
    );
    assert.deepEqual(state, { ok: true, featureState: "off", state: "evidence_incomplete" });
    assert.equal(Object.isFrozen(state), true);

    const wrongFloor = await appendHCycleActivationEventV1(
      dependencies,
      { ...packet, activationFloorWeekKey: "2026-W34" },
    );
    assert.deepEqual(wrongFloor, {
      ok: false,
      featureState: "off",
      code: "invalid_activation_event_input",
    });

    const privateTargetSentinel = "file:/private/operator-selected.db?token=must-not-echo";
    const malicious = await appendHCycleActivationEventV1(
      dependencies,
      { ...packet, targetDatabaseUrl: privateTargetSentinel },
    );
    assert.deepEqual(malicious, {
      ok: false,
      featureState: "off",
      code: "invalid_activation_event_input",
    });
    assert.doesNotMatch(JSON.stringify(malicious), new RegExp(privateTargetSentinel.replace(/[?]/g, "\\?")));
    assert.equal(await client.hCycleActivationEvent.count(), 1);
  });
});

function rootEvent(
  eventKind: "packet_attested" | "re_enabled",
  activationFloorWeekKey: string,
  recordedAt: Date,
) {
  return {
    eventSchema: "h_cycle_activation_event_v1",
    eventKind,
    generationSequence: null,
    packetSchema: "h_cycle_private_packet_attestation_v1",
    packetStatus: "approved",
    targetClass: "existing_local_applied_loop_development_sqlite",
    activationFloorWeekKey,
    schedulerClass: "macos_user_launchd",
    schedulerOwnership: "operator_manual_install",
    stopRouteClass: "same_user_agent_unload_remove",
    recordedAt,
  } as const;
}

function disabledEvent(generationSequence: number, recordedAt: Date) {
  return {
    eventSchema: "h_cycle_activation_event_v1",
    eventKind: "disabled",
    generationSequence,
    packetSchema: null,
    packetStatus: null,
    targetClass: null,
    activationFloorWeekKey: null,
    schedulerClass: null,
    schedulerOwnership: null,
    stopRouteClass: null,
    recordedAt,
  } as const;
}

function manualEvidence(generationSequence: number, targetWeekKey: string, observedAt: Date) {
  return {
    evidenceSchema: "h_cycle_activation_evidence_v1",
    generationSequence,
    evidenceKind: "manual_a7c_read_only_observation",
    targetWeekKey,
    policyOutcome: "baseline_collecting",
    observedAt,
  } as const;
}

function operationalEvidence(generationSequence: number, observedAt: Date) {
  return {
    evidenceSchema: "h_cycle_activation_evidence_v1",
    generationSequence,
    evidenceKind: "worker_heartbeat_enabled",
    targetWeekKey: null,
    policyOutcome: null,
    observedAt,
  } as const;
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

test("A8C1-CG1-T2 temporary SQLite rejects direct invalid ledger rows and keeps both ledgers append-only", async () => {
  await withFixture(async (client) => {
    const recordedAt = new Date(CURRENT_JST_WEEK.getTime());
    const root = await client.hCycleActivationEvent.create({
      data: rootEvent("packet_attested", "2026-W35", recordedAt),
    });

    // W99 is syntactically shaped for SQLite but is not a real ISO week. The
    // reader, not the coarse SQL guard, owns this semantic validation.
    const semanticOnlyInvalid = await client.hCycleActivationEvidence.create({
      data: manualEvidence(root.sequence, "2026-W99", recordedAt),
    });
    assert.equal(semanticOnlyInvalid.targetWeekKey, "2026-W99");

    const state = await readHCycleActivationControlStateV1(
      {
        client,
        clock: { now: () => plusMinutes(recordedAt, 1) },
      },
      { schema: "h_cycle_activation_control_read_v1" },
    );
    assert.deepEqual(state, {
      ok: false,
      featureState: "off",
      code: "activation_control_integrity_failure",
    });
  });

  await withFixture(async (client) => {
    const recordedAt = new Date(CURRENT_JST_WEEK.getTime());
    const root = await client.hCycleActivationEvent.create({
      data: rootEvent("packet_attested", "2026-W35", recordedAt),
    });
    await client.hCycleActivationEvidence.create({
      data: manualEvidence(root.sequence, "2026-W34", recordedAt),
    });

    const state = await readHCycleActivationControlStateV1(
      {
        client,
        clock: { now: () => plusMinutes(recordedAt, 1) },
      },
      { schema: "h_cycle_activation_control_read_v1" },
    );
    assert.deepEqual(state, {
      ok: false,
      featureState: "off",
      code: "activation_control_integrity_failure",
    });
  });

  await withFixture(async (client) => {
    const recordedAt = new Date(CURRENT_JST_WEEK.getTime());
    const root = rootEvent("packet_attested", "2026-W35", recordedAt);

    await assert.rejects(
      client.hCycleActivationEvent.create({
        data: rootEvent("packet_attested", "2026-W34", recordedAt),
      }),
      /constraint|invalid/i,
    );

    await assert.rejects(
      client.hCycleActivationEvent.create({
        data: { ...root, packetStatus: "unapproved" },
      }),
      /constraint|invalid/i,
    );

    const persistedRoot = await client.hCycleActivationEvent.create({ data: root });

    await assert.rejects(
      client.hCycleActivationEvent.create({ data: root }),
      /constraint|invalid/i,
    );
    await assert.rejects(
      client.hCycleActivationEvent.create({
        data: rootEvent("re_enabled", "2026-W36", plusMinutes(recordedAt, 1)),
      }),
      /constraint|invalid/i,
    );

    // These are direct Prisma writes to the disposable fixture. SQL must reject
    // malformed row shapes even though application semantic validation is not in scope here.
    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: {
          evidenceSchema: "h_cycle_activation_evidence_v1",
          generationSequence: persistedRoot.sequence,
          evidenceKind: "manual_a7c_read_only_observation",
          targetWeekKey: "2026-W35",
          policyOutcome: null,
          observedAt: recordedAt,
        },
      }),
      /constraint|invalid/i,
    );
    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: {
          evidenceSchema: "h_cycle_activation_evidence_v1",
          generationSequence: persistedRoot.sequence,
          evidenceKind: "worker_heartbeat_enabled",
          targetWeekKey: "2026-W35",
          policyOutcome: "baseline_collecting",
          observedAt: recordedAt,
        },
      }),
      /constraint|invalid/i,
    );
    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: operationalEvidence(999_999, recordedAt),
      }),
      /constraint|foreign|invalid/i,
    );

    const disabledAt = plusMinutes(recordedAt, 1);
    await client.hCycleActivationEvent.create({
      data: disabledEvent(persistedRoot.sequence, disabledAt),
    });
    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: operationalEvidence(persistedRoot.sequence, disabledAt),
      }),
      /constraint|foreign|invalid/i,
    );
    await assert.rejects(
      client.hCycleActivationEvent.create({
        data: rootEvent("re_enabled", "2026-W35", plusMinutes(disabledAt, 1)),
      }),
      /constraint|invalid/i,
    );

    const reenabledAt = plusMinutes(disabledAt, 2);
    const reenabledRoot = await client.hCycleActivationEvent.create({
      data: rootEvent("re_enabled", "2026-W36", reenabledAt),
    });
    await assert.rejects(
      client.hCycleActivationEvent.create({
        data: disabledEvent(persistedRoot.sequence, plusMinutes(reenabledAt, 1)),
      }),
      /constraint|invalid/i,
    );
    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: operationalEvidence(persistedRoot.sequence, plusMinutes(reenabledAt, 1)),
      }),
      /constraint|foreign|invalid/i,
    );

    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: manualEvidence(reenabledRoot.sequence, "2026-W36", disabledAt),
      }),
      /constraint|invalid/i,
    );

    const evidenceAt = plusMinutes(reenabledAt, 1);
    const evidence = await client.hCycleActivationEvidence.create({
      data: manualEvidence(reenabledRoot.sequence, "2026-W36", evidenceAt),
    });
    await assert.rejects(
      client.hCycleActivationEvidence.create({
        data: manualEvidence(reenabledRoot.sequence, "2026-W36", plusMinutes(evidenceAt, 1)),
      }),
      /constraint|invalid/i,
    );

    const operational = operationalEvidence(reenabledRoot.sequence, plusMinutes(evidenceAt, 2));
    await client.hCycleActivationEvidence.create({ data: operational });
    await assert.rejects(
      client.hCycleActivationEvidence.create({ data: operational }),
      /constraint|invalid/i,
    );

    await assert.rejects(
      client.hCycleActivationEvidence.update({
        where: { sequence: evidence.sequence },
        data: { policyOutcome: "rejected" },
      }),
    );
    await assert.rejects(
      client.hCycleActivationEvidence.delete({ where: { sequence: evidence.sequence } }),
    );
    await assert.rejects(
      client.hCycleActivationEvent.update({
        where: { sequence: reenabledRoot.sequence },
        data: { packetStatus: "unapproved" },
      }),
    );
    await assert.rejects(
      client.hCycleActivationEvent.delete({ where: { sequence: reenabledRoot.sequence } }),
    );

    const retainedRoot = await client.hCycleActivationEvent.findUniqueOrThrow({
      where: { sequence: reenabledRoot.sequence },
    });
    const retainedEvidence = await client.hCycleActivationEvidence.findUniqueOrThrow({
      where: { sequence: evidence.sequence },
    });
    assert.equal(retainedRoot.packetStatus, "approved");
    assert.equal(retainedEvidence.policyOutcome, "baseline_collecting");
    assert.equal(await client.hCycleActivationEvent.count(), 3);
    assert.equal(await client.hCycleActivationEvidence.count(), 2);
  });
});

test("A8C1-CG2-T1 makes duplicate manual evidence idempotent and rejects conflicting facts without a second observation", async () => {
  await withFixture(async (client) => {
    const rootDependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) },
    };
    const root = await appendHCycleActivationEventV1(rootDependencies, {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "packet_attested",
      activationFloorWeekKey: "2026-W35",
    });
    assert.deepEqual(root, { ok: true, featureState: "off", created: true });

    const storedRoot = await client.hCycleActivationEvent.findFirstOrThrow({ orderBy: { sequence: "asc" } });
    await client.hCycleActivationEvidence.create({
      data: manualEvidence(storedRoot.sequence, "2026-W35", new Date("2026-08-24T00:01:00.000Z")),
    });
    const state = await readHCycleActivationControlStateV1(
      {
        client,
        clock: { now: () => new Date("2026-09-01T00:00:00.000Z") },
      },
      { schema: "h_cycle_activation_control_read_v1" },
    );
    assert.deepEqual(state, {
      ok: false,
      featureState: "off",
      code: "activation_control_integrity_failure",
    });
  });

  await withFixture(async (client) => {
    const rootDependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) },
    };
    const root = await appendHCycleActivationEventV1(rootDependencies, {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "packet_attested",
      activationFloorWeekKey: "2026-W35",
    });
    assert.deepEqual(root, { ok: true, featureState: "off", created: true });

    const observedAt = new Date("2026-08-30T15:00:00.000Z");
    const dependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date("2026-09-01T00:00:00.000Z") },
    };
    const fact = {
      schema: "h_cycle_operation_evidence_input_v1",
      evidenceKind: "manual_a7c_read_only_observation",
      targetWeekKey: "2026-W35",
      policyOutcome: "baseline_collecting",
      observedAt,
    } as const;

    const privateInputSentinel = "file:/private/operator-input?token=must-not-echo";
    const throwingProxy = new Proxy(
      { schema: "h_cycle_operation_evidence_input_v1" },
      {
        getOwnPropertyDescriptor() {
          throw new Error(privateInputSentinel);
        },
      },
    );
    const throwingAccessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwingAccessor, "schema", {
      enumerable: true,
      get() {
        throw new Error(privateInputSentinel);
      },
    });
    const invalidEvent = await appendHCycleActivationEventV1(rootDependencies, throwingProxy);
    const invalidEvidence = await appendHCycleOperationEvidenceV1(dependencies, throwingAccessor);
    const invalidRead = await readHCycleActivationControlStateV1(dependencies, throwingProxy);
    assert.deepEqual(invalidEvent, {
      ok: false,
      featureState: "off",
      code: "invalid_activation_event_input",
    });
    assert.deepEqual(invalidEvidence, {
      ok: false,
      featureState: "off",
      code: "invalid_operation_evidence_input",
    });
    assert.deepEqual(invalidRead, {
      ok: false,
      featureState: "off",
      code: "invalid_activation_control_read_input",
    });
    for (const result of [invalidEvent, invalidEvidence, invalidRead]) {
      assert.equal(JSON.stringify(result).includes(privateInputSentinel), false);
    }

    const [first, second] = await Promise.all([
      appendHCycleOperationEvidenceV1(dependencies, fact),
      appendHCycleOperationEvidenceV1(dependencies, fact),
    ]);
    if (!first.ok || !second.ok) assert.fail("same fact must not fail under concurrent retry");
    assert.deepEqual([first.created, second.created].sort(), [false, true]);
    assert.equal(first.featureState, "off");
    assert.equal(second.featureState, "off");

    const duplicate = await appendHCycleOperationEvidenceV1(dependencies, fact);
    assert.deepEqual(duplicate, { ok: true, featureState: "off", created: false });
    assert.equal(await client.hCycleActivationEvidence.count(), 1);

    const conflicting = await appendHCycleOperationEvidenceV1(dependencies, {
      ...fact,
      policyOutcome: "rejected",
    });
    assert.deepEqual(conflicting, {
      ok: false,
      featureState: "off",
      code: "activation_evidence_integrity_failure",
    });
    assert.equal(await client.hCycleActivationEvidence.count(), 1);

    const privateEvidenceSentinel = "file:/private/operator-evidence?token=must-not-echo";
    const malicious = await appendHCycleOperationEvidenceV1(dependencies, {
      ...fact,
      privateEvidenceSource: privateEvidenceSentinel,
    });
    assert.deepEqual(malicious, {
      ok: false,
      featureState: "off",
      code: "invalid_operation_evidence_input",
    });
    assert.doesNotMatch(JSON.stringify(malicious), new RegExp(privateEvidenceSentinel.replace(/[?]/g, "\\\\?")));
  });
});

test("A8C1-CG2-T2 lets disable win, requires an advancing real current-or-later re-enable floor, and isolates generations", async () => {
  await withFixture(async (client) => {
    const attestedAt = new Date(CURRENT_JST_WEEK.getTime());
    const initialDependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date(attestedAt.getTime()) },
    };
    const attested = await appendHCycleActivationEventV1(initialDependencies, {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "packet_attested",
      activationFloorWeekKey: "2026-W35",
    });
    assert.deepEqual(attested, { ok: true, featureState: "off", created: true });

    const beforeDisable = new Date("2026-09-01T00:00:00.000Z");
    const beforeDisableDependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date(beforeDisable.getTime()) },
    };
    const historicalFact = {
      schema: "h_cycle_operation_evidence_input_v1",
      evidenceKind: "manual_a7c_read_only_observation",
      targetWeekKey: "2026-W35",
      policyOutcome: "baseline_collecting",
      observedAt: new Date("2026-08-31T00:00:00.000Z"),
    } as const;
    assert.deepEqual(
      await appendHCycleOperationEvidenceV1(beforeDisableDependencies, historicalFact),
      { ok: true, featureState: "off", created: true },
    );

    const disabled = await appendHCycleActivationEventV1(beforeDisableDependencies, {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "disabled",
    });
    assert.deepEqual(disabled, { ok: true, featureState: "off", created: true });
    assert.equal(Object.isFrozen(disabled), true);
    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        beforeDisableDependencies,
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      { ok: true, featureState: "off", state: "disabled" },
    );
    assert.deepEqual(
      await appendHCycleOperationEvidenceV1(beforeDisableDependencies, historicalFact),
      { ok: false, featureState: "off", code: "activation_control_disabled" },
    );

    assert.deepEqual(
      await appendHCycleActivationEventV1(beforeDisableDependencies, {
        schema: "h_cycle_activation_event_input_v1",
        eventKind: "re_enabled",
        activationFloorWeekKey: "2026-W99",
      }),
      { ok: false, featureState: "off", code: "invalid_activation_event_input" },
    );
    assert.deepEqual(
      await appendHCycleActivationEventV1(beforeDisableDependencies, {
        schema: "h_cycle_activation_event_input_v1",
        eventKind: "re_enabled",
        activationFloorWeekKey: "2026-W35",
      }),
      { ok: false, featureState: "off", code: "invalid_activation_event_input" },
    );

    const reenabled = await appendHCycleActivationEventV1(beforeDisableDependencies, {
      schema: "h_cycle_activation_event_input_v1",
      eventKind: "re_enabled",
      activationFloorWeekKey: "2026-W36",
    });
    assert.deepEqual(reenabled, { ok: true, featureState: "off", created: true });
    assert.equal(Object.isFrozen(reenabled), true);

    const events = await client.hCycleActivationEvent.findMany({ orderBy: { sequence: "asc" } });
    assert.deepEqual(events.map(({ eventKind, generationSequence, activationFloorWeekKey }) => ({
      eventKind,
      generationSequence,
      activationFloorWeekKey,
    })), [
      { eventKind: "packet_attested", generationSequence: null, activationFloorWeekKey: "2026-W35" },
      { eventKind: "disabled", generationSequence: events[0]?.sequence, activationFloorWeekKey: null },
      { eventKind: "re_enabled", generationSequence: null, activationFloorWeekKey: "2026-W36" },
    ]);
    assert.notEqual(events[0]?.sequence, events[2]?.sequence);

    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        beforeDisableDependencies,
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      { ok: true, featureState: "off", state: "evidence_incomplete" },
    );
    assert.deepEqual(
      await appendHCycleOperationEvidenceV1(beforeDisableDependencies, historicalFact),
      { ok: false, featureState: "off", code: "invalid_operation_evidence_input" },
    );

    const retainedEvidence = await client.hCycleActivationEvidence.findMany({ orderBy: { sequence: "asc" } });
    assert.equal(retainedEvidence.length, 1);
    assert.equal(retainedEvidence[0]?.generationSequence, events[0]?.sequence);
    assert.notEqual(retainedEvidence[0]?.generationSequence, events[2]?.sequence);
  });

  await withFixture(async (client) => {
    await client.hCycleActivationEvent.create({
      data: rootEvent("packet_attested", "2026-W35", plusMinutes(CURRENT_JST_WEEK, 1)),
    });

    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        {
          client,
          clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) },
        },
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      {
        ok: false,
        featureState: "off",
        code: "activation_control_integrity_failure",
      },
    );
  });

  await withFixture(async (client) => {
    const root = await client.hCycleActivationEvent.create({
      data: rootEvent("packet_attested", "2026-W35", CURRENT_JST_WEEK),
    });
    await client.hCycleActivationEvent.create({
      data: disabledEvent(root.sequence, plusMinutes(CURRENT_JST_WEEK, -1)),
    });

    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        {
          client,
          clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) },
        },
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      {
        ok: false,
        featureState: "off",
        code: "activation_control_integrity_failure",
      },
    );
  });

  await withFixture(async (client) => {
    const root = await client.hCycleActivationEvent.create({
      data: rootEvent("packet_attested", "2026-W35", CURRENT_JST_WEEK),
    });
    await client.hCycleActivationEvidence.create({
      data: operationalEvidence(root.sequence, plusMinutes(CURRENT_JST_WEEK, 2)),
    });
    await client.hCycleActivationEvent.create({
      data: disabledEvent(root.sequence, plusMinutes(CURRENT_JST_WEEK, 1)),
    });

    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        {
          client,
          clock: { now: () => plusMinutes(CURRENT_JST_WEEK, 3) },
        },
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      {
        ok: false,
        featureState: "off",
        code: "activation_control_integrity_failure",
      },
    );
  });
});

test("A8C1-CG3-T1 derives feature-off readiness only from fresh current-generation manual and operational evidence", async () => {
  await withFixture(async (client) => {
    const attestedAt = new Date(CURRENT_JST_WEEK.getTime());
    const now = new Date("2026-09-21T00:00:00.000Z");
    const dependencies: HCycleActivationControlLedgerDependenciesV1 = {
      client,
      clock: { now: () => new Date(now.getTime()) },
    };

    assert.deepEqual(
      await appendHCycleActivationEventV1(
        {
          client,
          clock: { now: () => new Date(attestedAt.getTime()) },
        },
        {
          schema: "h_cycle_activation_event_input_v1",
          eventKind: "packet_attested",
          activationFloorWeekKey: "2026-W35",
        },
      ),
      { ok: true, featureState: "off", created: true },
    );

    for (const fact of [
      {
        schema: "h_cycle_operation_evidence_input_v1",
        evidenceKind: "manual_a7c_read_only_observation",
        targetWeekKey: "2026-W35",
        policyOutcome: "baseline_collecting",
        observedAt: new Date("2026-09-07T00:00:00.000Z"),
      },
      {
        schema: "h_cycle_operation_evidence_input_v1",
        evidenceKind: "manual_a7c_read_only_observation",
        targetWeekKey: "2026-W36",
        policyOutcome: "supported",
        observedAt: new Date("2026-09-07T00:01:00.000Z"),
      },
    ] as const) {
      assert.deepEqual(
        await appendHCycleOperationEvidenceV1(dependencies, fact),
        { ok: true, featureState: "off", created: true },
      );
    }

    const operationalKinds = [
      "worker_heartbeat_enabled",
      "worker_heartbeat_disabled",
      "kill_switch_disposable_no_scan_enqueue_delivery_record",
      "kill_switch_local_read_only_no_new_write",
      "disable_queued_work_no_record",
      "crash_after_record_same_digest_retry",
      "hash_mismatch_integrity_stop",
      "stale_lease_recovery",
      "sleep_catch_up_oldest_one",
      "pre_floor_no_backfill",
    ] as const;
    const missingKind = operationalKinds.at(-1);
    assert.notEqual(missingKind, undefined);

    for (const evidenceKind of operationalKinds.slice(0, -1)) {
      assert.deepEqual(
        await appendHCycleOperationEvidenceV1(dependencies, {
          schema: "h_cycle_operation_evidence_input_v1",
          evidenceKind,
          observedAt: new Date("2026-09-14T00:00:00.000Z"),
        }),
        { ok: true, featureState: "off", created: true },
      );
    }
    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        dependencies,
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      { ok: true, featureState: "off", state: "evidence_incomplete" },
    );

    const staleMissingFact = {
      schema: "h_cycle_operation_evidence_input_v1",
      evidenceKind: missingKind,
      observedAt: new Date("2026-09-06T23:59:59.999Z"),
    } as const;
    assert.deepEqual(
      await appendHCycleOperationEvidenceV1(dependencies, staleMissingFact),
      { ok: true, featureState: "off", created: true },
    );
    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        dependencies,
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      { ok: true, featureState: "off", state: "evidence_incomplete" },
    );

    const freshMissingFact = {
      schema: "h_cycle_operation_evidence_input_v1",
      evidenceKind: missingKind,
      observedAt: new Date("2026-09-07T00:00:00.000Z"),
    } as const;
    assert.deepEqual(
      await appendHCycleOperationEvidenceV1(dependencies, freshMissingFact),
      { ok: true, featureState: "off", created: true },
    );
    assert.deepEqual(
      await appendHCycleOperationEvidenceV1(dependencies, freshMissingFact),
      { ok: true, featureState: "off", created: false },
    );
    const ready = await readHCycleActivationControlStateV1(
      dependencies,
      { schema: "h_cycle_activation_control_read_v1" },
    );
    assert.deepEqual(ready, {
      ok: true,
      featureState: "off",
      state: "ready_for_separately_approved_operation",
    });
    assert.equal(Object.isFrozen(ready), true);

    const root = await client.hCycleActivationEvent.findFirstOrThrow({ orderBy: { sequence: "asc" } });
    await client.hCycleActivationEvidence.create({
      data: {
        evidenceSchema: "h_cycle_activation_evidence_v1",
        generationSequence: root.sequence,
        evidenceKind: "worker_heartbeat_enabled",
        targetWeekKey: null,
        policyOutcome: null,
        observedAt: new Date("2026-09-21T00:00:00.001Z"),
      },
    });
    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        dependencies,
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      {
        ok: false,
        featureState: "off",
        code: "activation_control_integrity_failure",
      },
    );
  });
});

test("A8C1-CG4-T1 keeps the control ledger type-only, feature-off, and isolated from runtime activation", async () => {
  const root = process.cwd();
  const ledgerPath = join(root, "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-control-ledger-v1.ts");
  const ledgerSource = readFileSync(ledgerPath, "utf8");
  const ledgerFile = ts.createSourceFile(ledgerPath, ledgerSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const ledgerParseDiagnostics = (ledgerFile as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(
    ledgerParseDiagnostics.length,
    0,
    ledgerParseDiagnostics.map((diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"),
  );

  const imports = ledgerFile.statements.filter(ts.isImportDeclaration);
  assert.equal(imports.length, 1);
  const [prismaImport] = imports;
  assert.ok(prismaImport);
  assert.equal(prismaImport.importClause?.isTypeOnly, true);
  assert.equal(ts.isStringLiteral(prismaImport.moduleSpecifier), true);
  assert.equal((prismaImport.moduleSpecifier as ts.StringLiteral).text, "../../../generated/prisma/client");
  assert.ok(prismaImport.importClause?.namedBindings);
  assert.equal(ts.isNamedImports(prismaImport.importClause?.namedBindings), true);
  const namedImports = prismaImport.importClause?.namedBindings as ts.NamedImports;
  assert.deepEqual(namedImports.elements.map((element) => ({
    name: element.name.text,
    propertyName: element.propertyName?.text ?? null,
    isTypeOnly: element.isTypeOnly,
  })), [{ name: "PrismaClient", propertyName: null, isTypeOnly: false }]);

  const expectedExports = [
    "AppendHCycleActivationEventResultV1",
    "AppendHCycleOperationEvidenceResultV1",
    "HCycleActivationControlLedgerDependenciesV1",
    "HCycleActivationEventInputV1",
    "HCycleOperationEvidenceInputV1",
    "ReadHCycleActivationControlStateResultV1",
    "appendHCycleActivationEventV1",
    "appendHCycleOperationEvidenceV1",
    "readHCycleActivationControlStateV1",
  ];
  const hasExportModifier = (node: ts.Node) => (
    ((node as ts.HasModifiers).modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) ?? false
  );
  const actualExports: string[] = [];
  for (const statement of ledgerFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      assert.ok(statement.name, "named exports only");
      actualExports.push(statement.name.text);
      continue;
    }
    assert.fail(`unexpected exported declaration: ${ts.SyntaxKind[statement.kind]}`);
  }
  assert.deepEqual(actualExports.sort(), expectedExports.sort());

  const staticFailures: string[] = [];
  const reject = (reason: string, node: ts.Node) => {
    staticFailures.push(`${reason} at ${node.getStart(ledgerFile)}`);
  };
  const forbiddenIdentifiers = new Set([
    "PrismaBetterSqlite3",
    "require",
    "createRequire",
    "process",
    "Deno",
    "Bun",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "readFile",
    "readFileSync",
    "writeFile",
    "writeFileSync",
    "open",
    "openSync",
    "readdir",
    "fs",
    "http",
    "https",
    "net",
    "tls",
    "child_process",
    "spawn",
    "exec",
    "execFile",
    "execFileSync",
    "launchctl",
    "URL",
    "pathToFileURL",
    "dotenv",
    "findUp",
    "DATABASE_URL",
    "DOTENV_CONFIG_PATH",
    "createLoopJobQueue",
    "defineLoopJobRegistry",
    "runOneShotWorker",
    "runOneDelivery",
    "buildHCycleEvidencePreviewV1",
    "queryHCycleEvidencePreviewSnapshotV1",
    "queryReadonlyHCycleEvidencePreviewSnapshotV1",
    "createReadonlyHCycleEvidencePreviewClient",
    "deriveHCycleEvaluateTimingV1",
    "planHCycleEvaluateV1",
    "createHCycleEvaluateDormantHandlerV1",
  ]);
  const forbiddenPropertyNames = new Set([
    "$queryRaw",
    "$queryRawUnsafe",
    "$executeRaw",
    "$executeRawUnsafe",
    "$runCommandRaw",
    "createMany",
    "updateMany",
    "deleteMany",
    "upsert",
  ]);
  const forbiddenLiteralFragments = [
    "database_url",
    "dotenv_config_path",
    ".env",
    "file:",
    "launchctl",
    ".plist",
    "programarguments",
    "startinterval",
    "startcalendarinterval",
    "runatload",
    "keepalive",
    "/library/launchagents",
  ];
  const injectedClockNow = (node: ts.PropertyAccessExpression) => (
    node.name.text === "now"
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "clock"
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "dependencies"
  );
  const prismaClientUseIsTypeOnly = (node: ts.Identifier) => (
    ts.isImportSpecifier(node.parent)
    || (ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node)
  );
  const visitLedger = (node: ts.Node): void => {
    if (ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      reject("runtime import or re-export", node);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      reject("dynamic import", node);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "PrismaClient" || node.expression.text === "PrismaBetterSqlite3") {
        reject("client or adapter construction", node);
      }
      if (node.expression.text === "Date" && (node.arguments === undefined || node.arguments.length === 0)) {
        reject("argumentless Date construction", node);
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (forbiddenPropertyNames.has(node.name.text)) reject("raw SQL or bulk mutation access", node);
      if (node.name.text === "now" && !injectedClockNow(node)) reject("un-injected clock access", node);
    }
    if (ts.isIdentifier(node)) {
      if (node.text === "PrismaClient" && !prismaClientUseIsTypeOnly(node)) {
        reject("runtime PrismaClient reference", node);
      }
      const propertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (forbiddenIdentifiers.has(node.text) && !propertyName) {
        reject(`forbidden activation capability ${node.text}`, node);
      }
    }
    if (ts.isStringLiteralLike(node)) {
      const normalized = node.text.toLowerCase();
      if (forbiddenLiteralFragments.some((fragment) => normalized.includes(fragment))) {
        reject("database, environment, or launchd configuration literal", node);
      }
    }
    ts.forEachChild(node, visitLedger);
  };
  visitLedger(ledgerFile);
  assert.deepEqual(staticFailures, []);

  const reader = ledgerFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "readHCycleActivationControlStateV1"
  ));
  assert.ok(reader?.body, "reader must remain a local named function");
  const readerWrites: string[] = [];
  const visitReader = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert", "$executeRaw", "$executeRawUnsafe"].includes(node.name.text)) {
      readerWrites.push(node.name.text);
    }
    ts.forEachChild(node, visitReader);
  };
  visitReader(reader.body);
  assert.deepEqual(readerWrites, []);

  const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const protectedRuntimeSha256: Readonly<Record<string, string>> = {
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-activation-readiness-v1.ts": "2c6791dcf24b534226f3014b3f3e0404131e4d33cbfd730eb2fa915291211b84",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-job-contract-v1.ts": "f2429180b8286a98425b25ce8772206ab129f80c5bfe865795fb72c2a8468dbc",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-planner-v1.ts": "a7f542b0101df367cca7dcfc7f90321d15c885b8bae4f8ed9a33899b6da86d51",
    "src/lib/loop-jobs/h-cycle-evaluation/h-cycle-evaluate-dormant-handler-v1.ts": "dd0cba88d498d95adb51d5efbcae46eeffeaf32b0073c130b74ee40caac7440f",
    "src/lib/h-cycle-evaluation-record.ts": "7361228c143d47da8e77834dd571240c6e5db9a62be9b44f6d45d2c790ed3973",
    "src/lib/h-cycle-evidence-preview.ts": "3257b9c0954befd86d3b410c366974a87dfe43ffa88aafab3f2a38289e96b47f",
    "src/lib/h-cycle-evidence-preview-query.ts": "c5be617f652a186c7076867ad24b05fe5b35a195c7e5f5d0783d4a7ca5d76b3e",
    "scripts/preview-h-cycle-evidence.ts": "d03552e9458caf8cf3a26f562c5747c31fcbc29ee21bb2d6742ea8ed4c3b0c7d",
    "src/lib/loop-jobs/worker.mjs": "25a09e3c904ef4feb85839ef1821209432d14842665cf36cd197d7bdbd1a6e49",
    "src/lib/loop-jobs/worker-phase1.mjs": "89cfc559cb1b386d3adf504be5322d317caf076abd6c1dadf16f1d87c4d667d4",
    "src/lib/loop-jobs/worker-phase2-entry.ts": "c34513fb36fcc2051dc8748be8ae57d8438679a60824a75599116354cb29dc1e",
    "src/lib/loop-jobs/worker-phase2.ts": "9569be398c439eccac6bfbae86677a1f6d61211ee11a7b4d592f5622490c778d",
    "src/lib/loop-jobs/delivery.ts": "4062126950275118d7ee2d5f772e9a05926c2fda67ec8e48d94142ad3e80bc67",
    "src/lib/loop-jobs/delivery-no-echo-helper.ts": "e40df38bee18b316dd2b8d98a60f1a9233393a71efb9135d114dc6771ec1b6eb",
    "package.json": "db5c73d6dc61b2aea263f44eb5edad13cbf245c02e7edfa712eb768e1475d000",
    "scripts/com.applied-loop.dev.plist": "56e77066a353bec5c27eaa4bc8eec1f090c87741a74016b13701654c5ddbf432",
    "scripts/com.applied-loop.harness-collect.plist": "8034650241edde128eb4bb6e99f6e5e8ed3afa9b4b7cfd0f561269bd130e75a1",
    "scripts/com.applied-loop.weekly-textbook.plist": "33dcbce39fef4d4698c611eae2b9b4a65e16e28d62a40606a87d9af9d2083824",
    "prisma/migrations/20260822090000_loop_job_substrate/migration.sql": "bb8eee045aa18e131ebd27c6fc6aab8eb93ba99ad85b216434b40d3138e6bd8a",
    "prisma/migrations/20260824003236_h_cycle_evidence_ledger/migration.sql": "48f64f0a48c4bbb1f7ae6b0f672a28480b479bebc530e076a6e0bd10ee192db3",
    "prisma/migrations/20260824110000_h_cycle_gate_history/migration.sql": "551f5aa5106c4d3a1811a5435d3329d448ec443a442f68041f83c4cd60fd444d",
    "prisma/migrations/20260824140000_h_cycle_evaluation_record/migration.sql": "6a7a7e2943fd710299b8aed0042fd0dd10e1faf627bf1ec9c375c69e0872dce3",
  };
  const deliveryA8C2Snippets = [
    {
      begin: "// A8-C2 BEGIN: scoped capability snapshot helpers",
      end: "// A8-C2 END: scoped capability snapshot helpers",
      leading: "",
      trailing: "\n\n",
    },
    {
      begin: "// A8-C2 BEGIN: runOneKindDelivery",
      end: "// A8-C2 END: runOneKindDelivery",
      leading: "\n",
      trailing: "\n",
    },
  ] as const;
  const deliveryA8C3Regions = [
    {
      begin: "// A8-C3 BEGIN: generic delivery reserved-kind post-claim fence",
      end: "// A8-C3 END: generic delivery reserved-kind post-claim fence",
      leading: "  ",
      trailing: "\n",
    },
    {
      begin: "// A8-C3 BEGIN: kind-isolated delivery reserved-kind pre-claim fence",
      end: "// A8-C3 END: kind-isolated delivery reserved-kind pre-claim fence",
      leading: "    ",
      trailing: "\n",
    },
  ] as const;
  const projectDeliveryBeforeA8C3 = (source: string): string => {
    const intervals = deliveryA8C3Regions.map((region) => {
      assert.equal(source.split(region.begin).length - 1, 1, `delivery: ${region.begin} count`);
      assert.equal(source.split(region.end).length - 1, 1, `delivery: ${region.end} count`);
      const beginStart = source.indexOf(region.begin);
      const endStart = source.indexOf(region.end, beginStart + region.begin.length);
      const start = beginStart - region.leading.length;
      const end = endStart + region.end.length + region.trailing.length;
      assert.ok(beginStart >= 0 && endStart > beginStart && start >= 0, `delivery: ${region.begin} order`);
      assert.equal(source.slice(start, beginStart), region.leading, `delivery: ${region.begin} leading`);
      assert.equal(source.slice(endStart + region.end.length, end), region.trailing, `delivery: ${region.end} trailing`);
      return { start, end };
    }).sort((left, right) => right.start - left.start);
    for (let index = 1; index < intervals.length; index += 1) {
      assert.ok(intervals[index - 1].start >= intervals[index].end, "delivery: A8-C3 regions must not overlap");
    }
    let projected = source;
    for (const interval of intervals) projected = projected.slice(0, interval.start) + projected.slice(interval.end);
    return projected;
  };
  const protectedRuntimeBytes = (path: string): Buffer | string => {
    const bytes = readFileSync(join(root, path));
    if (path !== "src/lib/loop-jobs/delivery.ts") return bytes;
    const source = projectDeliveryBeforeA8C3(bytes.toString("utf8"));
    let cursor = 0;
    let reconstructed = "";
    for (const snippet of deliveryA8C2Snippets) {
      assert.equal(source.split(snippet.begin).length - 1, 1, `delivery: ${snippet.begin} count`);
      assert.equal(source.split(snippet.end).length - 1, 1, `delivery: ${snippet.end} count`);
      const markerStart = source.indexOf(snippet.begin);
      const snippetStart = markerStart - snippet.leading.length;
      assert.ok(snippetStart >= cursor, "delivery: A8-C2 marker order/non-overlap");
      assert.equal(source.slice(snippetStart, markerStart), snippet.leading, "delivery: A8-C2 leading delimiter");
      const endMarkerStart = source.indexOf(snippet.end, markerStart + snippet.begin.length);
      assert.ok(endMarkerStart > markerStart, "delivery: A8-C2 marker order");
      const endMarkerEnd = endMarkerStart + snippet.end.length;
      const snippetEnd = endMarkerEnd + snippet.trailing.length;
      assert.equal(source.slice(endMarkerEnd, snippetEnd), snippet.trailing, "delivery: A8-C2 trailing delimiter");
      reconstructed += source.slice(cursor, snippetStart);
      cursor = snippetEnd;
    }
    return reconstructed + source.slice(cursor);
  };
  for (const [path, expected] of Object.entries(protectedRuntimeSha256)) {
    assert.equal(sha256(protectedRuntimeBytes(path)), expected, path);
  }

  const schemaPath = join(root, "prisma/schema.prisma");
  const schemaSource = readFileSync(schemaPath, "utf8");
  const schemaA8C3Regions = [
    {
      begin: "// A8-C3 BEGIN: LoopJob execution generation metadata",
      end: "// A8-C3 END: LoopJob execution generation metadata",
      leading: "  ",
      trailing: "\n",
    },
    {
      begin: "// A8-C3 BEGIN: LoopJob execution generation indexes",
      end: "// A8-C3 END: LoopJob execution generation indexes",
      leading: "  ",
      trailing: "\n",
    },
    {
      begin: "// A8-C3 BEGIN: HCycle activation execution jobs relation",
      end: "// A8-C3 END: HCycle activation execution jobs relation",
      leading: "  ",
      trailing: "\n",
    },
  ] as const;
  const projectedSchemaSource = (() => {
    const intervals = schemaA8C3Regions.map((region) => {
      assert.equal(schemaSource.split(region.begin).length - 1, 1, `schema: ${region.begin} count`);
      assert.equal(schemaSource.split(region.end).length - 1, 1, `schema: ${region.end} count`);
      const beginStart = schemaSource.indexOf(region.begin);
      const endStart = schemaSource.indexOf(region.end, beginStart + region.begin.length);
      const start = beginStart - region.leading.length;
      const end = endStart + region.end.length + region.trailing.length;
      assert.ok(beginStart >= 0 && endStart > beginStart && start >= 0, `schema: ${region.begin} order`);
      assert.equal(schemaSource.slice(start, beginStart), region.leading, `schema: ${region.begin} leading`);
      assert.equal(schemaSource.slice(endStart + region.end.length, end), region.trailing, `schema: ${region.end} trailing`);
      return { start, end };
    }).sort((left, right) => right.start - left.start);
    let projected = schemaSource;
    for (const interval of intervals) projected = projected.slice(0, interval.start) + projected.slice(interval.end);
    return projected;
  })();
  const addedSchemaStart = projectedSchemaSource.indexOf("// A8-C1: redacted control facts only.");
  const addedSchemaEnd = projectedSchemaSource.indexOf("// 学び", addedSchemaStart);
  assert.ok(addedSchemaStart >= 0 && addedSchemaEnd > addedSchemaStart, "A8-C1 schema block must remain self-contained");
  assert.equal(
    sha256(projectedSchemaSource.slice(0, addedSchemaStart) + projectedSchemaSource.slice(addedSchemaEnd)),
    "e119fa710fbe71648ef1389a36a5fb64fa06926a30b4d6b64526aa4e884251ae",
    "unexpected pre-existing Prisma schema change",
  );
  for (const expectedSchemaFragment of [
    "model HCycleActivationEvent {",
    "generationRoot           HCycleActivationEvent? @relation(\"HCycleActivationEventGeneration\"",
    "model HCycleActivationEvidence {",
    "generation         HCycleActivationEvent @relation(fields: [generationSequence]",
    "@@unique([generationSequence, evidenceKind, observedAt])",
  ]) {
    assert.equal(schemaSource.includes(expectedSchemaFragment), true, expectedSchemaFragment);
  }

  const activationMigration = readFileSync(
    join(root, "prisma/migrations/20260824160000_h_cycle_activation_control_ledger/migration.sql"),
    "utf8",
  );
  for (const triggerName of [
    "HCycleActivationEvent_validate_insert",
    "HCycleActivationEvidence_validate_insert",
    "HCycleActivationEvent_no_update",
    "HCycleActivationEvent_no_delete",
    "HCycleActivationEvidence_no_update",
    "HCycleActivationEvidence_no_delete",
  ]) {
    assert.equal(activationMigration.includes(triggerName), true, triggerName);
  }
  assert.doesNotMatch(
    activationMigration,
    /(?:DATABASE_URL|DOTENV_CONFIG_PATH|file:|launchctl|\.plist|HCycleEvaluationRecord|INSERT\s+INTO\s+"LoopJob")/i,
  );
  assert.equal(
    sha256(readFileSync(join(root, "prisma/migrations/20260826100000_h_cycle_generation_scoped_execution/migration.sql"))),
    "9b77d5414d1363d7edc53844b865f15f152f83913a69ccd48784e2bb80ebb624",
    "C3b migration bytes must remain frozen",
  );

  const phaseTwoPath = join(root, "src/lib/loop-jobs/worker-phase2.ts");
  const phaseTwoSource = readFileSync(phaseTwoPath, "utf8");
  const phaseTwoFile = ts.createSourceFile(phaseTwoPath, phaseTwoSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let emptyProductionRegistry = false;
  let emptyDeliveryHandlers = false;
  const visitPhaseTwo = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "productionRegistry"
      && node.initializer !== undefined
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "defineLoopJobRegistry"
      && node.initializer.arguments.length === 1
      && ts.isObjectLiteralExpression(node.initializer.arguments[0])
      && node.initializer.arguments[0].properties.length === 0) {
      emptyProductionRegistry = true;
    }
    if (ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "handlers"
      && ts.isObjectLiteralExpression(node.initializer)
      && node.initializer.properties.length === 0) {
      emptyDeliveryHandlers = true;
    }
    ts.forEachChild(node, visitPhaseTwo);
  };
  visitPhaseTwo(phaseTwoFile);
  assert.equal(emptyProductionRegistry, true);
  assert.equal(emptyDeliveryHandlers, true);
  assert.equal(phaseTwoSource.includes("h-cycle-activation-control-ledger-v1"), false);

  await withFixture(async (client, fixture) => {
    const databaseRelativePath = relative(fixture.directory, fixture.databasePath);
    const dotenvRelativePath = relative(fixture.directory, fixture.dotenvConfigPath);
    assert.equal(isAbsolute(fixture.directory), true);
    assert.equal(isAbsolute(databaseRelativePath), false);
    assert.equal(isAbsolute(dotenvRelativePath), false);
    assert.equal(databaseRelativePath.startsWith(".."), false);
    assert.equal(dotenvRelativePath.startsWith(".."), false);
    assert.equal(fixture.databaseUrl, `file:${fixture.databasePath}`);
    assert.equal(existsSync(fixture.databasePath), true);
    assert.equal(existsSync(fixture.dotenvConfigPath), false);

    const beforeEvents = await client.hCycleActivationEvent.count();
    const beforeEvidence = await client.hCycleActivationEvidence.count();
    assert.deepEqual(
      await readHCycleActivationControlStateV1(
        { client, clock: { now: () => new Date(CURRENT_JST_WEEK.getTime()) } },
        { schema: "h_cycle_activation_control_read_v1" },
      ),
      { ok: true, featureState: "off", state: "unattested" },
    );
    assert.equal(await client.hCycleActivationEvent.count(), beforeEvents);
    assert.equal(await client.hCycleActivationEvidence.count(), beforeEvidence);
  });
});
