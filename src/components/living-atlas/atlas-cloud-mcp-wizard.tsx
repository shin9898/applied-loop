"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SetupDiagnosis } from "@/lib/setup-diagnosis";
import {
  CLOUD_MCP_CLIENT_LABELS,
  CLOUD_MCP_TUNNEL_STEPS,
  CLOUD_WIZARD_STEP_LABELS,
  CLOUD_WIZARD_STEP_ORDER,
  CLOUD_WIZARD_STORAGE_KEY,
  cloudMcpClientGuides,
  cloudMcpVerifyPrompt,
  cloudTunnelReady,
  cloudVerifyDetected,
  cloudWizardCanAdvance,
  defaultCloudWizardState,
  nextCloudWizardStep,
  parseCloudWizardState,
  prevCloudWizardStep,
  type CloudMcpClient,
  type CloudWizardPersisted,
} from "@/lib/cloud-mcp-wizard";

function CopyButton({
  text,
  label = "コピー",
}: {
  text: string;
  label?: string;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="dq-btn !px-3 !py-2 text-[8px]"
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

function loadWizard(): CloudWizardPersisted {
  try {
    const raw = localStorage.getItem(CLOUD_WIZARD_STORAGE_KEY);
    if (!raw) return defaultCloudWizardState();
    return parseCloudWizardState(JSON.parse(raw));
  } catch {
    return defaultCloudWizardState();
  }
}

function saveWizard(state: CloudWizardPersisted) {
  try {
    localStorage.setItem(CLOUD_WIZARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** /setup 任意: Cloud Reachable MCP を1手ずつ進める */
export function AtlasCloudMcpWizard({
  diagnosis,
}: {
  diagnosis: SetupDiagnosis;
}) {
  const router = useRouter();
  const [state, setState] = useState<CloudWizardPersisted>(defaultCloudWizardState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadWizard());
    setHydrated(true);
  }, []);

  const patch = useCallback((partial: Partial<CloudWizardPersisted>) => {
    setState((prev) => {
      const next = { ...prev, ...partial };
      saveWizard(next);
      return next;
    });
  }, []);

  const tunnelOk = cloudTunnelReady({
    reachable: diagnosis.mcpEndpoint.reachable,
    tokenConfigured: diagnosis.mcpEndpoint.tokenConfigured,
  });

  const verifyOk = cloudVerifyDetected({
    verifyEnteredAt: state.verifyEnteredAt,
    mcpLastAt: diagnosis.mcpLastAt,
    verifiedAt: state.verifiedAt,
  });

  // verify 中は MCP 疎通を待つため定期 refresh
  useEffect(() => {
    if (!hydrated || state.step !== "verify" || verifyOk) return;
    const id = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(id);
  }, [hydrated, state.step, verifyOk, router]);

  // MCP 検知できたら verifiedAt を刻んで done へ進める準備
  useEffect(() => {
    if (!hydrated || state.step !== "verify" || !verifyOk || state.verifiedAt) {
      return;
    }
    if (diagnosis.mcpLastAt && state.verifyEnteredAt) {
      const start = Date.parse(state.verifyEnteredAt);
      const mcp = Date.parse(diagnosis.mcpLastAt);
      if (!Number.isNaN(start) && !Number.isNaN(mcp) && mcp >= start) {
        patch({ verifiedAt: diagnosis.mcpLastAt });
      }
    }
  }, [
    hydrated,
    state.step,
    state.verifyEnteredAt,
    state.verifiedAt,
    verifyOk,
    diagnosis.mcpLastAt,
    patch,
  ]);

  const guides = useMemo(() => cloudMcpClientGuides(), []);
  const guide = guides.find((g) => g.id === state.client);
  const verify = useMemo(() => cloudMcpVerifyPrompt(), []);

  const primarySnippet =
    state.client === "cursor"
      ? diagnosis.mcpSnippets.cursorJson
      : state.client === "claude"
        ? diagnosis.mcpSnippets.claudeProjectJson
        : state.client === "codex"
          ? diagnosis.mcpSnippets.codexToml
          : "";
  const secondarySnippet =
    state.client === "claude" ? diagnosis.mcpSnippets.claudeCli : null;

  const canNext = cloudWizardCanAdvance(
    state.step,
    state,
    {
      reachable: diagnosis.mcpEndpoint.reachable,
      tokenConfigured: diagnosis.mcpEndpoint.tokenConfigured,
    },
    diagnosis.mcpLastAt,
  );

  const goNext = () => {
    const n = nextCloudWizardStep(state.step);
    if (!n || !canNext) return;
    if (n === "verify") {
      patch({
        step: n,
        verifyEnteredAt: new Date().toISOString(),
        verifiedAt: null,
      });
      return;
    }
    if (n === "done") {
      patch({
        step: n,
        verifiedAt: state.verifiedAt ?? new Date().toISOString(),
      });
      return;
    }
    patch({ step: n });
  };

  const goPrev = () => {
    const p = prevCloudWizardStep(state.step);
    if (p) patch({ step: p });
  };

  const pickClient = (client: CloudMcpClient) => {
    patch({
      client,
      step: "pick",
      registeredAt: null,
      verifyEnteredAt: null,
      verifiedAt: null,
    });
  };

  const reset = () => {
    const fresh = defaultCloudWizardState();
    saveWizard(fresh);
    setState(fresh);
  };

  if (!hydrated) {
    return (
      <p className="m-0 text-[11px] text-[#9a9470]">Cloud ウィザードを開いておる…</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        いまやる1手だけ進める。トンネル〜登録は決定論、LLM は最後の疎通確認だけ。
        正本: <code className="text-[#9ec0ff]">docs/cloud-mcp.md</code>
      </p>

      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {CLOUD_WIZARD_STEP_ORDER.filter((id) => id !== "done").map((id, i) => {
          const active = state.step === id;
          const doneIdx = CLOUD_WIZARD_STEP_ORDER.indexOf(state.step);
          const thisIdx = CLOUD_WIZARD_STEP_ORDER.indexOf(id);
          const done = state.step === "done" || thisIdx < doneIdx;
          return (
            <li
              key={id}
              className={`rounded-sm border px-2 py-1 font-[family-name:var(--font-pixel)] text-[8px] ${
                done
                  ? "border-[#3ecf5a] text-[#3ecf5a]"
                  : active
                    ? "border-[#f0d25a] bg-[#f0d25a] text-[#000c4a]"
                    : "border-[#445] text-[#9a9470]"
              }`}
            >
              {i + 1}.{CLOUD_WIZARD_STEP_LABELS[id]}
              {done ? "✓" : active ? "←" : ""}
            </li>
          );
        })}
      </ol>

      <div className="border-[3px] border-[#f0d25a] bg-[#001a8c] p-3.5">
        <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#f0d25a]">
          ◆ いまやる1手（Cloud）
        </p>

        {state.step === "pick" ? (
          <StepPick client={state.client} onPick={pickClient} />
        ) : null}

        {state.step === "tunnel" ? (
          <StepTunnel
            mcpUrl={diagnosis.mcpEndpoint.mcpUrl}
            reachable={diagnosis.mcpEndpoint.reachable}
            tokenConfigured={diagnosis.mcpEndpoint.tokenConfigured}
            tunnelOk={tunnelOk}
            onRefresh={() => router.refresh()}
          />
        ) : null}

        {state.step === "register" && guide ? (
          <StepRegister
            guide={guide}
            primarySnippet={primarySnippet}
            secondarySnippet={secondarySnippet}
            registered={Boolean(state.registeredAt)}
            onRegistered={() =>
              patch({ registeredAt: new Date().toISOString() })
            }
          />
        ) : null}

        {state.step === "verify" ? (
          <StepVerify
            client={state.client}
            verify={verify}
            verifyOk={verifyOk}
            onSelfOk={() =>
              patch({ verifiedAt: new Date().toISOString() })
            }
            onRefresh={() => router.refresh()}
          />
        ) : null}

        {state.step === "done" ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[15px] text-[#3ecf5a]">Cloud MCP、通った</p>
            <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
              {state.client
                ? `${CLOUD_MCP_CLIENT_LABELS[state.client]} から Reachable MCP でループに入れる。`
                : "Reachable MCP でループに入れる。"}
              URL が変わったら登録を更新すること。
            </p>
            <button
              type="button"
              className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
              onClick={reset}
            >
              最初からやり直す
            </button>
          </div>
        ) : null}

        {state.step !== "done" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {state.step !== "pick" ? (
              <button
                type="button"
                className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
                onClick={goPrev}
              >
                戻る
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canNext}
              className="dq-btn !px-3 !py-2 text-[8px] disabled:opacity-40"
              onClick={goNext}
            >
              {state.step === "verify" ? "完了へ" : "次へ"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StepPick({
  client,
  onPick,
}: {
  client: CloudMcpClient | null;
  onPick: (c: CloudMcpClient) => void;
}) {
  const guides = cloudMcpClientGuides();
  return (
    <div className="mt-2 space-y-2">
      <p className="m-0 text-[15px] text-[#f7f3d9]">使う Cloud 面を1つ選ぶ</p>
      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        迷ったら Cursor（dogfood 済み）。Claude / Codex は公式 docs 準拠・未 dogfood。
      </p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CLOUD_MCP_CLIENT_LABELS) as CloudMcpClient[]).map((id) => {
          const dogfood = id === "cursor";
          return (
            <button
              key={id}
              type="button"
              className={`dq-btn !px-3 !py-2 text-[8px] ${
                client === id ? "" : "dq-btn-ghost"
              }`}
              onClick={() => onPick(id)}
            >
              {CLOUD_MCP_CLIENT_LABELS[id]}
              {dogfood ? " ★" : ""}
            </button>
          );
        })}
      </div>
      {client ? (
        <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          {guides.find((g) => g.id === client)?.confidenceNote ??
            (client === "cursor" ? "dogfood 済み。" : "")}
        </p>
      ) : null}
      {!client ? (
        <p className="m-0 text-[11px] text-[#9a9470]">選ぶと「次へ」が開く。</p>
      ) : null}
    </div>
  );
}

function StepTunnel({
  mcpUrl,
  reachable,
  tokenConfigured,
  tunnelOk,
  onRefresh,
}: {
  mcpUrl: string;
  reachable: boolean;
  tokenConfigured: boolean;
  tunnelOk: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      <p className="m-0 text-[15px] text-[#f7f3d9]">
        このアプリに Reachable URL を教える
      </p>
      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        ここで見るのは Cursor の接続状態ではない。{" "}
        <code className="text-[#9ec0ff]">.env</code> の{" "}
        <code className="text-[#9ec0ff]">APPLIED_LOOP_URL</code>（トンネルの
        https）をアプリが読んでいるか。Cursor に先に登録してあっても、ここが
        localhost のままだと次へ進めない。
      </p>
      <ol className="m-0 list-decimal space-y-1 pl-5 text-[11px] leading-relaxed text-[#c9c3a0]">
        {CLOUD_MCP_TUNNEL_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <ul className="m-0 list-none space-y-1 p-0 text-[12px]">
        <li className={reachable ? "text-[#3ecf5a]" : "text-[#e84848]"}>
          {reachable ? "✓" : "！"} アプリが見ている URL が localhost 以外
        </li>
        <li className={tokenConfigured ? "text-[#3ecf5a]" : "text-[#e84848]"}>
          {tokenConfigured ? "✓" : "！"} MCP_TOKEN あり
        </li>
      </ul>
      <p className="m-0 text-[11px] text-[#c9c3a0]">
        いまアプリが見ている MCP URL:
      </p>
      <p className="m-0 font-mono text-[11px] text-[#9ec0ff]">{mcpUrl}</p>
      {!reachable ? (
        <p className="m-0 text-[11px] leading-relaxed text-[#f0d25a]">
          → .env に{" "}
          <code className="text-[#9ec0ff]">
            APPLIED_LOOP_URL=https://（cloudflared が出したホスト）
          </code>{" "}
          を書いて <code className="text-[#9ec0ff]">npm run dev:all</code>{" "}
          を再起動してから「再診断する」。
        </p>
      ) : null}
      <p className="m-0 text-[10px] leading-relaxed text-[#9a9470]">
        「再診断する」= このページを再読み込みして .env を見直すだけ。Cursor
        側の疎通テストではない。quick tunnel は再起動で URL が変わる。
      </p>
      <button
        type="button"
        className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
        onClick={onRefresh}
      >
        再診断する（.env を再読込）
      </button>
      {tunnelOk ? (
        <p className="m-0 text-[12px] text-[#3ecf5a]">トンネル準備 OK。次へ。</p>
      ) : (
        <p className="m-0 text-[12px] text-[#e84848]">
          まだ足りぬ。APPLIED_LOOP_URL 反映 → 再起動 → 再診断。
        </p>
      )}
    </div>
  );
}

function StepRegister({
  guide,
  primarySnippet,
  secondarySnippet,
  registered,
  onRegistered,
}: {
  guide: ReturnType<typeof cloudMcpClientGuides>[number];
  primarySnippet: string;
  secondarySnippet: string | null;
  registered: boolean;
  onRegistered: () => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      <p className="m-0 text-[15px] text-[#f7f3d9]">
        {CLOUD_MCP_CLIENT_LABELS[guide.id]} に登録する
      </p>
      <p className="m-0 text-[12px] leading-relaxed text-[#f7f3d9]">
        登録先: {guide.registerWhere}
      </p>
      <p className="m-0 text-[11px] leading-relaxed text-[#f0d25a]">
        罠: {guide.desktopTrap}
      </p>
      {guide.headerGotcha ? (
        <p className="m-0 text-[11px] leading-relaxed text-[#9ec0ff]">
          Header: {guide.headerGotcha}
        </p>
      ) : null}
      <ol className="m-0 list-decimal space-y-1 pl-5 text-[11px] leading-relaxed text-[#c9c3a0]">
        {guide.steps
          .filter((s) => !s.includes("検証文"))
          .map((s) => (
            <li key={s}>{s}</li>
          ))}
      </ol>
      <p className="m-0 text-[10px] text-[#9a9470]">{guide.configLabel}</p>
      <pre className="m-0 max-h-36 overflow-auto whitespace-pre-wrap border-[2px] border-white bg-[#000c4a] p-2.5 text-[10px] leading-relaxed text-[#f7f3d9]">
        {primarySnippet}
      </pre>
      <CopyButton text={primarySnippet} label="設定をコピー" />
      {secondarySnippet ? (
        <>
          <p className="m-0 text-[10px] text-[#9a9470]">手元 / SSH の CLI（補助）</p>
          <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap border-[2px] border-white bg-[#000c4a] p-2.5 text-[10px] leading-relaxed text-[#f7f3d9]">
            {secondarySnippet}
          </pre>
          <CopyButton text={secondarySnippet} label="CLI をコピー" />
        </>
      ) : null}
      <button
        type="button"
        className="dq-btn !px-3 !py-2 text-[8px]"
        onClick={onRegistered}
      >
        {registered ? "登録した ✓" : "登録した（次へ進む）"}
      </button>
    </div>
  );
}

function StepVerify({
  client,
  verify,
  verifyOk,
  onSelfOk,
  onRefresh,
}: {
  client: CloudMcpClient | null;
  verify: string;
  verifyOk: boolean;
  onSelfOk: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      <p className="m-0 text-[15px] text-[#f7f3d9]">新しいセッションに検証文を貼る</p>
      <p className="m-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        ここだけ LLM に頼る。成功: morning_briefing が返る。
        {client === "cursor"
          ? " Cursor なら新しい Cloud Agent で。"
          : " 登録した面の新しいセッションで。"}
      </p>
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap border-[2px] border-white bg-[#000c4a] p-2.5 text-[10px] leading-relaxed text-[#f7f3d9]">
        {verify}
      </pre>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={verify} label="検証文をコピー" />
        <button
          type="button"
          className="dq-btn dq-btn-ghost !px-3 !py-2 text-[8px]"
          onClick={onRefresh}
        >
          疎通を再確認
        </button>
        <button
          type="button"
          className="dq-btn !px-3 !py-2 text-[8px]"
          onClick={onSelfOk}
        >
          返ってきた（自己申告）
        </button>
      </div>
      {verifyOk ? (
        <p className="m-0 text-[12px] text-[#3ecf5a]">
          疎通を検知した（または自己申告済み）。完了へ進める。
        </p>
      ) : (
        <p className="m-0 text-[11px] leading-relaxed text-[#9a9470]">
          貼ったあと、こちらが MCP を検知するか「返ってきた」を押す。失敗:
          ツール無し / 401 / timeout。
        </p>
      )}
    </div>
  );
}

const CLOUD_WIZARD_OPEN_KEY = "atlas-cloud-mcp-wizard-open";

/**
 * 本線チュートリアルの下に置く任意カード。
 * 折りたたみ summary だけだと見落とすので、ベネフィット見出しを常時見せる。
 */
export function AtlasCloudMcpWizardSection({
  diagnosis,
}: {
  diagnosis: SetupDiagnosis;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CLOUD_WIZARD_OPEN_KEY);
      if (saved === "1") setOpen(true);
      else if (saved === "0") setOpen(false);
      else setOpen(diagnosis.mcpEndpoint.reachable);
    } catch {
      setOpen(diagnosis.mcpEndpoint.reachable);
    }
    setHydrated(true);
  }, [diagnosis.mcpEndpoint.reachable]);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(CLOUD_WIZARD_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border-[3px] border-[#9ec0ff] bg-[#000c4a] p-3.5 outline outline-2 outline-[#002070]">
      <p className="m-0 font-[family-name:var(--font-pixel)] text-[9px] text-[#9ec0ff]">
        ◆ 任意 · Cloud の生成AIからも同じループ
        {diagnosis.mcpEndpoint.reachable ? "（Reachable）" : ""}
      </p>
      <p className="mt-2 mb-0 text-[15px] leading-snug text-[#f7f3d9]">
        Cursor Cloud / Claude Code on the web / Codex
        など、手元以外の生成AIからも Applied Loop を使える
      </p>
      <p className="mt-1.5 mb-0 text-[12px] leading-relaxed text-[#c9c3a0]">
        ローカルのじゅんびが終わったあとでよい。Desktop の MCP 設定だけでは Cloud
        に届かない——トンネルで MCP だけ外に届ける薄い楔（ダッシュボードは手元のまま）。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="dq-btn !px-3 !py-2 text-[8px]"
          onClick={() => toggle(!open)}
        >
          {!hydrated ? "開く" : open ? "ウィザードを閉じる" : "ウィザードを始める"}
        </button>
        <span className="text-[10px] text-[#9a9470]">
          選ぶ → トンネル → 登録 → 疎通（4手）
        </span>
      </div>
      {open ? (
        <div className="mt-3 border-t-2 border-[#002070] pt-3">
          <AtlasCloudMcpWizard diagnosis={diagnosis} />
        </div>
      ) : null}
    </div>
  );
}
