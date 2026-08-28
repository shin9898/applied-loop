import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";

async function withFixture<T>(run: (client: PrismaClient, databasePath: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "applied-loop-capture-schema-drift-"));
  const databasePath = join(directory, "fixture.db");
  try {
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const client = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databasePath, fileMustExist: true }),
    });
    try {
      return await run(client, databasePath);
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("BUGFIX-CG1 keeps gate-Capture triage usable while optional follow-up history is unmigrated", async () => {
  await withFixture(async (client, databasePath) => {
    const gate = await client.gate.create({
      data: { kind: "textbook_check", question: "schema drift fixture" },
    });
    const capture = await client.capture.create({
      data: {
        title: "schema drift capture",
        note: "the optional follow-up table is intentionally absent",
        sourceTool: "gate",
        sourceContext: `gateId:${gate.id}`,
      },
    });

    await client.$executeRawUnsafe('DROP TABLE "TextbookCheckGateFailureCapture"');

    const child = spawnSync(
      "./node_modules/.bin/tsx",
      [
        "-e",
        [
          'import { triageCapture } from "./src/lib/capture";',
          "void (async () => {",
          '  const result = await triageCapture(process.env.BUGFIX_CAPTURE_ID ?? "", "accept");',
          '  console.log(JSON.stringify(result));',
          '  if (result.ok !== true) throw new Error(JSON.stringify(result));',
          '})().catch((error) => { console.error(error); process.exitCode = 1; });',
        ].join("\n"),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: `file:${databasePath}`, BUGFIX_CAPTURE_ID: capture.id },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, `${child.stderr}\n${child.stdout}`);
    assert.match(child.stdout, /"ok":true/);

    const accepted = await client.capture.findUnique({ where: { id: capture.id } });
    assert.equal(accepted?.status, "accepted");
    assert.ok(accepted?.misconceptionId);
  });
});
