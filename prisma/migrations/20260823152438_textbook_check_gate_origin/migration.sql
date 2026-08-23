-- CreateTable
CREATE TABLE "TextbookCheckGateOrigin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "textbookKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checkIndex" INTEGER NOT NULL,
    "chapterIndex" INTEGER,
    "sourceRevisionHash" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "referenceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TextbookCheckGateOrigin_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "Gate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckGateOrigin_gateId_key" ON "TextbookCheckGateOrigin"("gateId");

-- CreateIndex
CREATE INDEX "TextbookCheckGateOrigin_sourceKind_textbookKey_source_checkIndex_idx" ON "TextbookCheckGateOrigin"("sourceKind", "textbookKey", "source", "checkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TextbookCheckGateOrigin_sourceKind_textbookKey_source_checkIndex_sourceRevisionHash_key" ON "TextbookCheckGateOrigin"("sourceKind", "textbookKey", "source", "checkIndex", "sourceRevisionHash");
