-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Capture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceTool" TEXT NOT NULL,
    "sourceContext" TEXT,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "entryId" TEXT,
    "dedupeKey" TEXT,
    "importanceScore" INTEGER,
    "triageReason" TEXT,
    "overlapCheckJson" TEXT,
    "misconceptionId" TEXT,
    CONSTRAINT "Capture_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Capture_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "Misconception" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Capture" ("capturedAt", "dedupeKey", "entryId", "id", "importanceScore", "note", "reviewedAt", "sourceContext", "sourceTool", "status", "title", "triageReason") SELECT "capturedAt", "dedupeKey", "entryId", "id", "importanceScore", "note", "reviewedAt", "sourceContext", "sourceTool", "status", "title", "triageReason" FROM "Capture";
DROP TABLE "Capture";
ALTER TABLE "new_Capture" RENAME TO "Capture";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
