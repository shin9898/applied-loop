-- CreateTable
CREATE TABLE "WeeklyTextbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lead" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "materialCount" INTEGER NOT NULL DEFAULT 0,
    "chapterCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WeeklyTextbookChapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weeklyId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "oneLiner" TEXT NOT NULL,
    "bodyPlain" TEXT NOT NULL,
    "bodyDeep" TEXT,
    "diagramKind" TEXT NOT NULL DEFAULT 'generic',
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "materialIds" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "WeeklyTextbookChapter_weeklyId_fkey" FOREIGN KEY ("weeklyId") REFERENCES "WeeklyTextbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyTextbookCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weeklyId" TEXT NOT NULL,
    "chapterId" TEXT,
    "index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "mastery" TEXT,
    "answeredAt" DATETIME,
    CONSTRAINT "WeeklyTextbookCheck_weeklyId_fkey" FOREIGN KEY ("weeklyId") REFERENCES "WeeklyTextbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyTextbookCheck_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "WeeklyTextbookChapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyTextbook_weekKey_key" ON "WeeklyTextbook"("weekKey");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyTextbookChapter_weeklyId_index_key" ON "WeeklyTextbookChapter"("weeklyId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyTextbookCheck_weeklyId_index_key" ON "WeeklyTextbookCheck"("weeklyId", "index");
