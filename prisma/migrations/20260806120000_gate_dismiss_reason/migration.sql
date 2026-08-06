-- Core tables that drifted ahead of migrations (Gate/DevEvent/…).
-- Includes dismissReason on Gate (replaces the old ALTER-only migration).
-- Capture/Entry column adds are for clean DBs; existing DBs should mark this migration applied without re-run if columns already exist.

-- AlterTable
ALTER TABLE "Capture" ADD COLUMN "importanceScore" INTEGER;
ALTER TABLE "Capture" ADD COLUMN "triageReason" TEXT;

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "domain" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "SrCard";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DailyTaskMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dateKey" TEXT NOT NULL,
    "mappings" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DevEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "repoPath" TEXT,
    "ref" TEXT NOT NULL,
    "summary" TEXT,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Gate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT,
    "misconceptionId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'initial',
    "question" TEXT NOT NULL,
    "targetConcept" TEXT,
    "domain" TEXT,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gradeNote" TEXT,
    "dismissReason" TEXT,
    "resources" TEXT,
    "rubricCriteria" TEXT,
    "rubricResult" TEXT,
    "contextSummary" TEXT,
    "answerMode" TEXT,
    "accessedResource" BOOLEAN NOT NULL DEFAULT false,
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    "gradedAt" DATETIME,
    CONSTRAINT "Gate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DevEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Gate_misconceptionId_fkey" FOREIGN KEY ("misconceptionId") REFERENCES "Misconception" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Misconception" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "concept" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rootCause" TEXT,
    "firstGateId" TEXT,
    "resolvedAt" DATETIME,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WeaknessPatternCache" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "resultJson" TEXT NOT NULL,
    "gradedCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kdi" TEXT,
    "focusDomains" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoalLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalLink_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoalReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalReview_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HarnessRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "harness" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "model" TEXT,
    "repo" TEXT,
    "tools" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "cacheRead" INTEGER NOT NULL DEFAULT 0,
    "cacheCreate" INTEGER NOT NULL DEFAULT 0,
    "thinking" INTEGER NOT NULL DEFAULT 0,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "why" TEXT,
    "criteria" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "understoodAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RequirementLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requirementId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequirementLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DailyTaskMap_dateKey_key" ON "DailyTaskMap"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DevEvent_kind_repo_ref_key" ON "DevEvent"("kind", "repo", "ref");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GoalLink_goalId_targetType_targetId_key" ON "GoalLink"("goalId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GoalReview_goalId_weekKey_key" ON "GoalReview"("goalId", "weekKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HarnessRun_harness_sessionId_key" ON "HarnessRun"("harness", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RequirementLink_requirementId_targetType_targetId_key" ON "RequirementLink"("requirementId", "targetType", "targetId");
