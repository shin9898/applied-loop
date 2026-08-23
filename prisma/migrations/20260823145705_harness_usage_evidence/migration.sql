-- AlterTable
ALTER TABLE "HarnessRun" ADD COLUMN "cacheReadTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "cacheWriteTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "collectorVersion" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "contextFingerprint" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "inputTotalTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "inputUncachedTokens" INTEGER;
ALTER TABLE "HarnessRun" ADD COLUMN "usageNormalizationReason" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "usageNormalizationStatus" TEXT;
ALTER TABLE "HarnessRun" ADD COLUMN "usageSemanticsVersion" TEXT;
