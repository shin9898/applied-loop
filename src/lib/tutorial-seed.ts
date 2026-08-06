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
      concept: "プロンプトキャッシュは「同じ文が続くと安い」だけだと思っている",
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
        "「生成AIで機能は実装できたが、仕組みを説明できない」状態を、自分の言葉で説明してください。どんな場面で困り、何が足りないと感じていますか。",
      contextSummary:
        "チュートリアル用のサンプルしれん。コミット由来ではない中立な出題。",
      rubricCriteria: JSON.stringify([
        "具体的な場面（レビュー・障害・別タスク再発など）に触れている",
        "「動く／出荷できる」と「説明できる／再現できる」の差を言い換えている",
        "一般論だけで終わらず、自分の体験か観察が入っている",
      ]),
      resources: JSON.stringify([
        {
          kind: "note",
          label: "ヒント: 金曜にマージして月曜に詰まる場面を思い出す",
          ref: "tutorial",
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
