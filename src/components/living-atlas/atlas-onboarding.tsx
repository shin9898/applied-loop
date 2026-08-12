"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { SetupCheck, SetupDiagnosis } from "@/lib/setup-diagnosis";
import {
  TUTORIAL_LLM_LABELS,
  TUTORIAL_TERMS,
  tutorialPastePrompt,
  type TutorialLlmTrack,
} from "@/lib/tutorial-constants";
import type { TutorialProgress, TutorialStepId } from "@/lib/tutorial-progress";
import {
  completeTutorialAction,
  ensureTutorialSeedAction,
  markTutorialLlmStepDoneAction,
  setTutorialLlmTrackAction,
  skipTutorialHookAction,
} from "@/lib/actions";
import { AtlasCloudMcpWizardSection } from "./atlas-cloud-mcp-wizard";
import { AtlasSurfaceIcon } from "./atlas-surface-icons";
import { AtlasVoicePlain } from "./atlas-voice-plain";
import { AtlasWatchedReposPanel } from "./atlas-watched-repos";

const INTRO_KEY = "atlas-world-intro-seen";

/** 完了画面 B: 会話供給（B4-4b） */
const REQUEST_GATE_PASTE = [
  "Applied Loop の MCP で request_gate を呼んでください。",
  "引数 diff には、いまの変更差分（git diff の内容）を渡してください。",
  "repo と summary は分かれば任意で。",
  "生成されたしれんを見せて、提出は私が明示したあと answer_gate で送ってください。",
].join("\n");

/** ホーム用: 必須欠け or チュートリアル未完のとき */
export function AtlasSetupBanner({ diagnosis }: { diagnosis: SetupDiagnosis }) {
  if (diagnosis.essentialsReady && diagnosis.tutorialReady) return null;
  const next = diagnosis.checks.find((c) => c.id === diagnosis.nextCheckId);
  let label = "はじめのチュートリアルがまだ途中じゃ";
  if (!diagnosis.essentialsReady) {
    label = `支度が足りぬ。まず ${next?.label ?? "じゅんび"} じゃ`;
  } else if (!diagnosis.tutorialSampleSubmitted) {
    label = "まずサンプルしれんを1問提出せよ";
  } else if (next?.id === "mcp_touch" || next?.id === "tutorial_done") {
    label = "つぎは LLM を選んで、貼る文を1回呼ぶのじゃ";
  }
  return (
    <div className="border-4 border-[#f0d25a] bg-[#001a8c] px-3 py-2.5 outline outline-4 outline-[#000c4a] shadow-[4px_4px_0_#000]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 min-w-0 text-[13px] leading-snug text-[#f7f3d9]">
          <span className="font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
            天の声
          </span>
          <span className="mx-2 text-[#9ec0ff]">·</span>
          {label}
        </p>
        <Link
          href="/setup"
          className="shrink-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a] no-underline hover:underline"
        >
          じゅんびへ →
        </Link>
      </div>
      {next?.plain ? (
        <p className="mt-1.5 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          つまり {next.plain}
        </p>
      ) : null}
    </div>
  );
}

/** 初回のみ: 1枚＋じゅんびへ */
export function AtlasWorldIntroModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(INTRO_KEY) === "1") return;
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#000814cc] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atlas-intro-title"
    >
      <div className="dq-win w-full max-w-md p-4 shadow-[8px_8px_0_#000]">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
          ◆ 天の声
        </p>
        <h2
          id="atlas-intro-title"
          className="mt-2 mb-0 text-[18px] font-normal leading-relaxed text-[#f7f3d9]"
        >
          ぼうけんのしょへようこそ
        </h2>
        <AtlasVoicePlain
          className="mt-3"
          voice="ここは理解の地図じゃ。まずはじゅんびで、サンプルのしれんを1問提出せよ。賢者（LLM）との道は、そのあとでよい。"
          plain="最初は Web で1問解く。そのあと自分の LLM に MCP をつなぐ（貼る文1回）。"
        />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="font-[family-name:var(--font-pixel)] text-[8px] text-[#c9c3a0]"
            onClick={finish}
          >
            とばす
          </button>
          <Link
            href="/setup"
            className="dq-btn !px-3 !py-2 text-[8px]"
            onClick={finish}
          >
            じゅんびへ進む
          </Link>
        </div>
      </div>
    </div>
  );
}

function CopyButton({
  text,
  label = "この文をコピー",
  ghost = false,
}: {
  text: string;
  label?: string;
  ghost?: boolean;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`dq-btn atlas-eq-btn${ghost ? " dq-btn-ghost" : ""}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          window.setTimeout(() => setOk(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? "コピーした" : label}
    </button>
  );
}

function suggestedToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `al_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `al_${Date.now().toString(36)}_change_me`;
}

/* =========================================================================
   そうびのま — 5つの装備スロットが、そのままチュートリアルの5ステップ。
   スロットの見た目は `progress.steps[].done` / `currentStepId` から導く。
   ステップの中身（.env スニペット・サンプルしれん・LLM 選択・貼る文・監視 repo）は
   スロットを押すと中央の「いまやる1手」窓に開く。
   ========================================================================= */

type SlotStepId = Exclude<TutorialStepId, "done">;

type SlotDef = {
  step: SlotStepId;
  /** ドット絵スプライト名 */
  sprite: "key" | "sword" | "star" | "chain" | "lamp";
  name: string;
  /** そうびひょう（台帳）に出す実機能 */
  what: string;
  required: boolean;
};

const SLOTS: SlotDef[] = [
  {
    step: "token",
    sprite: "key",
    name: "とびらの かぎ",
    what: "合言葉（MCP_TOKEN）を .env に設定",
    required: true,
  },
  {
    step: "sample_gate",
    sprite: "sword",
    name: "はじまりの つるぎ",
    what: "サンプルしれんを1問提出",
    required: true,
  },
  {
    step: "llm_pick",
    sprite: "star",
    name: "けんじゃの しるし",
    what: "自分の LLM（Claude / Codex / Cursor / じゅもん）を選ぶ",
    required: true,
  },
  {
    step: "llm_call",
    sprite: "chain",
    name: "つなぎの くさり",
    what: "選んだ LLM に MCP をつなぐ（貼る文1回）",
    required: true,
  },
  {
    step: "hook",
    sprite: "lamp",
    name: "みはりの ランタン",
    what: "監視リポジトリに git hook をかける",
    required: false,
  },
];

const REQUIRED_COUNT = SLOTS.filter((s) => s.required).length;

const MRING_DOTS = [
  "a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3",
] as const;

const VOICE: Record<TutorialStepId, { line: ReactNode; plain: string }> = {
  token: {
    line: (
      <>
        まずは とびらの <span className="atlas-eq-hi">かぎ</span> じゃ。合言葉を
        しるすのじゃ。
      </>
    ),
    plain: ".env に MCP_TOKEN を書いて再起動する。",
  },
  sample_gate: {
    line: (
      <>
        かぎは 手にした。つぎは <span className="atlas-eq-hi">つるぎ</span>
        ——ためしに ひとふり してみよ。
      </>
    ),
    plain: "サンプルしれんを1問だけ提出する。合否は待たなくてよい。",
  },
  llm_pick: {
    line: (
      <>
        かぎと つるぎは 手にした。つぎは 共に往く{" "}
        <span className="atlas-eq-hi">かしこきもの</span> を えらぶのじゃ。
      </>
    ),
    plain:
      "使っている LLM（Claude / Codex / Cursor など）を1つ選ぶ。設定はこの次。",
  },
  llm_call: {
    line: (
      <>
        えらんだか。ならば <span className="atlas-eq-hi">きずな</span> を むすべ。
        文を ひとつ となえるだけじゃ。
      </>
    ),
    plain: "貼る文を1回 LLM に渡して MCP をつなぐ。",
  },
  hook: {
    line: (
      <>
        かなめは ととのった。あとは{" "}
        <span className="atlas-eq-hi">みはりの ランタン</span> ——ともすも 消すも
        汝しだい。
      </>
    ),
    plain: "監視リポジトリへの git hook は任意。今は飛ばしてもよい。",
  },
  done: {
    line: (
      <>
        ゆけ。とびらは ひらいた。
        <span className="atlas-eq-hi">みちは ふたつ</span> あるが、どちらか
        一方でよい。
      </>
    ),
    plain:
      "供給は「監視リポジトリ + hook」か「会話で request_gate」のどちらか。",
  },
};

/** 装備スロットのドット絵（ランタンだけ2コマの炎を重ねる） */
function SlotSprite({ sprite }: { sprite: SlotDef["sprite"] }) {
  return (
    <span className={`atlas-eq-spr atlas-eq-spr--${sprite}`}>
      {sprite === "lamp" ? (
        <span className="atlas-eq-flame atlas-eq-lampflame">
          <span className="atlas-eq-spr atlas-eq-spr--lampf1" />
          <span className="atlas-eq-spr atlas-eq-spr--lampf2" />
        </span>
      ) : null}
    </span>
  );
}

function Torch({ side }: { side: "l" | "r" }) {
  return (
    <div className={`atlas-eq-torch atlas-eq-torch--${side}`} aria-hidden="true">
      <span className="atlas-eq-flame">
        <span className="atlas-eq-spr atlas-eq-spr--torch1" />
        <span className="atlas-eq-spr atlas-eq-spr--torch2" />
      </span>
    </div>
  );
}

/** たびだちのとびら。`open` 0..1 が そのまま扉の開き＝かなめのそうび数／4 */
function DepartureGate({
  open,
  caption,
}: {
  open: number;
  caption?: string;
}) {
  return (
    <div
      className="atlas-eq-gate"
      style={{ "--eq-open": open } as CSSProperties}
    >
      <div className="atlas-eq-gate__sky" aria-hidden="true" />
      <div className="atlas-eq-gate__glow" aria-hidden="true" />
      <span
        className="atlas-eq-spr atlas-eq-spr--sun atlas-eq-gate__sun"
        aria-hidden="true"
      />
      <div className="atlas-eq-gate__field" aria-hidden="true" />
      <div className="atlas-eq-gate__road" aria-hidden="true" />
      <div className="atlas-eq-gate__door atlas-eq-gate__door--l" aria-hidden="true" />
      <div className="atlas-eq-gate__door atlas-eq-gate__door--r" aria-hidden="true" />
      <div className="atlas-eq-gate__pillar atlas-eq-gate__pillar--l" aria-hidden="true" />
      <div className="atlas-eq-gate__pillar atlas-eq-gate__pillar--r" aria-hidden="true" />
      <div className="atlas-eq-gate__step atlas-eq-gate__step--l" aria-hidden="true" />
      <div className="atlas-eq-gate__step atlas-eq-gate__step--r" aria-hidden="true" />
      <div className="atlas-eq-gate__lintel" aria-hidden="true" />
      <Torch side="l" />
      <Torch side="r" />
      {caption ? <p className="atlas-eq-gate__caption">{caption}</p> : null}
    </div>
  );
}

/** /setup: そうびのま（進行つきチュートリアル） */
export function AtlasSetupPanel({
  diagnosis,
  progress,
  fromSampleGate = false,
}: {
  diagnosis: SetupDiagnosis;
  progress: TutorialProgress;
  fromSampleGate?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tokenHint] = useState(() => suggestedToken());
  const current = progress.currentStepId;
  /**
   * スロット／台帳から明示的に開いたステップ（null = いまやる1手）。
   * どの進行状態で開いたか (`at`) を一緒に持ち、進行が動いたら自動で畳む
   * ——effect で reset すると余計な再描画が挟まるので、描画時に導出する。
   */
  const [inspect, setInspect] = useState<{
    step: SlotStepId | null;
    at: TutorialStepId;
  }>({ step: null, at: current });
  const openSlot = inspect.at === current ? inspect.step : null;
  const setOpenSlot = (step: SlotStepId | null) =>
    setInspect({ step, at: current });

  const run = (fn: () => Promise<unknown>) => {
    startTransition(() => {
      void fn().then(() => router.refresh());
    });
  };

  useEffect(() => {
    run(() => ensureTutorialSeedAction());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount 時に一度だけ seed
  }, []);

  const doneMap = useMemo(() => {
    const m: Partial<Record<TutorialStepId, boolean>> = {};
    for (const s of progress.steps) m[s.id] = s.done;
    return m;
  }, [progress.steps]);

  const equippedAll = SLOTS.filter((s) => doneMap[s.step]).length;
  const equippedRequired = SLOTS.filter(
    (s) => s.required && doneMap[s.step],
  ).length;
  const remaining = REQUIRED_COUNT - equippedRequired;
  const gateOpen = equippedRequired / REQUIRED_COUNT;
  const departed = current === "done";

  /* そうびした瞬間の「そうび！」— 前回描画との差分でだけ光らせる。
     effect で比較すると1フレーム遅れて演出が飛ぶので、描画時に差分を取る。 */
  const equipSignature = SLOTS.map((s) => (doneMap[s.step] ? "1" : "0")).join("");
  const [seenSignature, setSeenSignature] = useState(equipSignature);
  const [justEquipped, setJustEquipped] = useState<SlotStepId[]>([]);
  if (seenSignature !== equipSignature) {
    setSeenSignature(equipSignature);
    setJustEquipped(
      SLOTS.filter(
        (s, i) => seenSignature[i] === "0" && equipSignature[i] === "1",
      ).map((s) => s.step),
    );
  }
  useEffect(() => {
    if (justEquipped.length === 0) return;
    const t = window.setTimeout(() => setJustEquipped([]), 1000);
    return () => window.clearTimeout(t);
  }, [justEquipped]);

  const localMcpUrl = diagnosis.mcpEndpoint.localMcpUrl;
  const paste = useMemo(
    () =>
      progress.llmTrack
        ? tutorialPastePrompt(progress.llmTrack, localMcpUrl)
        : null,
    [progress.llmTrack, localMcpUrl],
  );

  /** 中央の窓に開くステップ。たびだち後は明示的に押されたときだけ開く */
  const questStep: SlotStepId | null =
    openSlot ?? (departed ? null : (current as SlotStepId));
  const voice = VOICE[openSlot ?? current];

  const gateCaption =
    remaining > 0
      ? `かなめの そうび あと ${remaining}つ で とびらが ひらく`
      : "とびらは ひらいた —— たびだつがよい";

  return (
    <div className="atlas-eq-stack">
      {/* 見出し（そうびのま） */}
      <div className="atlas-eq-head">
        <AtlasSurfaceIcon
          surface="setup"
          size={52}
          className="atlas-eq-head__chest"
        />
        <div className="min-w-0">
          <h1 className="atlas-eq-head__title">そうびのま</h1>
          <p className="atlas-eq-head__sub">じゅんび — たびだちのしたく</p>
        </div>
      </div>

      {fromSampleGate ? (
        <p className="m-0 border-l-[3px] border-[#3ecf5a] bg-[#001a8c] px-3 py-2 text-[13px] text-[#f7f3d9]">
          サンプルしれん、提出できたぞ。つぎの手へ進むのじゃ。
          <span className="mt-1 block text-[11px] text-[#9ec0ff]">
            つまり 合否は待たなくてよい。下の『いまやる1手』へ。
          </span>
        </p>
      ) : null}

      {departed ? (
        <DepartScene lampOn={Boolean(doneMap.hook)} />
      ) : (
        <div className="atlas-eq-room">
          {/* 左: そうびのリング */}
          <div className="dq-win atlas-eq-floor">
            <p className="atlas-eq-wintitle">
              <span className="atlas-eq-mk" aria-hidden="true" />
              みにつけたもの
            </p>

            <div className="atlas-eq-motes" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </div>

            <div
              className="atlas-eq-ring"
              style={{ "--eq-lit": equippedAll } as CSSProperties}
            >
              <div className="atlas-eq-mglow" aria-hidden="true" />
              <div className="atlas-eq-mring" aria-hidden="true">
                {MRING_DOTS.map((d) => (
                  <i key={d} className={`atlas-eq-mring--${d}`} />
                ))}
              </div>

              <div className="atlas-eq-herobox">
                <span
                  className="atlas-eq-spr atlas-eq-spr--hero atlas-eq-hero"
                  aria-hidden="true"
                />
                <span className="atlas-eq-heroshadow" aria-hidden="true" />
                <span className="atlas-eq-herobox__name">あなた</span>
                <span className="atlas-eq-herobox__rank">
                  そうび {equippedAll}／{SLOTS.length}
                </span>
              </div>

              <div className="atlas-eq-slotgrid">
                {SLOTS.map((slot, i) => {
                  const equipped = Boolean(doneMap[slot.step]);
                  const active = slot.step === current;
                  const opened = openSlot === slot.step;
                  const just = justEquipped.includes(slot.step);
                  return (
                    <button
                      key={slot.step}
                      type="button"
                      data-equipped={equipped ? "1" : "0"}
                      aria-pressed={opened}
                      className={[
                        "atlas-eq-slot",
                        `atlas-eq-slot--${i + 1}`,
                        active ? "is-active" : "",
                        opened ? "is-open" : "",
                        just ? "is-just" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setOpenSlot(slot.step)}
                    >
                      <span className="atlas-eq-slot__flash" aria-hidden="true">
                        そうび！
                      </span>
                      <span className="atlas-eq-slot__icon" aria-hidden="true">
                        <SlotSprite sprite={slot.sprite} />
                      </span>
                      <span className="atlas-eq-slot__name">{slot.name}</span>
                      <span className="atlas-eq-slot__state">
                        {equipped
                          ? "そうび済み"
                          : active
                            ? "いまここ"
                            : "みそうび"}
                      </span>
                      {!slot.required ? (
                        <span className="atlas-eq-slot__opt">— 任意 —</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 右: たびだちのとびら（進捗バーの代わりに扉が開く） */}
          <div className="atlas-eq-gatecol">
            <div className="dq-win atlas-eq-gatewin">
              <p className="atlas-eq-wintitle">
                <span className="atlas-eq-mk" aria-hidden="true" />
                たびだちの とびら
              </p>
              <DepartureGate open={gateOpen} caption={gateCaption} />
            </div>

            <div className="dq-win atlas-eq-win" style={{ padding: 14 }}>
              <div className="atlas-eq-gauge">
                <span className="atlas-eq-gauge__label">たびだち度</span>
                <span className="atlas-eq-gauge__bar">
                  {SLOTS.map((s) => (
                    <span
                      key={s.step}
                      className={[
                        "atlas-eq-seg",
                        doneMap[s.step] ? "is-on" : "",
                        s.required ? "" : "is-opt",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  ))}
                </span>
                <span className="atlas-eq-gauge__num">
                  {equippedAll}/{SLOTS.length}
                </span>
              </div>
              <p className="atlas-eq-note" style={{ marginTop: 10 }}>
                金の4つが <span className="atlas-eq-hi">かなめ</span>
                、緑の1つは <span style={{ color: "#3ecf5a" }}>任意（ランタン）</span>
                。かなめが揃えば とびらは開く。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 天の声 */}
      <div className="dq-win atlas-eq-win">
        <p className="atlas-eq-voice__who">
          <span className="atlas-eq-mk" aria-hidden="true" />
          天の声
        </p>
        <p className="atlas-eq-voice__line">
          {voice.line}
          <span className="atlas-eq-voice__cursor" aria-hidden="true" />
        </p>
        <p
          className="atlas-eq-note atlas-eq-note--plain"
          style={{ marginTop: 10 }}
        >
          つまり {voice.plain}
        </p>
      </div>

      {/* いまやる1手（＝そうびの中身） */}
      {questStep ? (
        <div className="dq-win atlas-eq-win atlas-eq-win--gold">
          <div className="atlas-eq-quests__head">
            <span className="atlas-eq-quests__eyebrow">
              <span className="atlas-eq-mk" aria-hidden="true" />
              {questStep === current ? "いまやる1手" : "そうびを しらべる"}
            </span>
            <span className="atlas-eq-quests__count">
              {remaining > 0
                ? `のこり かなめ ${remaining}つ`
                : `かなめ ${REQUIRED_COUNT}/${REQUIRED_COUNT} ととのった`}
            </span>
          </div>

          {questStep !== current ? (
            <p
              className="atlas-eq-note atlas-eq-note--plain"
              style={{ marginBottom: 12 }}
            >
              いまの番は{" "}
              <span className="atlas-eq-hi">
                {SLOTS.find((s) => s.step === current)?.name ??
                  "たびだちの とびら"}
              </span>
              。ここは あとから 見直す用じゃ。
              <button
                type="button"
                className="ml-2 font-[family-name:var(--font-pixel)] text-[11px] text-[#f0d25a] underline"
                onClick={() => setOpenSlot(null)}
              >
                いまやる1手へ もどる
              </button>
            </p>
          ) : null}

          {questStep === "token" ? <StepToken tokenHint={tokenHint} /> : null}

          {questStep === "sample_gate" ? (
            <div>
              <p className="atlas-eq-quest__title">
                <span
                  className="atlas-eq-spr atlas-eq-spr--arrow"
                  aria-hidden="true"
                />
                「はじまりの つるぎ」を とる
              </p>
              <p className="atlas-eq-quest__sub">
                サンプルしれん（理解度チェック）を1問提出する
              </p>
              <div className="atlas-eq-quest__body">
                <p className="atlas-eq-note">
                  MCP はまだ不要。『たたかう』で自分の言葉を書き、『提出する』。
                </p>
                <p className="atlas-eq-note atlas-eq-note--plain">
                  合否はすぐ出ない（採点は別プロセス）—— それで正しい。
                </p>
              </div>
              <div className="atlas-eq-quest__actions">
                <Link
                  href={`/gates/${progress.tutorialGateId}`}
                  className="dq-btn atlas-eq-btn"
                >
                  たたかう（サンプルへ）
                </Link>
              </div>
            </div>
          ) : null}

          {questStep === "llm_pick" ? (
            <div>
              <p className="atlas-eq-quest__title">
                <span
                  className="atlas-eq-spr atlas-eq-spr--arrow"
                  aria-hidden="true"
                />
                「けんじゃの しるし」を えらぶ
              </p>
              <p className="atlas-eq-quest__sub">
                自分の LLM を選ぶ（つなぐ道）
              </p>
              <div className="atlas-eq-quest__body">
                <p className="atlas-eq-note">
                  ここが「自分の LLM と Applied Loop をつなぐ」ステップの入口。
                  迷ったら『じゅもん』（アプリ内・ENABLE_TERMINAL=true）。
                </p>
                {progress.llmTrack ? (
                  <p className="atlas-eq-note atlas-eq-note--plain">
                    いま選ばれているのは{" "}
                    <span className="atlas-eq-hi">
                      {TUTORIAL_LLM_LABELS[progress.llmTrack]}
                    </span>
                    。押し直せば えらび直せる。
                  </p>
                ) : null}
              </div>
              <div className="atlas-eq-quest__actions">
                {(Object.keys(TUTORIAL_LLM_LABELS) as TutorialLlmTrack[]).map(
                  (track) => (
                    <button
                      key={track}
                      type="button"
                      disabled={pending}
                      className="dq-btn dq-btn-ghost atlas-eq-btn"
                      onClick={() => run(() => setTutorialLlmTrackAction(track))}
                    >
                      {TUTORIAL_LLM_LABELS[track]}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : null}

          {questStep === "llm_call" ? (
            progress.llmTrack && paste ? (
              <div>
                <p className="atlas-eq-quest__title">
                  <span
                    className="atlas-eq-spr atlas-eq-spr--arrow"
                    aria-hidden="true"
                  />
                  「つなぎの くさり」を むすぶ
                </p>
                <p className="atlas-eq-quest__sub">
                  自分の LLM（{TUTORIAL_LLM_LABELS[progress.llmTrack]}）に MCP
                  をつなぐ（貼る文 1回）
                </p>
                <div className="atlas-eq-quest__body">
                  <p className="atlas-eq-note">
                    下の文を選んだ LLM に貼って1回呼ぶ。これで Applied Loop
                    とつながる（ツール名は覚えなくてよい）。 手元の生成AIは常に
                    localhost（
                    <code className="text-[#9ec0ff]">{localMcpUrl}</code>
                    ）。Cloud Agent は下の青いカード。
                    この道を選んだあとの疎通だけがカウントされる。
                    {progress.mcpRecent &&
                    progress.steps.find((s) => s.id === "llm_call")?.done
                      ? " —— 選択後の疎通を検知したぞ。"
                      : ""}
                  </p>
                  <LlmTrackHint track={progress.llmTrack} mcpUrl={localMcpUrl} />
                  <pre className="atlas-eq-code max-h-48 overflow-auto">
                    {paste}
                  </pre>
                </div>
                <div className="atlas-eq-quest__actions">
                  <CopyButton text={paste} />
                  {progress.llmTrack === "jumon" ? (
                    <Link href="/" className="dq-btn dq-btn-ghost atlas-eq-btn">
                      ちずでじゅもんを開く
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    className="dq-btn atlas-eq-btn"
                    onClick={() => run(() => markTutorialLlmStepDoneAction())}
                  >
                    できた（次へ）
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="atlas-eq-quest__title">
                  <span
                    className="atlas-eq-spr atlas-eq-spr--arrow"
                    aria-hidden="true"
                  />
                  「つなぎの くさり」を むすぶ
                </p>
                <p className="atlas-eq-quest__sub">
                  さきに「けんじゃの しるし」を えらぶのじゃ
                </p>
                <div className="atlas-eq-quest__body">
                  <p className="atlas-eq-note">
                    貼る文は 選んだ LLM ごとに変わる。まず LLM を1つ選べ。
                  </p>
                </div>
                <div className="atlas-eq-quest__actions">
                  <button
                    type="button"
                    className="dq-btn dq-btn-ghost atlas-eq-btn"
                    onClick={() => setOpenSlot("llm_pick")}
                  >
                    けんじゃの しるしへ
                  </button>
                </div>
              </div>
            )
          ) : null}

          {questStep === "hook" ? (
            <div id="git-hook" className="scroll-mt-24">
              <p className="atlas-eq-quest__title">
                <span
                  className="atlas-eq-spr atlas-eq-spr--arrow"
                  aria-hidden="true"
                />
                「みはりの ランタン」を ともす（任意）
              </p>
              <p className="atlas-eq-quest__sub">
                監視リポジトリを選んで鉤をかける
              </p>
              <div className="atlas-eq-quest__body">
                <p className="atlas-eq-note">
                  選んだ repo への commit
                  が材料になる（即時しれんは溜まると止まるが、材料は消えない）。仕事していれば勝手に溜まるわけではない。Cloud
                  作業が主なら今は飛ばしてよい。
                </p>
                <p className="atlas-eq-note atlas-eq-note--plain">
                  repo の追加と鉤かけは、下の『監視リポジトリ』でおこなう。
                </p>
              </div>
              <div className="atlas-eq-quest__actions">
                <button
                  type="button"
                  disabled={pending}
                  className="dq-btn atlas-eq-btn"
                  onClick={() => run(() => skipTutorialHookAction())}
                >
                  今は飛ばして完了
                </button>
                <button
                  type="button"
                  disabled={
                    pending || !diagnosis.watchedRepos.some((r) => r.connected)
                  }
                  className="dq-btn dq-btn-ghost atlas-eq-btn"
                  onClick={() => run(() => completeTutorialAction())}
                >
                  監視中として完了
                </button>
                <Link
                  href="#watched-repos"
                  className="dq-btn dq-btn-ghost atlas-eq-btn"
                >
                  監視リポジトリへ
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* そうびひょう（テキスト台帳＝アクセシブルな正本。押すと中身が開く） */}
      <div className="dq-win atlas-eq-win">
        <p className="atlas-eq-wintitle">
          <span className="atlas-eq-mk" aria-hidden="true" />
          そうびひょう
        </p>
        <div>
          {SLOTS.map((s) => {
            const equipped = Boolean(doneMap[s.step]);
            return (
              <button
                key={s.step}
                type="button"
                className="atlas-eq-ledger__row"
                onClick={() => setOpenSlot(s.step)}
              >
                <span className="atlas-eq-ledger__mark">
                  {equipped ? (
                    <span
                      className="atlas-eq-spr atlas-eq-spr--check"
                      aria-hidden="true"
                    />
                  ) : (
                    <span aria-hidden="true">…</span>
                  )}
                  <span className="sr-only">
                    {equipped ? "そうび済み" : "みそうび"}
                  </span>
                </span>
                <span className="atlas-eq-ledger__name">{s.name}</span>
                <span className="atlas-eq-ledger__what">{s.what}</span>
                <span className="atlas-eq-ledger__tag">
                  {s.required ? "かなめ" : "任意"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 監視リポジトリ（チュートリアル後も常時。hook ステップ中も見えている必要がある） */}
      <div className="dq-win atlas-eq-win">
        <AtlasWatchedReposPanel repos={diagnosis.watchedRepos} />
      </div>

      {/* Cloud / Reachable MCP（任意・1手ウィザード。既定たたみ） */}
      <div className="dq-win atlas-eq-win">
        <AtlasCloudMcpWizardSection diagnosis={diagnosis} />
      </div>

      {/* 用語・診断 */}
      <div className="dq-win atlas-eq-win">
        <p className="atlas-eq-wintitle">
          <span className="atlas-eq-mk" aria-hidden="true" />
          用語（UIのことば と 意味）
        </p>
        <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
          {TUTORIAL_TERMS.map((t) => (
            <li key={t.ui} className="text-[12px] text-[#c9c3a0]">
              <span className="text-[#f7f3d9]">{t.ui}</span>
              <span className="text-[#9ec0ff]"> = </span>
              {t.plain}
            </li>
          ))}
        </ul>

        <details className="mt-4 border-t-2 border-[#002070] pt-3">
          <summary className="cursor-pointer font-[family-name:var(--font-pixel)] text-[12px] text-[#9ec0ff]">
            診断の詳細（かなめ {diagnosis.readyRequired}/
            {diagnosis.totalRequired}）
          </summary>
          <ul className="mt-2 mb-0 list-none space-y-2 p-0">
            {diagnosis.checks.map((c) => (
              <CheckRow
                key={c.id}
                check={c}
                highlight={c.id === diagnosis.nextCheckId}
              />
            ))}
          </ul>
        </details>

        <p className="mt-3 mb-0 text-[11px] text-[#c9c3a0]">
          正本: <code className="text-[#9ec0ff]">docs/onboarding.md</code>
          {" · "}
          MCP: <code className="text-[#9ec0ff]">docs/mcp-setup.md</code>
          {" · "}
          Cloud: <code className="text-[#9ec0ff]">docs/cloud-mcp.md</code>
        </p>
      </div>
    </div>
  );
}

/** たびだち（完了）— ファンファーレと、供給の続け方 A / B の分かれ道 */
function DepartScene({ lampOn }: { lampOn: boolean }) {
  return (
    <div className="atlas-eq-depart">
      <div className="atlas-eq-depart__scene">
        <div className="atlas-eq-depart__rays" aria-hidden="true" />
        <div className="atlas-eq-confetti" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </div>
        <p className="atlas-eq-depart__banner">
          たびだちの じゅんびが ととのった！
        </p>
        <p className="atlas-eq-depart__sub">
          かなめの そうび {REQUIRED_COUNT}／{REQUIRED_COUNT}
          {lampOn
            ? " ・ みはりの ランタンも ともった"
            : " ・ みはりの ランタンは 消えたまま（任意）"}
        </p>

        <div className="atlas-eq-depart__stage">
          <DepartureGate open={1} />
          <div className="atlas-eq-orbit" aria-hidden="true">
            {SLOTS.map((s) => (
              <i key={s.step}>
                <SlotSprite sprite={s.sprite} />
              </i>
            ))}
          </div>
          <div className="atlas-eq-depart__hero" aria-hidden="true">
            <span className="atlas-eq-spr atlas-eq-spr--hero atlas-eq-hero" />
          </div>
        </div>
      </div>

      <div className="atlas-eq-fork">
        <p className="atlas-eq-fork__title">
          <span className="atlas-eq-mk" aria-hidden="true" />
          ここから さきは ふたつの みち
        </p>
        <p className="atlas-eq-fork__lead">
          しれんを 増やしつづける道。
          <span className="atlas-eq-hi">どちらか 一方でよい</span>。
        </p>
        <div className="atlas-eq-fork__roads" aria-hidden="true">
          <i />
          <i />
        </div>
        <div className="atlas-eq-roads">
          <div className="atlas-eq-signpost">
            <div className="atlas-eq-signcard">
              <p className="atlas-eq-signcard__k">みち A ／ みはりの みち</p>
              <p className="atlas-eq-signcard__n">
                監視リポジトリ ＋ git hook（毎日の自動）
              </p>
              <p className="atlas-eq-note">
                下の『監視リポジトリ』でパスを追加し鉤をかける。commit
                がそのまま材料になる。未登録 repo の PR 作業は溜まらない。
              </p>
              <div>
                <Link
                  href="#watched-repos"
                  className="dq-btn dq-btn-ghost atlas-eq-btn"
                >
                  監視リポジトリを ひらく
                </Link>
              </div>
            </div>
          </div>

          <div className="atlas-eq-signpost">
            <div className="atlas-eq-signcard">
              <p className="atlas-eq-signcard__k">みち B ／ ことばの みち</p>
              <p className="atlas-eq-signcard__n">
                会話で request_gate（hook なしの日）
              </p>
              <p className="atlas-eq-note">
                LLM に差分を渡し、「request_gate でしれんを1問作って」と頼む。
              </p>
              <pre className="atlas-eq-code">{REQUEST_GATE_PASTE}</pre>
              <div>
                <CopyButton text={REQUEST_GATE_PASTE} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="atlas-eq-finalbar">
        <Link href="/gates" className="dq-btn atlas-eq-btn atlas-eq-btn--big">
          しれん一覧へ
        </Link>
        <Link
          href="/"
          className="dq-btn dq-btn-ghost atlas-eq-btn atlas-eq-btn--big"
        >
          ちずへ もどる
        </Link>
      </div>

      <p className="m-0 px-4 pb-4 text-[11px] leading-relaxed text-[#9ec0ff]">
        任意の次: 下の青い／金カード『Cloud の生成AIからも…』（P3 B12-3b）。
        解放条件は docs/surface-unlock.md。
      </p>
    </div>
  );
}

function StepToken({ tokenHint }: { tokenHint: string }) {
  const envSnippet = [`MCP_TOKEN=${tokenHint}`, "ENABLE_TERMINAL=true"].join(
    "\n",
  );
  const router = useRouter();
  return (
    <div>
      <p className="atlas-eq-quest__title">
        <span className="atlas-eq-spr atlas-eq-spr--arrow" aria-hidden="true" />
        「とびらの かぎ」を つくる
      </p>
      <p className="atlas-eq-quest__sub">合言葉（MCP_TOKEN）を .env に書く</p>
      <div className="atlas-eq-quest__body">
        <p className="atlas-eq-note">
          下の呪文をコピーしてプロジェクトの .env に保存し、
          <code className="text-[#9ec0ff]"> npm run dev:all </code>
          で再起動。書いたらこのページを再読み込み。
        </p>
        <pre className="atlas-eq-code">{envSnippet}</pre>
      </div>
      <div className="atlas-eq-quest__actions">
        <CopyButton text={envSnippet} label="この呪文をコピー" />
        <button
          type="button"
          className="dq-btn dq-btn-ghost atlas-eq-btn"
          onClick={() => router.refresh()}
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}

function LlmTrackHint({
  track,
  mcpUrl,
}: {
  track: TutorialLlmTrack;
  mcpUrl: string;
}) {
  if (track === "jumon") {
    return (
      <p className="atlas-eq-note atlas-eq-note--plain">
        つまり ホームの『じゅもんをとなえる』を開き、貼って送信。ENABLE_TERMINAL
        と dev:all が必要。
      </p>
    );
  }
  if (track === "claude") {
    return (
      <p className="atlas-eq-note atlas-eq-note--plain">
        つまり 手元 CLI は先に{" "}
        <code>
          claude mcp add --transport http applied-loop {mcpUrl} --header
          &quot;Authorization: Bearer …&quot;
        </code>
        （localhost）。Claude Web / Cloud は下の青いカード（Reachable）。トンネル
        URL を手元設定に書かない。
      </p>
    );
  }
  if (track === "cursor") {
    return (
      <p className="atlas-eq-note atlas-eq-note--plain">
        つまり Desktop の ~/.cursor/mcp.json は url=<code>{mcpUrl}</code> と
        Bearer のみ。Cloud Agent は下の青いカード（Desktop 設定は効かない・トンネル
        URL を mcp.json に書かない）。
      </p>
    );
  }
  return (
    <p className="atlas-eq-note atlas-eq-note--plain">
      つまり手元は ~/.codex/config.toml に localhost URL。別ホストの Codex
      は下の青いカード （Reachable + MCP_TOKEN）。
    </p>
  );
}

function CheckRow({
  check,
  highlight,
}: {
  check: SetupCheck;
  highlight: boolean;
}) {
  return (
    <li
      className={`flex min-w-0 items-start gap-2 py-1.5 text-[13px] ${
        highlight ? "text-[#f7f3d9]" : "text-[#c9c3a0]"
      }`}
    >
      <span
        className={`shrink-0 font-[family-name:var(--font-pixel)] text-[10px] ${
          check.ok ? "text-[#3ecf5a]" : "text-[#e84848]"
        }`}
      >
        {check.ok ? "✓" : "！"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 leading-snug">
          {check.label}
          {!check.required ? (
            <span className="ml-1 text-[10px] text-[#9ec0ff]">任意</span>
          ) : null}
        </p>
        <p className="mt-0.5 mb-0 text-[11px] leading-relaxed text-[#9a9470]">
          {check.detail}
        </p>
        <p className="mt-0.5 mb-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          つまり {check.plain}
        </p>
        {!check.ok ? (
          <p className="mt-0.5 mb-0 font-mono text-[10px] leading-relaxed text-[#c9c3a0]">
            → {check.howTo}
          </p>
        ) : null}
      </div>
    </li>
  );
}
