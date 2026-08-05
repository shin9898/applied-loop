-- CreateTable
CREATE TABLE "Capture" (
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
    CONSTRAINT "Capture_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SrCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "created" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReview" DATETIME,
    "nextReview" DATETIME NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "entryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active'
);
INSERT INTO "new_SrCard" ("answer", "created", "easeFactor", "id", "interval", "lastReview", "nextReview", "question", "repetitions", "score", "topic") SELECT "answer", "created", "easeFactor", "id", "interval", "lastReview", "nextReview", "question", "repetitions", "score", "topic" FROM "SrCard";
DROP TABLE "SrCard";
ALTER TABLE "new_SrCard" RENAME TO "SrCard";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
