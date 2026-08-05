/**
 * 不合格後のミニチェック: 弱い観点を1つずつ、自分の言葉で言い直せるかを見る。
 * 判定は減点メモではなく、肯定の modelAnswer / correct_model に照らす。
 */
import { runHeadlessLLM, parseLLMJson, HeadlessLLMError } from "@/lib/headless-llm";

export type MicroCheckResult = {
  ok: boolean;
  feedback: string;
  /** LLM 不通時。UI は答え合わせ＋差分メモで次へ進めてよい */
  allowSelfAdvance: boolean;
};

type LlmVerdict = { ok?: boolean; feedback?: string };

export async function evaluateMicroParaphrase(input: {
  /** 学習者に出した問い */
  prompt: string;
  /** こう言えるとよい（肯定） */
  modelAnswer: string;
  correctModel?: string | null;
  paraphrase: string;
}): Promise<MicroCheckResult> {
  const paraphrase = input.paraphrase.trim();
  if (paraphrase.length < 12) {
    return {
      ok: false,
      feedback: "もう少しだけ、自分の言葉で書いてくれ（短すぎる）。",
      allowSelfAdvance: false,
    };
  }

  const prompt = [
    "学習者がミニチェックの問いに、自分の言葉で答えた。核心を押さえているか判定せよ。",
    "丸暗記・用語の完全一致は不要。model_answer の本質が1つでも言えていれば ok:true。",
    "個別の名前リストだけでパターン／原因に触れていなければ ok:false。",
    "厳しすぎないこと。feedback は学習者向け日本語1-2文。",
    'JSONのみ: {"ok":true|false,"feedback":"..."}',
    "",
    `<question_to_learner>\n${input.prompt}\n</question_to_learner>`,
    `<model_answer>\n${input.modelAnswer}\n</model_answer>`,
    input.correctModel?.trim()
      ? `<correct_model>\n${input.correctModel.trim().slice(0, 700)}\n</correct_model>`
      : "",
    `<learner_answer>\n${paraphrase}\n</learner_answer>`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const parsed = parseLLMJson<LlmVerdict>(await runHeadlessLLM(prompt));
    if (!parsed || typeof parsed.ok !== "boolean") {
      return {
        ok: false,
        feedback:
          "判定を読めなかった。下の『こう言えるとよい』を見て、足りなかった点を1行書いてから次へ。",
        allowSelfAdvance: true,
      };
    }
    return {
      ok: parsed.ok,
      feedback:
        (typeof parsed.feedback === "string" && parsed.feedback.trim()) ||
        (parsed.ok
          ? "よし、この論点は自分の言葉で言えたぞ。"
          : "まだ核心が薄い。『こう言えるとよい』を見て言い直してみよ。"),
      allowSelfAdvance: !parsed.ok,
    };
  } catch (e) {
    const msg =
      e instanceof HeadlessLLMError
        ? e.message.slice(0, 120)
        : "判定呼び出しに失敗した";
    return {
      ok: false,
      feedback: `${msg}。答え合わせを見て、足りなかった点を1行書いて次へ進めるぞ。`,
      allowSelfAdvance: true,
    };
  }
}
