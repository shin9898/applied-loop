-- A8-C1: redacted, feature-off control facts only.
-- This migration is exercised exclusively against disposable SQLite fixtures.
CREATE TABLE "HCycleActivationEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventSchema" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "generationSequence" INTEGER,
    "packetSchema" TEXT,
    "packetStatus" TEXT,
    "targetClass" TEXT,
    "activationFloorWeekKey" TEXT,
    "schedulerClass" TEXT,
    "schedulerOwnership" TEXT,
    "stopRouteClass" TEXT,
    "recordedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HCycleActivationEvent_closed_shape" CHECK (
        "eventSchema" = 'h_cycle_activation_event_v1'
        AND (
            (
                "eventKind" IN ('packet_attested', 're_enabled')
                AND "generationSequence" IS NULL
                AND "packetSchema" IS 'h_cycle_private_packet_attestation_v1'
                AND "packetStatus" IS 'approved'
                AND "targetClass" IS 'existing_local_applied_loop_development_sqlite'
                AND "activationFloorWeekKey" IS NOT NULL
                AND "activationFloorWeekKey" GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
                AND "schedulerClass" IS 'macos_user_launchd'
                AND "schedulerOwnership" IS 'operator_manual_install'
                AND "stopRouteClass" IS 'same_user_agent_unload_remove'
            )
            OR (
                "eventKind" = 'disabled'
                AND "generationSequence" IS NOT NULL
                AND "packetSchema" IS NULL
                AND "packetStatus" IS NULL
                AND "targetClass" IS NULL
                AND "activationFloorWeekKey" IS NULL
                AND "schedulerClass" IS NULL
                AND "schedulerOwnership" IS NULL
                AND "stopRouteClass" IS NULL
            )
        )
    ),
    CONSTRAINT "HCycleActivationEvent_generationSequence_fkey"
        FOREIGN KEY ("generationSequence") REFERENCES "HCycleActivationEvent" ("sequence")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "HCycleActivationEvent_eventKind_sequence_idx"
ON "HCycleActivationEvent"("eventKind", "sequence");

CREATE TRIGGER "HCycleActivationEvent_validate_insert"
BEFORE INSERT ON "HCycleActivationEvent"
WHEN
    (
        (SELECT COUNT(*) FROM "HCycleActivationEvent") = 0
        AND (NEW."eventKind" != 'packet_attested' OR NEW."activationFloorWeekKey" != '2026-W35')
    )
    OR (
        (SELECT COUNT(*) FROM "HCycleActivationEvent") > 0
        AND NEW."eventKind" = 'packet_attested'
    )
    OR (
        NEW."eventKind" = 'disabled'
        AND (
            NEW."generationSequence" != (SELECT "sequence" FROM "HCycleActivationEvent" ORDER BY "sequence" DESC LIMIT 1)
            OR NOT EXISTS (
                SELECT 1
                FROM "HCycleActivationEvent" AS "root"
                WHERE "root"."sequence" = NEW."generationSequence"
                  AND "root"."eventKind" IN ('packet_attested', 're_enabled')
            )
        )
    )
    OR (
        NEW."eventKind" = 're_enabled'
        AND (
            (SELECT "eventKind" FROM "HCycleActivationEvent" ORDER BY "sequence" DESC LIMIT 1) != 'disabled'
            OR NEW."activationFloorWeekKey" <= (
                SELECT "root"."activationFloorWeekKey"
                FROM "HCycleActivationEvent" AS "root"
                WHERE "root"."sequence" = (
                    SELECT "generationSequence"
                    FROM "HCycleActivationEvent"
                    ORDER BY "sequence" DESC
                    LIMIT 1
                )
            )
        )
    )
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_activation_event_invalid_shape_or_sequence');
END;

CREATE TRIGGER "HCycleActivationEvent_no_update"
BEFORE UPDATE ON "HCycleActivationEvent"
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_activation_event_append_only');
END;

CREATE TRIGGER "HCycleActivationEvent_no_delete"
BEFORE DELETE ON "HCycleActivationEvent"
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_activation_event_append_only');
END;

CREATE TABLE "HCycleActivationEvidence" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "evidenceSchema" TEXT NOT NULL,
    "generationSequence" INTEGER NOT NULL,
    "evidenceKind" TEXT NOT NULL,
    "targetWeekKey" TEXT,
    "policyOutcome" TEXT,
    "observedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HCycleActivationEvidence_closed_shape" CHECK (
        "evidenceSchema" = 'h_cycle_activation_evidence_v1'
        AND (
            (
                "evidenceKind" = 'manual_a7c_read_only_observation'
                AND "targetWeekKey" IS NOT NULL
                AND "targetWeekKey" GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
                AND "policyOutcome" IS NOT NULL
                AND "policyOutcome" IN ('baseline_collecting', 'inconclusive', 'supported', 'rejected')
            )
            OR (
                "evidenceKind" IN (
                    'worker_heartbeat_enabled',
                    'worker_heartbeat_disabled',
                    'kill_switch_disposable_no_scan_enqueue_delivery_record',
                    'kill_switch_local_read_only_no_new_write',
                    'disable_queued_work_no_record',
                    'crash_after_record_same_digest_retry',
                    'hash_mismatch_integrity_stop',
                    'stale_lease_recovery',
                    'sleep_catch_up_oldest_one',
                    'pre_floor_no_backfill'
                )
                AND "targetWeekKey" IS NULL
                AND "policyOutcome" IS NULL
            )
        )
    ),
    CONSTRAINT "HCycleActivationEvidence_generationSequence_fkey"
        FOREIGN KEY ("generationSequence") REFERENCES "HCycleActivationEvent" ("sequence")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "HCycleActivationEvidence_generationSequence_evidenceKind_observedAt_key"
ON "HCycleActivationEvidence"("generationSequence", "evidenceKind", "observedAt");

CREATE UNIQUE INDEX "HCycleActivationEvidence_generationSequence_manual_targetWeekKey_key"
ON "HCycleActivationEvidence"("generationSequence", "targetWeekKey")
WHERE "evidenceKind" = 'manual_a7c_read_only_observation';

CREATE INDEX "HCycleActivationEvidence_generationSequence_evidenceKind_observedAt_idx"
ON "HCycleActivationEvidence"("generationSequence", "evidenceKind", "observedAt");

CREATE INDEX "HCycleActivationEvidence_generationSequence_sequence_idx"
ON "HCycleActivationEvidence"("generationSequence", "sequence");

CREATE TRIGGER "HCycleActivationEvidence_validate_insert"
BEFORE INSERT ON "HCycleActivationEvidence"
WHEN
    NOT EXISTS (
        SELECT 1
        FROM "HCycleActivationEvent" AS "root"
        WHERE "root"."sequence" = NEW."generationSequence"
          AND "root"."eventKind" IN ('packet_attested', 're_enabled')
    )
    OR NEW."generationSequence" != (
        SELECT "sequence"
        FROM "HCycleActivationEvent"
        ORDER BY "sequence" DESC
        LIMIT 1
    )
    OR julianday(NEW."observedAt") < julianday((
        SELECT "recordedAt"
        FROM "HCycleActivationEvent"
        WHERE "sequence" = NEW."generationSequence"
    ))
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_activation_evidence_invalid_shape_or_generation');
END;

CREATE TRIGGER "HCycleActivationEvidence_no_update"
BEFORE UPDATE ON "HCycleActivationEvidence"
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_activation_evidence_append_only');
END;

CREATE TRIGGER "HCycleActivationEvidence_no_delete"
BEFORE DELETE ON "HCycleActivationEvidence"
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_activation_evidence_append_only');
END;
