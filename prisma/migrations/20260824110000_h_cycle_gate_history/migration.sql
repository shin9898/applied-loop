-- CreateTable
CREATE TABLE "TextbookCheckGateStateEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextbookCheckGateStateEvent_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TextbookCheckGateStateEvent_ordinal_check" CHECK ("ordinal" >= 1),
    CONSTRAINT "TextbookCheckGateStateEvent_status_check" CHECK (
        "status" IN (
            'pending', 'answered', 'grading', 'grading_failed', 'passed', 'failed',
            'self_graded_pass', 'self_graded_fail', 'dismissed', 'parked'
        )
    )
);

-- CreateTable
CREATE TABLE "TextbookCheckGateFailureCapture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "failedStateEventId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextbookCheckGateFailureCapture_failedStateEventId_fkey" FOREIGN KEY ("failedStateEventId") REFERENCES "TextbookCheckGateStateEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TextbookCheckGateFailureCapture_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "Capture" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TextbookCheckGateFollowupObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "failureCaptureId" TEXT NOT NULL,
    "misconceptionId" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextbookCheckGateFollowupObservation_failureCaptureId_fkey" FOREIGN KEY ("failureCaptureId") REFERENCES "TextbookCheckGateFailureCapture" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TextbookCheckGateFollowupObservation_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "Misconception" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckGateStateEvent_gateId_ordinal_key" ON "TextbookCheckGateStateEvent"("gateId", "ordinal");

-- CreateIndex
CREATE INDEX "TextbookCheckGateStateEvent_gateId_recordedAt_idx" ON "TextbookCheckGateStateEvent"("gateId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckGateFailureCapture_captureId_key" ON "TextbookCheckGateFailureCapture"("captureId");

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckGateFailureCapture_failedStateEventId_captureId_key" ON "TextbookCheckGateFailureCapture"("failedStateEventId", "captureId");

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckGateFollowupObservation_failureCaptureId_key" ON "TextbookCheckGateFollowupObservation"("failureCaptureId");

-- CreateIndex
CREATE INDEX "TextbookCheckGateFollowupObservation_misconceptionId_observedAt_idx" ON "TextbookCheckGateFollowupObservation"("misconceptionId", "observedAt");
