/**
 * 初心者向けサンプルデータ。空の朝でも地図・しれん・にっきが空にならない。
 */
import { prisma } from "@/lib/db";
import { dateKeyJST, dayStartJST } from "@/lib/date";
import {
  TUTORIAL_ENTRY_ID,
  TUTORIAL_GATE_ID,
  TUTORIAL_MISC_ID,
} from "@/lib/tutorial-constants";

export type TutorialSeedResult = {
  gateId: string;
  entryId: string;
  created: boolean;
};

export async function ensureTutorialSeed(): Promise<TutorialSeedResult> {
  const existing = await prisma.gate.findUnique({
    where: { id: TUTORIAL_GATE_ID },
    select: { id: true },
  });
  if (existing) {
    return {
      gateId: TUTORIAL_GATE_ID,
      entryId: TUTORIAL_ENTRY_ID,
      created: false,
    };
  }

  await prisma.entry.upsert({
    where: { id: TUTORIAL_ENTRY_ID },
    create: {
      id: TUTORIAL_ENTRY_ID,
      title: "理解ギャップは「動く」と「説明できる」の差である",
      source: "tutorial",
      kind: "insight",
      domain: "学習 / メタ",
      note: "チュートリアル用のサンプル学び。AI で実装できても、レビューで意図を言えない状態を指す。",
    },
    update: {},
  });

  await prisma.misconception.upsert({
    where: { id: TUTORIAL_MISC_ID },
    create: {
      id: TUTORIAL_MISC_ID,
      concept: "「動く実装」と「説明できる理解」を同じだと思っている",
      status: "open",
      rootCause: "knowledge",
    },
    update: {},
  });

  await prisma.gate.create({
    data: {
      id: TUTORIAL_GATE_ID,
      kind: "initial",
      status: "pending",
      misconceptionId: TUTORIAL_MISC_ID,
      domain: "学習 / メタ",
      targetConcept: "理解ギャップ",
      question:
        "最近、生成AIでコードは出せたが「なぜ動くか」を自分の言葉で言えなかった場面を1つ挙げ、何が足りなかったかを2〜4文で書いてください。",
      contextSummary: [
        "場面の例: PRレビューで設計意図を聞かれた／障害で再現手順を説明できなかった／翌日に同じ修正をやり直した。",
        "このサンプルはコミット由来ではない。3分以内で書いて提出し、採点結果（CLEAR / miss / 保留）が戻るところまで体験する。",
      ].join("\n"),
      rubricCriteria: JSON.stringify([
        "具体的な場面が1つある（レビュー・障害・再作業など）",
        "「動いた／出荷できた」と「説明・再現できた」の差に触れている",
        "一般論だけで終わらず、自分の体験か観察が入っている",
      ]),
      resources: JSON.stringify([
        {
          kind: "adr",
          label: "ADR-0006: 理解度ゲート（しれん）の考え方",
          ref: "docs/adr/0006-comprehension-gate.md",
        },
        {
          kind: "adr",
          label: "ADR-0007: リソース常時提示・調査力",
          ref: "docs/adr/0007-gate-resources-rubric.md",
        },
      ]),
    },
  });

  // 昨日の任務デモ（今日が空のときのフォールバック用）
  const y = new Date(dayStartJST(new Date()).getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = dateKeyJST(y);
  const yMap = await prisma.dailyTaskMap.findUnique({
    where: { dateKey: yesterdayKey },
  });
  if (!yMap) {
    await prisma.dailyTaskMap.create({
      data: {
        dateKey: yesterdayKey,
        mappings: JSON.stringify([
          {
            task: "（デモ）チュートリアルのしれんを1問解く",
            related: [
              {
                type: "gate",
                id: TUTORIAL_GATE_ID,
                reason: "サンプル出題",
              },
              {
                type: "entry",
                id: TUTORIAL_ENTRY_ID,
                reason: "関連する学び",
              },
            ],
          },
        ]),
      },
    });
  }

  return {
    gateId: TUTORIAL_GATE_ID,
    entryId: TUTORIAL_ENTRY_ID,
    created: true,
  };
}

/** サンプルしれんを「提出済み」とみなすか（採点完了は不要） */
export async function isTutorialGateSubmitted(): Promise<boolean> {
  const gate = await prisma.gate.findUnique({
    where: { id: TUTORIAL_GATE_ID },
    select: { status: true, answeredAt: true },
  });
  if (!gate) return false;
  if (gate.answeredAt) return true;
  return gate.status !== "pending";
}
