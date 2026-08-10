-- ADR-0020 daily textbook
CREATE TABLE "DailyTextbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lead" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "materialCount" INTEGER NOT NULL DEFAULT 0,
    "chapterCount" INTEGER NOT NULL DEFAULT 0,
    "peakHour" INTEGER,
    "droppedMaterialIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "DailyTextbook_dateKey_key" ON "DailyTextbook"("dateKey");

CREATE TABLE "DailyTextbookChapter" (
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
    CONSTRAINT "DailyTextbookChapter_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "DailyTextbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailyTextbookChapter_textbookId_index_key" ON "DailyTextbookChapter"("textbookId", "index");

CREATE TABLE "DailyTextbookCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textbookId" TEXT NOT NULL,
    "chapterId" TEXT,
    "index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "mastery" TEXT,
    "answeredAt" DATETIME,
    CONSTRAINT "DailyTextbookCheck_textbookId_fkey" FOREIGN KEY ("textbookId") REFERENCES "DailyTextbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyTextbookCheck_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "DailyTextbookChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailyTextbookCheck_textbookId_index_key" ON "DailyTextbookCheck"("textbookId", "index");
