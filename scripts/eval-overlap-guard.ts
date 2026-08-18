/**
 * しれん重複ガード (ADR-0021 / docs/superpowers/specs/2026-08-18-gate-duplicate-guard-design.md)
 * のゴールデンケース + 実機確認スクリプト。
 *
 * grading-probe / eval-grade-spot と同じ位置づけ: 手動実行のみ、CI には入れない。
 * LLM 分類そのもの（duplicate/refinement/unrelated）は決定論的に保証できないため、
 * 「関係カテゴリが一致するか」という性質だけを見る。
 *
 * ケース1〜3は既存 Misconception をその場で用意するだけで DB には触れない。
 * ケース5（同一バッチ連続 accept）だけは実際に Capture/Misconception を作成し、
 * 検証後に必ず削除する（[eval-overlap-guard-test] マーカー付きの架空内容のみ使用）。
 *
 * Usage:
 *   npx tsx scripts/eval-overlap-guard.ts
 */
import { prisma } from "../src/lib/db";
import {
  checkMisconceptionOverlap,
  type MisconceptionForOverlap,
} from "../src/lib/misconception-overlap";
import { triageCapture } from "../src/lib/capture";

type GoldenCase = {
  name: string;
  candidate: { title: string; note: string | null; contextSummary: string | null };
  existing: MisconceptionForOverlap[];
  targetId: string;
  expected: "duplicate" | "refinement" | "unrelated";
};

const CASES: GoldenCase[] = [
  {
    name: "1. duplicate",
    candidate: {
      title: "useEffect の deps は毎レンダー浅い比較される、という理解のずれ",
      note: null,
      contextSummary: null,
    },
    existing: [
      {
        id: "case1-existing",
        concept: "useEffectの依存配列は参照比較で判定されると誤解",
        status: "open",
        rootCause: null,
      },
    ],
    targetId: "case1-existing",
    expected: "duplicate",
  },
  {
    // ADR-0021 の実例そのもの（cmsfz2p590003f1qys2lfo95h → cmssbczzj00q6v1qyv06ovdqz）
    name: "2. refinement（ADR-0021 実例）",
    candidate: {
      title:
        "キャッシュのヒット判定を「全体が完全一致しているか」という全体一致モデルで捉えており、" +
        "「先頭からの連続一致＝プレフィックス」という構造と、無効化がその位置より後ろだけに及ぶという局所性を見落としていた",
      note: null,
      contextSummary: null,
    },
    existing: [
      {
        id: "case2-existing",
        concept:
          "キャッシュのヒットを「識別子や意味の近さで引き当てる参照」だと捉えており、実際は内容そのものの先頭からの逐語一致で決まる",
        status: "resolved",
        rootCause: null,
      },
    ],
    targetId: "case2-existing",
    expected: "refinement",
  },
  {
    name: "3. unrelated",
    candidate: {
      title: "Reactのuseeffectは仮想DOM差分計算の一部として同期的に実行される、という理解のずれ",
      note: null,
      contextSummary: null,
    },
    existing: [
      {
        id: "case3-existing",
        concept: "SQLiteのWALモードは並行読み取り可能",
        status: "open",
        rootCause: null,
      },
    ],
    targetId: "case3-existing",
    expected: "unrelated",
  },
];

async function runClassificationCases(): Promise<boolean> {
  console.log("# ゴールデンケース 1〜3（LLM分類の質チェック・CI対象外）");
  console.log("");
  let allOk = true;
  for (const c of CASES) {
    const outcome = await checkMisconceptionOverlap(c.candidate, c.existing);
    if (!outcome.ok) {
      console.log(`${c.name}: FAIL（LLM呼び出し失敗: ${outcome.error}）`);
      allOk = false;
      continue;
    }
    const match = outcome.matches.find((m) => m.id === c.targetId);
    // unrelated は matches に載らない設計なので、見つからなければ unrelated 扱い
    const actual = match?.relation ?? "unrelated";
    const pass = actual === c.expected;
    if (!pass) allOk = false;
    console.log(
      `${c.name}: ${pass ? "PASS" : "FAIL"} (expected=${c.expected} actual=${actual}` +
        `${match ? ` reason="${match.reason}"` : ""})`,
    );
  }
  console.log("");
  return allOk;
}

/**
 * ゴールデンケース5: 同一バッチ連続 accept。
 * 1件目の accept で新規作成された Misconception が、2件目の accept の比較対象に
 * 正しく含まれるか（capture 時点ではなく accept 時点でクエリしていることの検証）。
 */
async function runSameBatchSequentialCase(): Promise<boolean> {
  console.log("# ゴールデンケース5: 同一バッチ連続accept（実DB書き込み・検証後に削除）");
  const marker = "[eval-overlap-guard-test]";
  const title1 =
    `${marker} 架空関数 zzqFetchWidget のリトライは呼び出し元ではなく widget 内部で行われる、と誤解していた`;
  const title2 =
    `${marker} 架空関数 zzqFetchWidget のリトライ処理は呼び出しコードではなく widget 自身の内部で走る、と勘違いしていた`;

  const capture1 = await prisma.capture.create({
    data: { title: title1, sourceTool: "gate", status: "pending" },
  });
  const capture2 = await prisma.capture.create({
    data: { title: title2, sourceTool: "gate", status: "pending" },
  });
  const createdMisconceptionIds: string[] = [];

  try {
    const result1 = await triageCapture(capture1.id, "accept");
    if (result1.ok !== true) {
      console.log(`1件目 accept: FAIL（想定外の結果: ${JSON.stringify(result1)}）`);
      return false;
    }
    const stored1 = await prisma.capture.findUnique({ where: { id: capture1.id } });
    if (stored1?.misconceptionId) createdMisconceptionIds.push(stored1.misconceptionId);
    console.log(`1件目 accept: OK（misconceptionId: ${stored1?.misconceptionId}）`);

    const result2 = await triageCapture(capture2.id, "accept");
    if (result2.ok === true) {
      const stored2 = await prisma.capture.findUnique({ where: { id: capture2.id } });
      if (stored2?.misconceptionId) createdMisconceptionIds.push(stored2.misconceptionId);
    }
    const pass =
      result2.ok === "needs_decision" &&
      result2.candidates.some((c) => c.id === stored1?.misconceptionId);
    console.log(
      `2件目 accept: ${pass ? "PASS" : "FAIL"}` +
        `（1件目で作成した Misconception を比較対象に含められたか） result=${JSON.stringify(result2)}`,
    );
    return pass;
  } finally {
    await prisma.capture.deleteMany({ where: { id: { in: [capture1.id, capture2.id] } } });
    if (createdMisconceptionIds.length > 0) {
      await prisma.misconception.deleteMany({ where: { id: { in: createdMisconceptionIds } } });
    }
    console.log("後片付け: テスト用 Capture / Misconception を削除しました。");
  }
}

async function main() {
  const classificationOk = await runClassificationCases();
  const sequentialOk = await runSameBatchSequentialCase();
  console.log("");
  console.log(`総合: ${classificationOk && sequentialOk ? "PASS" : "FAIL"}`);
  process.exit(classificationOk && sequentialOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
