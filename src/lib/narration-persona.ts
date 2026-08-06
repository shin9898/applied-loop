/**
 * 週次ダイジェストのナビ姫（Living Atlas オリジナル）。
 * ADR-0014 当初の VOICEVOX「さやか」から差し替え。
 */
export const NARRATION_PERSONA = {
  id: "lumina",
  /** 原稿・UI の話者名 */
  name: "ルミナ",
  /** セリフ行プレフィックス（半角コロン） */
  linePrefix: "ルミナ: ",
  /** 旧原稿互換 */
  legacyNames: ["さやか"] as const,
  /** 会話ポートレート（public 配下）。納得いかなければ外してプレースホルダへ */
  portraitSrc: "/atlas/lumina-portrait.png",
  /** 生成プロンプト用の短い性格・口調 */
  promptTrait:
    "ぼうけんのしょのナビ姫。清廉無垢で純粋な、優しいお姫様。口調は丁寧語（です・ます）を基調に、甘くやわらかく寄り添う。小さな発見もほめて、安心させる言い回しを多めに（「だいじょうぶ」「いっしょに」「そっと」「うれしいです」など）。押しつけやお説教はしない。避け方: 「〜ですわ」系の嫌味なお嬢様口調、馴れ馴れしいタメ口（「〜だよ」「〜じゃん」）、ビジネス口調、古風な「〜のじゃ」（天の声の役）。語尾の目安: 「〜ですね」「〜ですよ」「〜ましょうね」「〜してあげてくださいね」。",
} as const;

/** 話者プレフィックスを取り除いた本文と表示名を返す */
export function parseNarrationLine(raw: string): {
  speaker: string | null;
  text: string;
} {
  const m = raw.match(/^([^\s:：]{1,20})\s*[:：]\s*(.+)$/);
  if (!m) return { speaker: null, text: raw };
  const name = m[1]!;
  const text = m[2]!.trim();
  if (
    name === NARRATION_PERSONA.name ||
    (NARRATION_PERSONA.legacyNames as readonly string[]).includes(name)
  ) {
    return { speaker: NARRATION_PERSONA.name, text };
  }
  return { speaker: name, text };
}

/** MD からセリフ段落だけを取り出す（見出し・引用は捨てる） */
export function extractNarrationLines(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#") || t.startsWith(">")) continue;
    if (t.startsWith("```")) continue;
    const { speaker, text } = parseNarrationLine(t);
    if (speaker) out.push(text);
    else if (!t.startsWith("-") && !t.startsWith("*")) out.push(t);
  }
  return out;
}
