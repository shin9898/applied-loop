-- A8-C3b: execution generation is internal H-CYCLE metadata. Existing and
-- foreign LoopJob rows retain NULL; a NULL H-CYCLE row is deliberately inert.
-- SQLite needs a table rebuild to attach the restrictive foreign key.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_LoopJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "availableAt" DATETIME NOT NULL,
    "lockedAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "lockedBy" TEXT,
    "leaseToken" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "executionGenerationSequence" INTEGER,
    CONSTRAINT "LoopJob_id_check" CHECK (
        length("id") = 36 AND substr("id", 1, 4) = 'job_' AND substr("id", 5) NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "LoopJob_kind_check" CHECK (
        length("kind") BETWEEN 1 AND 32 AND substr("kind", 1, 1) GLOB '[a-z]' AND "kind" NOT GLOB '*[^a-z0-9_]*'
    ),
    CONSTRAINT "LoopJob_payload_hash_check" CHECK (
        length("payloadHash") = 64 AND "payloadHash" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "LoopJob_status_check" CHECK (
        "status" IN ('queued', 'running', 'retry_wait', 'succeeded', 'dead')
    ),
    CONSTRAINT "LoopJob_attempts_check" CHECK (
        "maxAttempts" >= 1 AND "attempts" >= 0 AND "attempts" <= "maxAttempts"
    ),
    CONSTRAINT "LoopJob_worker_identity_check" CHECK (
        "lockedBy" IS NULL OR (
            length("lockedBy") = 39 AND substr("lockedBy", 1, 7) = 'worker_' AND substr("lockedBy", 8) NOT GLOB '*[^0-9a-f]*'
        )
    ),
    CONSTRAINT "LoopJob_lease_token_check" CHECK (
        "leaseToken" IS NULL OR (length("leaseToken") = 64 AND "leaseToken" NOT GLOB '*[^0-9a-f]*')
    ),
    CONSTRAINT "LoopJob_last_error_check" CHECK (
        "lastError" IS NULL OR "lastError" IN ('handler_failed', 'unknown_kind', 'invalid_payload', 'lease_expired')
    ),
    CONSTRAINT "LoopJob_state_shape_check" CHECK (
        (
            "status" = 'running'
            AND "lockedAt" IS NOT NULL
            AND "leaseExpiresAt" IS NOT NULL
            AND "lockedBy" IS NOT NULL
            AND "leaseToken" IS NOT NULL
            AND "leaseExpiresAt" > "lockedAt"
            AND "finishedAt" IS NULL
        ) OR (
            "status" IN ('queued', 'retry_wait')
            AND "lockedAt" IS NULL
            AND "leaseExpiresAt" IS NULL
            AND "lockedBy" IS NULL
            AND "leaseToken" IS NULL
            AND "finishedAt" IS NULL
        ) OR (
            "status" IN ('succeeded', 'dead')
            AND "lockedAt" IS NULL
            AND "leaseExpiresAt" IS NULL
            AND "lockedBy" IS NULL
            AND "leaseToken" IS NULL
            AND "finishedAt" IS NOT NULL
        )
    ),
    CONSTRAINT "LoopJob_execution_generation_shape_check" CHECK (
        ("kind" != 'h_cycle_evaluate' AND "executionGenerationSequence" IS NULL)
        OR (
            "kind" = 'h_cycle_evaluate'
            AND ("executionGenerationSequence" IS NULL OR "executionGenerationSequence" > 0)
        )
    ),
    CONSTRAINT "LoopJob_executionGenerationSequence_fkey"
        FOREIGN KEY ("executionGenerationSequence") REFERENCES "HCycleActivationEvent" ("sequence")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

INSERT INTO "new_LoopJob" (
    "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
    "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
    "updatedAt", "finishedAt", "executionGenerationSequence"
)
SELECT
    "id", "kind", "dedupeKey", "payloadJson", "payloadHash", "status", "attempts", "maxAttempts",
    "availableAt", "lockedAt", "leaseExpiresAt", "lockedBy", "leaseToken", "lastError", "createdAt",
    "updatedAt", "finishedAt", NULL
FROM "LoopJob";

DROP TABLE "LoopJob";
ALTER TABLE "new_LoopJob" RENAME TO "LoopJob";

CREATE UNIQUE INDEX "LoopJob_dedupeKey_key" ON "LoopJob"("dedupeKey");
CREATE INDEX "LoopJob_status_availableAt_idx" ON "LoopJob"("status", "availableAt");
CREATE INDEX "LoopJob_status_leaseExpiresAt_idx" ON "LoopJob"("status", "leaseExpiresAt");
CREATE INDEX "LoopJob_kind_executionGenerationSequence_status_availableAt_idx"
ON "LoopJob"("kind", "executionGenerationSequence", "status", "availableAt");
CREATE INDEX "LoopJob_kind_executionGenerationSequence_status_leaseExpiresAt_idx"
ON "LoopJob"("kind", "executionGenerationSequence", "status", "leaseExpiresAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
