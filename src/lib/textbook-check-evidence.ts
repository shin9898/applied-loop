import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { isMasteryState, type MasteryState } from "./daily-textbook-shared";
import {
  createTextbookCheckSourceRevisionV1,
  type TextbookCheckSourceKind,
} from "./textbook-check-gate-origin";
import { readTextbookCheckSourceInputV1 } from "./textbook-check-gate-promotion-core";

type EvidenceClient = PrismaClient | Prisma.TransactionClient;

export type TextbookCheckEvidenceInput = Readonly<{
  sourceKind: TextbookCheckSourceKind;
  checkId: string;
}>;

function requireCheckId(checkId: string): string {
  const normalized = checkId.trim();
  if (!normalized) throw new Error("textbook check not found");
  return normalized;
}

async function readRequiredSource(
  client: EvidenceClient,
  input: TextbookCheckEvidenceInput,
) {
  const source = await readTextbookCheckSourceInputV1(
    client,
    input.sourceKind,
    requireCheckId(input.checkId),
  );
  if (source === null) throw new Error("textbook check not found");
  return source;
}

async function upsertEvidenceForSource(
  client: EvidenceClient,
  source: Awaited<ReturnType<typeof readRequiredSource>>,
) {
  const revision = createTextbookCheckSourceRevisionV1(source.input);
  return client.textbookCheckEvidence.upsert({
    where: {
      sourceKind_textbookKey_source_checkIndex_sourceRevisionHash: {
        sourceKind: revision.sourceKind,
        textbookKey: revision.textbookKey,
        source: revision.source,
        checkIndex: revision.checkIndex,
        sourceRevisionHash: revision.sourceRevisionHash,
      },
    },
    update: {},
    create: {
      sourceKind: revision.sourceKind,
      textbookKey: revision.textbookKey,
      source: revision.source,
      checkIndex: revision.checkIndex,
      chapterIndex: revision.chapterIndex,
      sourceRevisionHash: revision.sourceRevisionHash,
      questionHash: revision.questionHash,
    },
  });
}

/**
 * Persists one logical revision observation using the caller's transaction.
 * It does not create a Mastery event and never receives a question/reference
 * body, hash, or time from a client/UI caller.
 */
export async function observeTextbookCheckEvidenceForCheck(
  client: EvidenceClient,
  input: TextbookCheckEvidenceInput,
) {
  return upsertEvidenceForSource(client, await readRequiredSource(client, input));
}

async function saveTextbookCheckMastery(
  client: PrismaClient,
  sourceKind: TextbookCheckSourceKind,
  checkId: string,
  mastery: MasteryState,
): Promise<void> {
  if (!isMasteryState(mastery)) throw new Error("invalid mastery");
  const recordedAt = new Date();
  await client.$transaction(async (tx) => {
    const source = await readRequiredSource(tx, { sourceKind, checkId });
    const evidence = await upsertEvidenceForSource(tx, source);
    if (sourceKind === "daily") {
      await tx.dailyTextbookCheck.update({
        where: { id: requireCheckId(checkId) },
        data: { mastery, answeredAt: recordedAt },
      });
    } else {
      await tx.weeklyTextbookCheck.update({
        where: { id: requireCheckId(checkId) },
        data: { mastery, answeredAt: recordedAt },
      });
    }
    await tx.textbookCheckMasteryEvent.create({
      data: { evidenceId: evidence.id, mastery, recordedAt },
    });
  });
}

/** Records an explicit authenticated daily Mastery save and its append-only event. */
export async function saveDailyTextbookCheckMastery(
  client: PrismaClient,
  checkId: string,
  mastery: MasteryState,
): Promise<void> {
  return saveTextbookCheckMastery(client, "daily", checkId, mastery);
}

/** Records an explicit authenticated weekly Mastery save and its append-only event. */
export async function saveWeeklyTextbookCheckMastery(
  client: PrismaClient,
  checkId: string,
  mastery: MasteryState,
): Promise<void> {
  return saveTextbookCheckMastery(client, "weekly", checkId, mastery);
}
