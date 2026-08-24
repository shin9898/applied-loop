-- A8-B1: append-only, aggregate-only record for one H-CYCLE period pair.
-- No job, scheduler, or operator activation is introduced by this migration.
CREATE TABLE "HCycleEvaluationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordSchema" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "projectionSchemaVersion" TEXT NOT NULL,
    "previousWeekKey" TEXT NOT NULL,
    "targetWeekKey" TEXT NOT NULL,
    "previousPeriodJson" TEXT NOT NULL,
    "targetPeriodJson" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "evaluatedAt" DATETIME NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "timeliness" TEXT NOT NULL,
    "aggregateEnvelopeJson" TEXT NOT NULL,
    "aggregateEnvelopeSha256" TEXT NOT NULL,
    "recordSha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HCycleEvaluationRecord_trigger_timeliness_check" CHECK (
        ("triggerKind" = 'scheduled' AND "timeliness" = 'on_time')
        OR ("triggerKind" = 'catch_up' AND "timeliness" = 'catch_up')
    ),
    CONSTRAINT "HCycleEvaluationRecord_aggregate_hash_check" CHECK (
        length("aggregateEnvelopeSha256") = 64
        AND "aggregateEnvelopeSha256" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "HCycleEvaluationRecord_record_hash_check" CHECK (
        length("recordSha256") = 64
        AND "recordSha256" NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE UNIQUE INDEX "HCycleEvaluationRecord_recordSchema_policyVersion_projectionSchemaVersion_targetWeekKey_key"
ON "HCycleEvaluationRecord"("recordSchema", "policyVersion", "projectionSchemaVersion", "targetWeekKey");

CREATE INDEX "HCycleEvaluationRecord_targetWeekKey_createdAt_idx"
ON "HCycleEvaluationRecord"("targetWeekKey", "createdAt");

CREATE TRIGGER "HCycleEvaluationRecord_no_update"
BEFORE UPDATE ON "HCycleEvaluationRecord"
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_evaluation_record_append_only');
END;

CREATE TRIGGER "HCycleEvaluationRecord_no_delete"
BEFORE DELETE ON "HCycleEvaluationRecord"
BEGIN
    SELECT RAISE(ABORT, 'h_cycle_evaluation_record_append_only');
END;
