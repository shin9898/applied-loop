/**
 * ミニチェック用カード。
 * rubric の aspect/note は「評価者向け」なので、学習者向けの問い・模範に変換する。
 */

export type WeakAspectCard = {
  /** rubric 突合用キー */
  aspect: string;
  score: number;
  /** 評価者向けの欠落メモ（内部用。出題文には使わない） */
  note: string;
  /** 学習者に見せる問い */
  prompt: string;
  /** 答え合わせ: 「こう言えるとよい」（肯定形） */
  modelAnswer: string;
};

/** 減点メモ → 肯定の模範文。既存採点データ向けのヒューリスティック */
export function deficitNoteToModelAnswer(
  note: string,
  correctModel?: string | null,
): string {
  const n = note.trim();
  if (!n) {
    return pickFromCorrectModel(correctModel) ?? "この観点の核心を、自分の言葉で説明できる。";
  }

  // 「…がなく、【核心】という読み取りがない」→ 核心
  const core = n.match(/、([^。]+?)という[^。]*(?:がない|できていない)/);
  if (core?.[1]) {
    return `${core[1].trim().replace(/[。．]$/, "")}。`;
  }

  // 「【核心】ができていない／がない」
  const missing = n.match(/^(.+?)(?:への言及がなく|ができていない|がない|が抜けている)/);
  if (missing?.[1] && missing[1].length >= 8) {
    const fromModel = pickFromCorrectModel(correctModel, missing[1]);
    if (fromModel) return fromModel;
    return `${missing[1].trim()}、という点が核心。`;
  }

  const fromModel = pickFromCorrectModel(correctModel, n);
  if (fromModel) return fromModel;

  // 最後の手段: 否定表現を薄めて肯定寄りに
  return (
    n
      .replace(/への言及がなく[、。]?/g, "を踏まえ、")
      .replace(/という読み取りがない[。]?/g, "と読める。")
      .replace(/できていない[。]?/g, "と言える必要がある。")
      .replace(/が抜けている[。]?/g, "を含める。")
      .replace(/まったく触れられていません[。]?/g, "に触れる。") +
    (n.endsWith("。") ? "" : "。")
  );
}

function pickFromCorrectModel(
  correctModel?: string | null,
  hint?: string,
): string | null {
  const cm = correctModel?.trim();
  if (!cm) return null;
  const sentences = cm
    .split(/(?<=[。．])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  if (sentences.length === 0) return cm.slice(0, 180);
  if (!hint?.trim()) {
    return sentences.slice(0, 2).join("");
  }
  const keys = hint
    .toLowerCase()
    .split(/[\s、。．・\/（）()＝=]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
  let best = sentences[0]!;
  let bestScore = -1;
  for (const s of sentences) {
    const sl = s.toLowerCase();
    const score = keys.reduce((acc, k) => acc + (sl.includes(k) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  // 1文だけだと薄いので隣も足す
  const idx = sentences.indexOf(best);
  return sentences.slice(idx, idx + 2).join("");
}

/** 評価ラベル → 学習者向けの問い（aspect をそのまま出さない） */
export function deriveTeachPrompt(aspect: string, modelAnswer: string): string {
  let soft = aspect
    .replace(
      /(を)?(説明|読み取っ?|読み取り|述べ|押さえ?|示し?|触れ)(る)?(こと)?(が)?(できる|ている|している|られている)?$/u,
      "",
    )
    .replace(/(できる|ている|している)$/u, "")
    .trim();

  // 「どのrepoで落ちているか」型は、名前当てクイズに見えるのでテーマを一般化
  if (/どの|どれの|どこが/.test(soft) || /どの|どれの/.test(aspect)) {
    soft = "観測データから読み取れる全体パターンと、そこから言える原因";
  }

  const hint =
    modelAnswer.match(/（[=＝]?([^）]+)）/)?.[1]?.trim() ||
    modelAnswer.split(/[。．]/u)[0]?.trim() ||
    "";

  const lines = [
    "次の論点を、自分の言葉で1〜3文で説明せよ。",
    soft ? `テーマ: ${soft}` : null,
    "注意: 個別の名前を並べるだけでは足りない。データや仕組みから言える『パターン／原因』まで述べること。",
    hint && hint.length <= 48 ? `到達イメージ（キーワード）: ${hint}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildWeakAspectCards(input: {
  weakAspects: {
    aspect: string;
    score: number;
    note: string;
    teach?: string | null;
    model?: string | null;
  }[];
  correctModel?: string | null;
}): WeakAspectCard[] {
  return input.weakAspects.map((a) => {
    const modelAnswer =
      (a.model?.trim() ||
        deficitNoteToModelAnswer(a.note, input.correctModel)).trim();
    const prompt =
      (a.teach?.trim() || deriveTeachPrompt(a.aspect, modelAnswer)).trim();
    return {
      aspect: a.aspect,
      score: a.score,
      note: a.note,
      prompt,
      modelAnswer,
    };
  });
}
