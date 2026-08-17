-- AlterTable
ALTER TABLE "DevEvent" ADD COLUMN "incorporatedAt" DATETIME;

-- CreateTable
CREATE TABLE "MaterialBand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dateKey" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "materialIds" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "compiledChapterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyTextbookChapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textbookId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "oneLiner" TEXT NOT NULL,
    "bodyPlain" TEXT NOT NULL,
    "bodyDeep" TEXT,
    "diagramKind" TEXT NOT NULL DEFAULT 'generic',
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "materialIds" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'auto',
    CONSTRAINT "DailyTextbookChapter_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "DailyTextbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DailyTextbookChapter" ("bodyDeep", "bodyPlain", "diagramKind", "evidenceJson", "id", "index", "materialIds", "oneLiner", "textbookId", "title") SELECT "bodyDeep", "bodyPlain", "diagramKind", "evidenceJson", "id", "index", "materialIds", "oneLiner", "textbookId", "title" FROM "DailyTextbookChapter";
DROP TABLE "DailyTextbookChapter";
ALTER TABLE "new_DailyTextbookChapter" RENAME TO "DailyTextbookChapter";
CREATE UNIQUE INDEX "DailyTextbookChapter_textbookId_index_key" ON "DailyTextbookChapter"("textbookId", "index");
CREATE TABLE "new_DailyTextbookCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textbookId" TEXT NOT NULL,
    "chapterId" TEXT,
    "index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "mastery" TEXT,
    "answeredAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'auto',
    CONSTRAINT "DailyTextbookCheck_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "DailyTextbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyTextbookCheck_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "DailyTextbookChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DailyTextbookCheck" ("answeredAt", "chapterId", "id", "index", "mastery", "question", "textbookId") SELECT "answeredAt", "chapterId", "id", "index", "mastery", "question", "textbookId" FROM "DailyTextbookCheck";
DROP TABLE "DailyTextbookCheck";
ALTER TABLE "new_DailyTextbookCheck" RENAME TO "DailyTextbookCheck";
CREATE UNIQUE INDEX "DailyTextbookCheck_textbookId_index_key" ON "DailyTextbookCheck"("textbookId", "index");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MaterialBand_dateKey_repo_key" ON "MaterialBand"("dateKey", "repo");
