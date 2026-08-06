import Link from "next/link";
import { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
import { AtlasReveal } from "./atlas-reveal";
import { AtlasShell } from "./atlas-shell";

/** DQ 向け図: 紙トーンの class ではなく固定色 */
function FigurePrefixReuse() {
  return (
    <svg
      viewBox="0 0 640 200"
      className="w-full max-w-2xl"
      role="img"
      aria-label="プロンプトキャッシュの基本"
    >
      <text x="8" y="22" fill="#f7f3d9" fontSize="13" fontWeight="700">
        2回目: 同じ先頭は再利用、末尾だけ新しく処理
      </text>
      {[
        { x: 8, label: "システム", hot: false },
        { x: 118, label: "ツール", hot: false },
        { x: 228, label: "履歴", hot: false },
        { x: 338, label: "次の質問", hot: true },
      ].map((b) => (
        <g key={b.label}>
          <rect
            x={b.x}
            y={48}
            width="100"
            height="44"
            rx="4"
            fill={b.hot ? "#f0d25a" : "#001a8c"}
            stroke="#f7f3d9"
            strokeWidth="2"
          />
          <text
            x={b.x + 50}
            y={74}
            textAnchor="middle"
            fontSize="12"
            fill={b.hot ? "#1a1000" : "#f7f3d9"}
            fontWeight="600"
          >
            {b.label}
          </text>
        </g>
      ))}
      <line x1="8" y1="120" x2="328" y2="120" stroke="#9ec0ff" strokeWidth="2" />
      <text x="168" y="140" textAnchor="middle" fontSize="11" fill="#c9c3a0">
        前回の計算を再利用
      </text>
      <line x1="338" y1="120" x2="438" y2="120" stroke="#e84848" strokeWidth="2" />
      <text x="388" y="140" textAnchor="middle" fontSize="11" fill="#c9c3a0">
        新しく処理
      </text>
      <text x="8" y="175" fontSize="11" fill="#9a9470">
        ※ 人間的な記憶ではなく、同じ並びの計算結果の再利用
      </text>
    </svg>
  );
}

function FigureMidChange() {
  return (
    <svg
      viewBox="0 0 640 210"
      className="w-full max-w-2xl"
      role="img"
      aria-label="途中変更で後ろも再計算"
    >
      <text x="8" y="22" fill="#f7f3d9" fontSize="13" fontWeight="700">
        途中が1か所変わると、その後ろも再計算されやすい
      </text>
      {["A", "B", "C", "D", "E"].map((label, i) => (
        <g key={`prev-${label}`}>
          <rect
            x={8 + i * 70}
            y={40}
            width="60"
            height="36"
            rx="4"
            fill="#001a8c"
            stroke="#f7f3d9"
            strokeWidth="2"
          />
          <text
            x={38 + i * 70}
            y={62}
            textAnchor="middle"
            fontSize="13"
            fill="#f7f3d9"
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      ))}
      <text x="370" y="62" fontSize="12" fill="#9a9470">
        前回
      </text>
      {["A", "B", "X", "D", "E"].map((label, i) => (
        <g key={`cur-${label}-${i}`}>
          <rect
            x={8 + i * 70}
            y={100}
            width="60"
            height="36"
            rx="4"
            fill={label === "X" ? "#f0d25a" : "#001a8c"}
            stroke="#f7f3d9"
            strokeWidth="2"
          />
          <text
            x={38 + i * 70}
            y={122}
            textAnchor="middle"
            fontSize="13"
            fill={label === "X" ? "#1a1000" : "#f7f3d9"}
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      ))}
      <text x="370" y="122" fontSize="12" fill="#9a9470">
        今回
      </text>
      <text x="8" y="170" fontSize="11" fill="#c9c3a0">
        A–B まで再利用可 / X 以降は再計算（意味が近くても並びが違えば別入力）
      </text>
    </svg>
  );
}

function FigureToolInsert() {
  return (
    <svg
      viewBox="0 0 640 200"
      className="w-full max-w-2xl"
      role="img"
      aria-label="ツール追加の影響"
    >
      <text x="8" y="22" fill="#f7f3d9" fontSize="13" fontWeight="700">
        ツール定義を前に足すと、後ろの長い履歴まで巻き込まれやすい
      </text>
      {["System", "read", "write", "bash", "履歴…"].map((label, i) => (
        <g key={`t1-${label}`}>
          <rect
            x={8 + i * 90}
            y={44}
            width="82"
            height="34"
            rx="4"
            fill="#001a8c"
            stroke="#f7f3d9"
            strokeWidth="2"
          />
          <text
            x={49 + i * 90}
            y={65}
            textAnchor="middle"
            fontSize="11"
            fill="#f7f3d9"
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      ))}
      {["System", "read", "write", "bash", "deploy", "履歴…"].map((label, i) => (
        <g key={`t2-${label}`}>
          <rect
            x={8 + i * 90}
            y={110}
            width="82"
            height="34"
            rx="4"
            fill={label === "deploy" ? "#f0d25a" : "#001a8c"}
            stroke="#f7f3d9"
            strokeWidth="2"
          />
          <text
            x={49 + i * 90}
            y={131}
            textAnchor="middle"
            fontSize="11"
            fill={label === "deploy" ? "#1a1000" : "#f7f3d9"}
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      ))}
      <text x="8" y="175" fontSize="11" fill="#c9c3a0">
        前方の定義が変わると、後ろの長い文脈も再処理の対象になりやすい
      </text>
    </svg>
  );
}

export function AtlasConceptPromptCache({
  seededCreated,
  streakDays,
}: {
  seededCreated: number;
  streakDays?: number;
}) {
  return (
    <AtlasChrome active="/harness" streakDays={streakDays}>
      <AtlasShell>
        <AtlasReveal as="section" className="dq-win p-3.5">
          <div className="mb-3">
            <Link
              href="/harness"
              className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a] no-underline"
            >
              ← どうぐにもどる
            </Link>
          </div>
          <AtlasPageTitle
            title="げんり"
            sub="ハーネス正典モジュール · プロンプトキャッシュ"
          />
          <h2 className="m-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]">
            プロンプトキャッシュの原理
          </h2>
          <p className="mt-2 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
            目的は挙動の理解であり、キャッシュ率の最大化ではない。概念はどのプロジェクトでも共通。直し方と効果確認はリポジトリごとに見る（ADR-0016）。
          </p>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={1} className="dq-win p-3.5">
          <h2 className="dq-win-title">しゅっぱつてん</h2>
          <p className="m-0 text-[14px] leading-relaxed text-[#c9c3a0]">
            「続けて」と送っただけでも、システム・ツール定義・ルール・会話履歴・コマンド結果までまとめてモデルに送ることがある。短い指示だから安い、とは限らない。
          </p>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={2} className="dq-win p-3.5">
          <h2 className="dq-win-title">さいりようの基本</h2>
          <FigurePrefixReuse />
          <p className="mt-3 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
            前回と同じ先頭部分があるなら、そこはゼロから計算し直さず、増えた末尾だけ処理する。AI が会話を覚えている話ではなく、同じ入力並びの計算結果の再利用じゃ。
          </p>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={3} className="dq-win p-3.5">
          <h2 className="dq-win-title">「いみ」ではなく「おなじ並び」</h2>
          <FigureMidChange />
          <p className="mt-3 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
            変わらない情報は前に、変わる情報は後ろに置くのが基本。途中をいじると、その後ろも別入力扱いになりやすい。
          </p>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={4} className="dq-win p-3.5">
          <h2 className="dq-win-title">ツールていぎの位置</h2>
          <FigureToolInsert />
          <p className="mt-3 mb-0 text-[13px] leading-relaxed text-[#c9c3a0]">
            エージェントのツール定義は履歴より前に置かれることが多い。1つ足しただけでも、後ろの長い履歴まで再処理の対象になり得る。
          </p>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={5} className="dq-win p-3.5">
          <h2 className="dq-win-title">TTL と履歴さくじょ</h2>
          <ul className="m-0 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-[#c9c3a0]">
            <li>
              入力が同じでも、待ち時間が長いと再利用できなくなることがある（失効時間はプロバイダ・プランで変わるため、数値は正典にしない）。
            </li>
            <li>
              古い履歴を削るとトークンは減っても、並びが変わって再計算コストが増えたり、判断の根拠を失ったりする。
            </li>
            <li>
              見るべきなのは「どれだけ短くなったか」だけでなく、「どこから再計算か」「必要な文脈まで失っていないか」。
            </li>
          </ul>
        </AtlasReveal>

        <AtlasReveal as="section" delayIndex={6} className="dq-win p-3.5">
          <h2 className="dq-win-title">つぎのいっぽ</h2>
          <p className="m-0 text-[13px] leading-relaxed text-[#c9c3a0]">
            観測で repo 別の再利用率を確認し、理解チェック（module）で自分の言葉で説明する。ハーネスを直したら、適用記録の対象にリポジトリ名を入れて再観測するのじゃ。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/harness" className="dq-btn !px-3 !py-2 text-[8px]">
              かんそくをみる
            </Link>
            <Link href="/gates" className="dq-btn !px-3 !py-2 text-[8px]">
              しれんへ
              {seededCreated > 0 ? ` (新規 ${seededCreated})` : ""}
            </Link>
          </div>
          <p className="mt-3 mb-0 text-[11px] text-[#9a9470]">
            一次情報:{" "}
            <a
              className="text-[#9ec0ff] underline"
              href="https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching"
              target="_blank"
              rel="noreferrer"
            >
              Anthropic Prompt caching
            </a>
          </p>
        </AtlasReveal>
      </AtlasShell>
    </AtlasChrome>
  );
}
