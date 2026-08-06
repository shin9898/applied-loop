/**
 * チュートリアル用サンプルしれん／学びを投入する。
 * Usage: npx tsx scripts/seed-tutorial.ts
 */
import { ensureTutorialSeed } from "../src/lib/tutorial-seed";

async function main() {
  const r = await ensureTutorialSeed();
  console.log(
    r.created
      ? `created tutorial seed gate=${r.gateId} entry=${r.entryId}`
      : `tutorial seed already present gate=${r.gateId}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
