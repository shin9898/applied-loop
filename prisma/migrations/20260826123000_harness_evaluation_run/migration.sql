-- A9-B: append-only durable envelope for one deterministic harness evaluation.
-- This migration stores aggregate report output only; it does not add a job,
-- scheduler, worker, activation binding, or source-data mirror.
CREATE TABLE "HarnessEvaluationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordSchema" TEXT NOT NULL,
    "reportSchema" TEXT NOT NULL,
    "evaluationKeyHash" TEXT NOT NULL,
    "evaluatedAt" DATETIME NOT NULL,
    "reportEnvelopeJson" TEXT NOT NULL,
    "reportEnvelopeSha256" TEXT NOT NULL,
    "recordSha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarnessEvaluationRun_evaluation_key_hash_check" CHECK (
        length("evaluationKeyHash") = 64
        AND "evaluationKeyHash" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "HarnessEvaluationRun_report_hash_check" CHECK (
        length("reportEnvelopeSha256") = 64
        AND "reportEnvelopeSha256" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "HarnessEvaluationRun_record_hash_check" CHECK (
        length("recordSha256") = 64
        AND "recordSha256" NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE UNIQUE INDEX "HarnessEvaluationRun_recordSchema_reportSchema_evaluationKeyHash_key"
ON "HarnessEvaluationRun"("recordSchema", "reportSchema", "evaluationKeyHash");

CREATE INDEX "HarnessEvaluationRun_evaluatedAt_createdAt_idx"
ON "HarnessEvaluationRun"("evaluatedAt", "createdAt");

CREATE TRIGGER "HarnessEvaluationRun_no_update"
BEFORE UPDATE ON "HarnessEvaluationRun"
BEGIN
    SELECT RAISE(ABORT, 'harness_evaluation_run_append_only');
END;

CREATE TRIGGER "HarnessEvaluationRun_no_delete"
BEFORE DELETE ON "HarnessEvaluationRun"
BEGIN
    SELECT RAISE(ABORT, 'harness_evaluation_run_append_only');
END;
