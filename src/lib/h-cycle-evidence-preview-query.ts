import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import {
  readHCycleEvidenceSnapshotV1,
  type HCycleEvidenceSnapshotV1,
} from "./h-cycle-evidence-adapter";

export function createReadonlyHCycleEvidencePreviewClient(
  url: string,
): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url,
      readonly: true,
      fileMustExist: true,
    }),
  });
}

export async function queryHCycleEvidencePreviewSnapshotV1(
  client: PrismaClient,
): Promise<HCycleEvidenceSnapshotV1> {
  try {
    return await client.$transaction((transaction) => readHCycleEvidenceSnapshotV1(transaction));
  } finally {
    await client.$disconnect();
  }
}

export function queryReadonlyHCycleEvidencePreviewSnapshotV1(
  url: string,
): Promise<HCycleEvidenceSnapshotV1> {
  return queryHCycleEvidencePreviewSnapshotV1(
    createReadonlyHCycleEvidencePreviewClient(url),
  );
}
