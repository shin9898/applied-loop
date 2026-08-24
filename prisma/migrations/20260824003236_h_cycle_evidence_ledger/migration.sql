-- CreateTable
CREATE TABLE "TextbookCheckEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKind" TEXT NOT NULL,
    "textbookKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checkIndex" INTEGER NOT NULL,
    "chapterIndex" INTEGER,
    "sourceRevisionHash" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TextbookCheckMasteryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evidenceId" TEXT NOT NULL,
    "mastery" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextbookCheckMasteryEvent_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "TextbookCheckEvidence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TextbookCheckEvidence_firstObservedAt_idx" ON "TextbookCheckEvidence"("firstObservedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckEvidence_sourceKind_textbookKey_source_checkIndex_sourceRevisionHash_key" ON "TextbookCheckEvidence"("sourceKind", "textbookKey", "source", "checkIndex", "sourceRevisionHash");

-- CreateIndex
CREATE INDEX "TextbookCheckMasteryEvent_evidenceId_recordedAt_idx" ON "TextbookCheckMasteryEvent"("evidenceId", "recordedAt");
