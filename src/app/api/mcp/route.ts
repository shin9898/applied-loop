import { after } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { dateKeyJST, dayOfWeekJST, dayStartJST } from "@/lib/date";
import { gradeGate, scheduleDueGates } from "@/lib/gate";
import { generateWeeklyReviews, weeklyEvidenceCounts } from "@/lib/goal";
import { triageCapture } from "@/lib/capture";
import { generateYesterdayDigestIfNeeded } from "@/lib/obsidian-digest";
import { generateWeeklyNarration } from "@/lib/audio-digest";
import { runHeadlessLLM, parseLLMJson } from "@/lib/headless-llm";
import { importanceLabel, scoreCaptureImportance } from "@/lib/inbox-score";
import { saveTaskMappings } from "@/lib/task-map";
import { emitAtlasEvent } from "@/lib/atlas-live-events";
import { detectAndCaptureHarnessPatterns } from "@/lib/harness-patterns";
import {
  linkRequirementManual,
  listRequirementSummaries,
  nextRequirementCandidates,
  recentlyUnderstoodRequirements,
} from "@/lib/requirement";
import { parseGradePayload } from "@/lib/grade-payload";
import { enrichMissingGateDomains } from "@/lib/place-enrich";
import {
  mcpToolAllowedOnSurface,
  resolveMcpSurface,
} from "@/lib/mcp-surface";

export const dynamic = "force-dynamic";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/** 出題中 = pending かつ nextReviewAt が未設定 or 到来済み */
function pendingGateWhere(now: Date = new Date()) {
  return {
    status: "pending" as const,
    OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
  };
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const handler = createMcpHandler(
  (server) => {
    // ADR-0019 P0: 既定 core。本人は MCP_SURFACE=full
    const surface = resolveMcpSurface();
    const registerTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, ...rest: unknown[]) => {
      if (!mcpToolAllowedOnSurface(name, surface)) return undefined;
      // mcp-handler の型は可変。面フィルタだけ差し込む
      return (registerTool as (...args: unknown[]) => unknown)(name, ...rest);
    }) as typeof server.registerTool;

    server.registerTool(
      "capture_learning_candidate",
      {
        description: [
          "学びの候補を受信箱 (Inbox) に登録する。正典には直接書かず、朝の仕分けで確定される。",
          "発火条件: ユーザーが明示的に依頼した時、またはセッションのふりかえり時のみ呼ぶこと。",
          "対象: デバッグで判明した非自明な事実、設計判断の根拠になった知見。",
          "対象外: 一般常識、作業ログ、コマンドの写経。",
        ].join(" "),
        inputSchema: {
          title: z
            .string()
            .describe("学びのタイトルを一文で。例: Prisma 7 は driver adapter が必須"),
          note: z.string().optional().describe("補足メモ (背景・詳細)"),
          sourceTool: z
            .enum(["claude-code", "cursor", "codex", "manual"])
            .describe("発生元のツール"),
          sourceContext: z
            .string()
            .optional()
            .describe("発生元の文脈 (作業ディレクトリ・会話の要約など)"),
        },
      },
      async ({ title, note, sourceTool, sourceContext }) => {
        await requireAuth();
        const trimmed = title.trim();
        if (!trimmed) {
          return { ...text("title が空です。"), isError: true };
        }
        const dedupeKey = trimmed.toLowerCase().replace(/\s+/g, " ");
        const existing = await prisma.capture.findFirst({
          where: { dedupeKey, status: "pending" },
        });
        if (existing) {
          return text(
            `同じ候補が既に受信箱にあります (id: ${existing.id})。重複登録をスキップしました。`
          );
        }
        const capture = await prisma.capture.create({
          data: {
            title: trimmed,
            note: note?.trim() || null,
            sourceTool,
            sourceContext: sourceContext?.trim() || null,
            dedupeKey,
          },
        });
        emitAtlasEvent({ type: "capture_added", title: capture.title });
        // ADR-0012 §2: 重要度スコアリングは非同期。応答は即返す (llm_auto はまだ無効)
        after(() => {
          scoreCaptureImportance(capture.id).catch((e) =>
            console.error("[mcp] scoreCaptureImportance failed:", e)
          );
        });
        return text(
          `受信箱に登録しました (id: ${capture.id})。朝の仕分けで triage_inbox により確定されます。`
        );
      }
    );

    server.registerTool(
      "record_application",
      {
        description:
          "学びを実務に使った記録 (証跡) を残す。entryId か entryTitle のどちらか一方で学びを指定する。",
        inputSchema: {
          entryId: z.string().optional().describe("学びの ID (分かる場合)"),
          entryTitle: z.string().optional().describe("学びタイトルの一部 (部分一致で検索)"),
          appliedTo: z.string().describe("何に使ったか。例: 個人開発 applied-loop の設計"),
          note: z.string().describe("どう使ったか・結果どうなったか"),
          decisionChanged: z
            .string()
            .optional()
            .describe("変わった意思決定・採否・優先順位 (格上げの核心)"),
        },
      },
      async ({ entryId, entryTitle, appliedTo, note, decisionChanged }) => {
        await requireAuth();
        let id = entryId?.trim();
        if (!id) {
          const q = entryTitle?.trim();
          if (!q) {
            return { ...text("entryId か entryTitle のどちらかを指定してください。"), isError: true };
          }
          const matches = await prisma.entry.findMany({
            where: { title: { contains: q } },
            take: 5,
            orderBy: { createdAt: "desc" },
          });
          if (matches.length === 0) {
            return { ...text(`「${q}」に一致する学びが見つかりません。先に capture_learning_candidate で候補を登録してください。`), isError: true };
          }
          if (matches.length > 1) {
            const list = matches.map((m) => `- ${m.title} (id: ${m.id})`).join("\n");
            return { ...text(`複数一致しました。entryId で指定してください:\n${list}`), isError: true };
          }
          id = matches[0].id;
        }
        const app = await prisma.application.create({
          data: {
            entryId: id,
            appliedTo: appliedTo.trim(),
            note: note.trim(),
            decisionChanged: decisionChanged?.trim() || null,
          },
        });
        const entry = await prisma.entry.findUnique({
          where: { id },
          select: { title: true },
        });
        // Goal 証跡の能動提案 (ADR-0008 / 0012)
        const { suggestLinksForTarget } = await import("@/lib/goal");
        const linked = await suggestLinksForTarget({
          targetType: "application",
          targetId: app.id,
          title: `${entry?.title ?? "学び"} → ${appliedTo.trim()}`,
        }).catch(() => 0);

        const applied = appliedTo.trim();
        const repoHint =
          /workbench|applied-loop|triple-|my-copy|harness/i.test(applied)
            ? applied
            : null;
        const followUp = [
          `実務使用の記録を登録しました (id: ${app.id})。証跡タイムラインに追加されます。`,
          linked > 0
            ? `Goal への紐付け提案を ${linked} 件作成しました。approve_goal_link で確定できます。`
            : null,
          repoHint
            ? [
                "## 再観測 (閉ループ)",
                `- appliedTo が repo/ハーネス系に見えるので、翌セッションで suggest_cache_prefix_fix(repo) か /harness で効果を確認せよ。`,
                `- 候補文字列: ${repoHint}`,
              ].join("\n")
            : [
                "## 再観測 (閉ループ)",
                "- 翌週のもくひょう証跡・しれん再出題で「効いたか」を見よ。",
              ].join("\n"),
        ]
          .filter(Boolean)
          .join("\n");
        return text(followUp);
      }
    );

    server.registerTool(
      "list_pending_gates",
      {
        description: [
          "出題中のしれん（理解度チェック）を一覧する。MCP 接続直後やユーザーが「出題を見て」と言ったら先に呼ぶ。",
          "返す順は contextSummary（文脈）→ question（問い）→ resources（手がかり）。",
          "呼んだあと: どれを解くか提案し、ユーザーが提出を明示したら answer_gate。合否は会話中に断定しない。",
        ].join(" "),
        inputSchema: {},
      },
      async () => {
        await requireAuth();
        const now = new Date();
        // 疎通直後に pending が空にならないようサンプルを保証（B4-3）
        const { ensureTutorialSeed } = await import("@/lib/tutorial-seed");
        await ensureTutorialSeed();
        // G4: 再出題はホーム以外からも発火
        await scheduleDueGates().catch((e) =>
          console.error("[list_pending_gates] scheduleDueGates failed:", e),
        );
        const { getWeaknessPatternsForDashboard } = await import(
          "@/lib/weakness"
        );
        const weaknesses = await getWeaknessPatternsForDashboard();
        const weakAspects = (weaknesses ?? []).map((w) => w.aspect.toLowerCase());
        const gates = await prisma.gate.findMany({
          where: pendingGateWhere(now),
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            event: { select: { repo: true, summary: true, ref: true } },
          },
        });
        if (gates.length === 0) {
          // G2/B4-3: 空でも診断付きの非空応答（サンプル提出後の aha を守る）
          const { TUTORIAL_GATE_ID } = await import("@/lib/tutorial-constants");
          const { buildEmptyPendingGatesMessage } = await import(
            "@/lib/pending-gates-empty"
          );
          const tutorial = await prisma.gate.findUnique({
            where: { id: TUTORIAL_GATE_ID },
            select: { status: true, answeredAt: true },
          });
          const sampleSubmitted =
            !!tutorial &&
            (tutorial.answeredAt != null || tutorial.status !== "pending");
          return text(
            buildEmptyPendingGatesMessage({
              tutorialGateId: TUTORIAL_GATE_ID,
              sampleSubmitted,
            }),
          );
        }
        // 弱い観点ラベルが問い／論点に含まれるものを前へ (ADR-0011)
        const scored = gates.map((g) => {
          const blob = `${g.question}\n${g.targetConcept ?? ""}`.toLowerCase();
          const hit = weakAspects.findIndex((a) => a && blob.includes(a));
          return { g, pri: hit === -1 ? 99 : hit };
        });
        scored.sort((a, b) => a.pri - b.pri || 0);
        const ordered = scored.slice(0, 10).map((s) => s.g);
        const lines: string[] = [
          `# 出題中ゲート: ${ordered.length} 件`,
          weakAspects.length
            ? `(弱点優先: ${weakAspects.slice(0, 3).join(" / ")})`
            : "",
          "",
        ].filter((l) => l !== undefined);
        for (const g of ordered) {
          const resources = parseJsonArray(g.resources);
          const rubric = parseJsonArray(g.rubricCriteria);
          const contextSummary =
            g.contextSummary?.trim() ||
            g.event?.summary ||
            (g.targetConcept ? `論点: ${g.targetConcept}` : null) ||
            "(文脈なし)";
          lines.push(`## gateId: ${g.id}`);
          lines.push(`- contextSummary: ${contextSummary}`);
          lines.push(`- question: ${g.question}`);
          lines.push(
            `- resources: ${resources.length > 0 ? JSON.stringify(resources) : "[]"}`,
          );
          lines.push(`- repo: ${g.event?.repo ?? "(なし)"}`);
          lines.push(`- kind: ${g.kind}`);
          if (g.domain) lines.push(`- domain: ${g.domain}`);
          lines.push(
            `- rubric: ${rubric.length > 0 ? JSON.stringify(rubric) : "[]"}`,
          );
          lines.push("");
        }
        lines.push(
          "ユーザーが提出を明示したら answer_gate(gateId, answer)。採点は非同期。合否は get_gate_result か Web のしれん画面で確認（会話中に断定しない）。",
        );
        return text(lines.join("\n"));
      }
    );

    server.registerTool(
      "request_gate",
      {
        description: [
          "会話からしれん（理解度チェック）を1問生成する。git hook が無い日や Cloud 作業日の供給経路。",
          "引数 diff に変更差分を渡す（DB には保存しない）。repo / summary は任意のヒント。",
          "ユーザーが「この差分で出題して」「request_gate」と明示したときだけ呼ぶ。",
          "呼んだあと: 生成された問いを見せ、提出はユーザーが明示したら answer_gate。",
        ].join(" "),
        inputSchema: {
          diff: z
            .string()
            .describe("git diff または変更差分テキスト（長い場合は先頭が使われる）"),
          repo: z
            .string()
            .optional()
            .describe("リポジトリ名のヒント（任意）"),
          summary: z
            .string()
            .optional()
            .describe("変更の一行要約（任意）"),
        },
      },
      async ({ diff, repo, summary }) => {
        await requireAuth();
        const { requestGateFromDiff } = await import("@/lib/gate");
        const result = await requestGateFromDiff({ diff, repo, summary });
        if (!result.ok) {
          return { ...text(result.message), isError: true };
        }
        return text(
          [
            `# しれんを生成しました`,
            `gateId: ${result.gateId}`,
            result.domain ? `domain: ${result.domain}` : "",
            result.contextSummary
              ? `contextSummary:\n${result.contextSummary}`
              : "",
            `question: ${result.question}`,
            "",
            "次: ユーザーが提出を明示したら answer_gate。合否は会話中に断定しない。",
            `Web: http://localhost:3100/gates/${result.gateId}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    );

    server.registerTool(
      "answer_gate",
      {
        description: [
          "しれん（理解度チェック）への回答を受理する。ユーザーが「提出する／送って」と明示したときだけ呼ぶ。",
          "採点は非同期。合否・点数は絶対に返さない（会話中の迎合を防ぐ）。",
          "呼んだあと: 固定案内どおり get_gate_result か Web のしれん画面へ誘導する。",
          'アプリ内じゅもん経由なら source: "terminal"。',
        ].join(" "),
        inputSchema: {
          gateId: z.string().describe("ゲート ID (list_pending_gates で取得)"),
          answer: z.string().describe("自分の言葉での説明"),
          source: z
            .enum(["mcp", "terminal"])
            .optional()
            .describe(
              '回答経路。terminal=アプリ内ターミナル (answerMode=assisted)。省略時は mcp 相当 (in_session)',
            ),
        },
      },
      async ({ gateId, answer, source }) => {
        await requireAuth();
        const { acceptGateAnswer } = await import("@/lib/gate-answer");
        const result = await acceptGateAnswer({
          gateId,
          answer,
          source: source === "terminal" ? "terminal" : "mcp",
        });
        if (!result.ok) {
          return { ...text(result.message), isError: true };
        }
        // B1-4: 合否表現なし＋次アクション固定
        return text(
          [
            "回答を受け付けました。採点は裏で進みます。この応答には合否を書きません。",
            "次の一手（どれか1つ）:",
            `- get_gate_result(gateId: "${gateId}") で状態を見る`,
            `- Web のしれん画面: http://localhost:3100/gates/${gateId}`,
            "- つまずきが付いたらずかん: http://localhost:3100/zukan",
          ].join("\n"),
        );
      }
    );

    server.registerTool(
      "get_gate_result",
      {
        description: [
          "しれんの採点結果を返す（verdict / feedback / rubric / answerMode）。",
          "answer_gate のあと、ユーザーが結果を聞いたとき、または採点待ちの確認で呼ぶ。",
          "未採点なら grading / pending 状態を返す。合否を推測で埋めない。",
        ].join(" "),
        inputSchema: {
          gateId: z.string().describe("ゲート ID"),
        },
      },
      async ({ gateId }) => {
        await requireAuth();
        const id = gateId.trim();
        const gate = await prisma.gate.findUnique({ where: { id } });
        if (!gate) {
          return { ...text(`ゲートが見つかりません (id: ${id})。`), isError: true };
        }
        const graded = ["passed", "failed", "self_graded_pass", "self_graded_fail"].includes(
          gate.status
        );
        if (!graded) {
          const stateLabel: Record<string, string> = {
            pending: "未回答",
            answered: "採点待ち",
            grading: "採点中",
            grading_failed: "採点失敗 (リトライが必要)",
            dismissed: "スキップ済み",
          };
          return text(
            [
              `# ゲート結果 (id: ${gate.id})`,
              `status: ${gate.status} (${stateLabel[gate.status] ?? gate.status})`,
              gate.gradeNote ? `note: ${gate.gradeNote}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          );
        }
        const verdict = ["passed", "self_graded_pass"].includes(gate.status)
          ? "pass"
          : "fail";
        const payload = parseGradePayload(gate.rubricResult);
        const { formatRootCauseNextMarkdown } = await import(
          "@/lib/root-cause-next"
        );
        const rootNext = formatRootCauseNextMarkdown(payload.rootCause);
        return text(
          [
            `# ゲート結果 (id: ${gate.id})`,
            `verdict: ${verdict}`,
            `status: ${gate.status}`,
            `answerMode: ${gate.answerMode ?? "(未設定)"}`,
            `feedback: ${gate.gradeNote ?? "(なし)"}`,
            payload.correctModel
              ? `correct_model: ${payload.correctModel}`
              : "",
            payload.misconception
              ? `misconception: ${payload.misconception}`
              : "",
            payload.rootCause ? `root_cause: ${payload.rootCause}` : "",
            `rubric: ${
              payload.rubric.length > 0
                ? JSON.stringify(payload.rubric, null, 2)
                : "[]"
            }`,
            rootNext,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    );

    server.registerTool(
      "triage_inbox",
      {
        description:
          "受信箱の候補を仕分けする。action=accept で学び/誤解として登録、skip で無視。",
        inputSchema: {
          captureId: z.string().describe("Capture ID"),
          action: z.enum(["accept", "skip"]).describe("accept=登録 / skip=無視"),
        },
      },
      async ({ captureId, action }) => {
        await requireAuth();
        const result = await triageCapture(captureId, action);
        return result.ok
          ? text(result.message)
          : { ...text(result.message), isError: true };
      }
    );

    server.registerTool(
      "approve_goal_link",
      {
        description: "LLM 提案の GoalLink を承認する (confidence を manual に)。",
        inputSchema: {
          linkId: z.string().describe("GoalLink ID"),
        },
      },
      async ({ linkId }) => {
        await requireAuth();
        const id = linkId.trim();
        const link = await prisma.goalLink.findFirst({
          where: { id, confidence: "llm_suggested" },
        });
        if (!link) {
          return {
            ...text(`確認待ちの GoalLink が見つかりません (id: ${id})。`),
            isError: true,
          };
        }
        await prisma.goalLink.update({
          where: { id },
          data: { confidence: "manual" },
        });
        return text(`紐付けを承認しました (linkId: ${id}, goalId: ${link.goalId})。`);
      }
    );

    server.registerTool(
      "reject_goal_link",
      {
        description: "LLM 提案の GoalLink を却下する (削除)。",
        inputSchema: {
          linkId: z.string().describe("GoalLink ID"),
        },
      },
      async ({ linkId }) => {
        await requireAuth();
        const id = linkId.trim();
        const link = await prisma.goalLink.findFirst({
          where: { id, confidence: "llm_suggested" },
        });
        if (!link) {
          return {
            ...text(`確認待ちの GoalLink が見つかりません (id: ${id})。`),
            isError: true,
          };
        }
        await prisma.goalLink.delete({ where: { id } });
        return text(`紐付けを却下しました (linkId: ${id})。`);
      }
    );

    server.registerTool(
      "register_goals",
      {
        description:
          "Goal OS から読んだ目標を登録する。LLM が構造化した提案をユーザー承認後に呼ぶ。title 近似の既存 active Goal があれば警告を返す。",
        inputSchema: {
          goals: z
            .array(
              z.object({
                title: z.string().describe("目標タイトル"),
                period: z.string().describe("期間。例: 2026-H2"),
                kdi: z.string().optional().describe("KDI (任意)"),
                focusDomains: z
                  .array(z.string())
                  .optional()
                  .describe("注力ドメインの配列"),
              })
            )
            .describe("登録する目標の配列"),
        },
      },
      async ({ goals }) => {
        await requireAuth();
        if (!goals.length) {
          return { ...text("goals が空です。"), isError: true };
        }
        const active = await prisma.goal.findMany({
          where: { status: "active" },
          select: { id: true, title: true },
        });
        const created: string[] = [];
        const warnings: string[] = [];
        for (const g of goals) {
          const title = g.title.trim();
          const period = g.period.trim();
          if (!title || !period) {
            warnings.push(`スキップ: title/period が空 (${JSON.stringify(g)})`);
            continue;
          }
          const dup = active.find((a) => titlesSimilar(a.title, title));
          if (dup) {
            warnings.push(
              `警告: 「${title}」は既存 active Goal「${dup.title}」(id: ${dup.id}) と近似しています。登録は続行します。`
            );
          }
          const focusDomains =
            g.focusDomains && g.focusDomains.length > 0
              ? JSON.stringify(g.focusDomains.map((d) => d.trim()).filter(Boolean))
              : null;
          const row = await prisma.goal.create({
            data: {
              title,
              period,
              kdi: g.kdi?.trim() || null,
              focusDomains,
            },
          });
          created.push(`- ${row.title} (id: ${row.id}, period: ${row.period})`);
          active.push({ id: row.id, title: row.title });
        }
        const lines = [
          `# 目標登録: ${created.length} 件`,
          ...created,
          warnings.length ? "" : null,
          ...warnings,
        ].filter((x): x is string => x !== null);
        return text(lines.join("\n"));
      }
    );

    server.registerTool(
      "update_goal",
      {
        description: "既存 Goal のフィールドを更新する。",
        inputSchema: {
          goalId: z.string().describe("Goal ID"),
          title: z.string().optional(),
          period: z.string().optional(),
          kdi: z.string().optional().nullable().describe("null でクリア"),
          focusDomains: z
            .array(z.string())
            .optional()
            .nullable()
            .describe("配列で上書き。null でクリア"),
          status: z.enum(["active", "archived"]).optional(),
        },
      },
      async ({ goalId, title, period, kdi, focusDomains, status }) => {
        await requireAuth();
        const id = goalId.trim();
        const existing = await prisma.goal.findUnique({ where: { id } });
        if (!existing) {
          return { ...text(`Goal が見つかりません (id: ${id})。`), isError: true };
        }
        const data: {
          title?: string;
          period?: string;
          kdi?: string | null;
          focusDomains?: string | null;
          status?: string;
        } = {};
        if (title !== undefined) data.title = title.trim();
        if (period !== undefined) data.period = period.trim();
        if (kdi !== undefined) data.kdi = kdi?.trim() || null;
        if (focusDomains !== undefined) {
          data.focusDomains =
            focusDomains === null
              ? null
              : JSON.stringify(focusDomains.map((d) => d.trim()).filter(Boolean));
        }
        if (status !== undefined) data.status = status;
        if (Object.keys(data).length === 0) {
          return { ...text("更新フィールドがありません。"), isError: true };
        }
        const updated = await prisma.goal.update({ where: { id }, data });
        return text(
          `Goal を更新しました (id: ${updated.id}, title: ${updated.title}, status: ${updated.status})。`
        );
      }
    );

    server.registerTool(
      "save_task_mappings",
      {
        description: [
          "今日のタスクと関連する学び/誤解/ゲートのマッピングを保存する (ADR-0013)。",
          "朝セッションで find_related_learnings の結果をまとめて呼ぶ。同日は上書き。",
          'mappings 形式: [{task, related: [{type: "entry"|"misconception"|"gate", id, reason?}]}]',
        ].join(" "),
        inputSchema: {
          dateKey: z
            .string()
            .optional()
            .describe('日付キー "YYYY-MM-DD" (JST)。省略時は今日'),
          mappings: z
            .array(
              z.object({
                task: z.string().describe("タスク名"),
                related: z
                  .array(
                    z.object({
                      type: z.enum(["entry", "misconception", "gate"]),
                      id: z.string(),
                      reason: z.string().optional(),
                    })
                  )
                  .describe("関連する学び/誤解/ゲート"),
              })
            )
            .describe("タスクごとのマッピング配列"),
        },
      },
      async ({ dateKey, mappings }) => {
        await requireAuth();
        const result = await saveTaskMappings({ dateKey, mappings });
        if (result.savedCount > 0) {
          emitAtlasEvent({
            type: "task_mapping_saved",
            dateKey: result.dateKey,
            taskCount: result.savedCount,
          });
        }
        const lines = [
          `# タスクマッピングを保存しました`,
          `- dateKey: ${result.dateKey}`,
          `- タスク数: ${result.savedCount}`,
        ];
        if (result.warnings.length > 0) {
          lines.push("", "## 警告");
          for (const w of result.warnings) lines.push(`- ${w}`);
        }
        return text(lines.join("\n"));
      }
    );

    server.registerTool(
      "find_related_learnings",
      {
        description:
          "クエリ (タスク名・キーワード) に関連する Entry / open Misconception / pending Gate を返す。タスク起点ビュー用。",
        inputSchema: {
          query: z.string().describe("タスク名・キーワード"),
        },
      },
      async ({ query }) => {
        await requireAuth();
        const q = query.trim();
        if (!q) {
          return { ...text("query が空です。"), isError: true };
        }

        const [entries, misconceptions, gates] = await Promise.all([
          prisma.entry.findMany({
            orderBy: { createdAt: "desc" },
            take: 40,
            select: { id: true, title: true, domain: true },
          }),
          prisma.misconception.findMany({
            where: { status: { in: ["open", "regressed"] } },
            orderBy: { createdAt: "desc" },
            take: 40,
            select: { id: true, concept: true, status: true },
          }),
          prisma.gate.findMany({
            where: pendingGateWhere(),
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, question: true, targetConcept: true, kind: true },
          }),
        ]);

        type Hit = { kind: string; id: string; title: string };
        let hits: Hit[] = [];

        try {
          const prompt = [
            "以下の候補から、クエリに関連するものを最大8件選べ。",
            "コードや回答全文は渡していない。タイトルのみで判断すること。",
            'JSON のみ: {"related":[{"kind":"entry"|"misconception"|"gate","id":"..."}]}',
            "",
            `クエリ: ${q}`,
            "",
            "Entry:",
            ...entries.map((e) => `- id:${e.id} ${e.title}`),
            "",
            "Misconception (open):",
            ...misconceptions.map((m) => `- id:${m.id} ${m.concept}`),
            "",
            "Pending Gate:",
            ...gates.map((g) => `- id:${g.id} ${g.question}`),
          ].join("\n");

          const parsed = parseLLMJson<{
            related?: { kind?: string; id?: string }[];
          }>(await runHeadlessLLM(prompt));

          const byId = {
            entry: new Map(entries.map((e) => [e.id, e.title])),
            misconception: new Map(misconceptions.map((m) => [m.id, m.concept])),
            gate: new Map(gates.map((g) => [g.id, g.question])),
          } as const;

          for (const r of parsed?.related ?? []) {
            if (!r?.kind || !r?.id) continue;
            if (r.kind !== "entry" && r.kind !== "misconception" && r.kind !== "gate") {
              continue;
            }
            const title = byId[r.kind].get(r.id);
            if (!title) continue;
            hits.push({ kind: r.kind, id: r.id, title });
          }
        } catch (e) {
          console.error("[mcp] find_related_learnings LLM failed, fallback:", e);
        }

        if (hits.length === 0) {
          const qLower = q.toLowerCase();
          hits = [
            ...entries
              .filter((e) => e.title.toLowerCase().includes(qLower))
              .slice(0, 5)
              .map((e) => ({ kind: "entry", id: e.id, title: e.title })),
            ...misconceptions
              .filter((m) => m.concept.toLowerCase().includes(qLower))
              .slice(0, 5)
              .map((m) => ({
                kind: "misconception",
                id: m.id,
                title: m.concept,
              })),
            ...gates
              .filter(
                (g) =>
                  g.question.toLowerCase().includes(qLower) ||
                  (g.targetConcept?.toLowerCase().includes(qLower) ?? false)
              )
              .slice(0, 5)
              .map((g) => ({ kind: "gate", id: g.id, title: g.question })),
          ].slice(0, 8);
        }

        if (hits.length === 0) {
          return text(`「${q}」に関連する学び・誤解・ゲートは見つかりませんでした。`);
        }
        const lines = [
          `# 関連する学び (query: ${q})`,
          ...hits.map((h) => `- [${h.kind}] ${h.title} (id: ${h.id})`),
        ];
        return text(lines.join("\n"));
      }
    );

    server.registerTool(
      "enrich_gate_places",
      {
        description: [
          "domain が空の理解度ゲートに、repo名・問い文からばしょ（domain）をヒューリスティックで付ける。",
          "Living Atlas の『未特定（霧）』帯を減らすための保守ツール。dryRun=true なら更新せず件数だけ返す。",
        ].join(" "),
        inputSchema: {
          dryRun: z
            .boolean()
            .optional()
            .describe("true なら DB を更新せずプレビューのみ"),
          take: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe("処理する最大件数（既定 80）"),
        },
      },
      async ({ dryRun, take }) => {
        await requireAuth();
        const result = await enrichMissingGateDomains({
          dryRun: !!dryRun,
          take: take ?? 80,
        });
        return text(
          [
            `# enrich_gate_places${dryRun ? " (dry-run)" : ""}`,
            `scanned: ${result.scanned}`,
            `updated: ${result.updated}`,
            result.samples.length
              ? ["samples:", ...result.samples.map((s) => `- ${s}`)].join("\n")
              : "samples: (なし)",
          ].join("\n"),
        );
      },
    );

    server.registerTool(
      "suggest_cache_prefix_fix",
      {
        description: [
          "repo の cache read 再利用率から、安定プレフィックス向けの advisory 処方を返す（ADR-0017）。",
          "強制書き込みはしない。適用後は record_application で appliedTo に repo を含める。",
        ].join(" "),
        inputSchema: {
          repo: z
            .string()
            .describe("対象リポジトリ名（HarnessRun.repo と同じ識別子）"),
        },
      },
      async ({ repo }) => {
        await requireAuth();
        const trimmed = repo.trim();
        if (!trimmed) {
          return { ...text("repo が空です。"), isError: true };
        }
        const { suggestCachePrefixFix, formatPrescriptionMarkdown } =
          await import("@/lib/cache-prefix-prescription");
        try {
          const p = await suggestCachePrefixFix(trimmed);
          return text(formatPrescriptionMarkdown(p));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ...text(`処方の生成に失敗: ${msg}`), isError: true };
        }
      }
    );

    server.registerTool(
      "morning_briefing",
      {
        description: [
          "その日最初のセッションで呼ぶ朝の要約。出題中のしれん・未解消のつまずき・今日の一手の手がかりを返す。",
          "呼んだあと: 出題があれば list_pending_gates で詳細を見て、どれを解くか提案する。",
          "合否の断定や answer_gate はユーザーが提出を明示するまで行わない。",
        ].join(" "),
        inputSchema: {},
      },
      async () => {
        const today = dayStartJST();
        const now = new Date();

        // 疎通直後に pending が空にならないようサンプルを保証（B4-3）
        const { ensureTutorialSeed } = await import("@/lib/tutorial-seed");
        await ensureTutorialSeed().catch((e) =>
          console.error("[briefing] ensureTutorialSeed failed:", e),
        );

        // 出題予定を過ぎた誤解から retry / sr_review ゲートを生成する (ADR-0006 §6)
        await scheduleDueGates().catch((e) =>
          console.error("[briefing] scheduleDueGates failed:", e)
        );

        // ADR-0008: JST 月曜の briefing で週次評価を非同期起動
        // ADR-0009: 同タイミングでハーネスパターン検出 → Inbox
        // ADR-0014: 同タイミングで週次ナレーション原稿生成
        if (dayOfWeekJST() === 1) {
          after(() => {
            generateWeeklyReviews().catch((e) =>
              console.error("[briefing] generateWeeklyReviews failed:", e)
            );
          });
          after(() => {
            detectAndCaptureHarnessPatterns(now).catch((e) =>
              console.error("[briefing] harness patterns failed:", e)
            );
          });
          after(() => {
            generateWeeklyNarration(now).catch((e) =>
              console.error("[briefing] generateWeeklyNarration failed:", e)
            );
          });
        }

        // ADR-0010: 初回呼び出し時に前日分の Obsidian ダイジェストを非同期生成
        after(() => {
          generateYesterdayDigestIfNeeded(now).catch((e) =>
            console.error("[briefing] digest failed:", e)
          );
        });

        const yesterdayStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const [
          pending,
          experiments,
          pendingGates,
          openMisconceptions,
          activeGoals,
          yesterdayGraded,
        ] = await Promise.all([
          prisma.capture.findMany({
            where: { status: "pending" },
            // SQLite: DESC では NULL が末尾。未採点は後ろに回る
            orderBy: [{ importanceScore: "desc" }, { capturedAt: "desc" }],
            take: 10,
          }),
          prisma.experiment.findMany({
            where: { status: "active" },
            include: { entry: true, checkIns: { where: { date: today } } },
          }),
          prisma.gate.findMany({
            where: pendingGateWhere(now),
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
          prisma.misconception.count({
            where: { status: { in: ["open", "regressed"] } },
          }),
          prisma.goal.findMany({
            where: { status: "active" },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true },
          }),
          prisma.gate.findMany({
            where: {
              gradedAt: { gte: yesterdayStart, lt: today },
              status: {
                in: [
                  "passed",
                  "failed",
                  "self_graded_pass",
                  "self_graded_fail",
                  "grading_failed",
                ],
              },
            },
            select: { status: true, question: true, id: true },
            orderBy: { gradedAt: "desc" },
            take: 8,
          }),
        ]);

        const evidence = await Promise.all(
          activeGoals.map(async (g) => ({
            title: g.title,
            counts: await weeklyEvidenceCounts(g.id, now),
          }))
        );

        const lines: string[] = ["# おはようございます — Applied Loop", ""];

        // P2/P4: 冒頭は単一推奨。Textbook Mastery 導線があればしれんより先（C3-3）
        {
          let textbookGuide: Awaited<
            ReturnType<
              typeof import("@/lib/textbook-guidance").loadTextbookGuidanceForToday
            >
          > | null = null;
          try {
            const { loadTextbookGuidanceForToday } = await import(
              "@/lib/textbook-guidance"
            );
            textbookGuide = await loadTextbookGuidanceForToday(
              dateKeyJST(now),
            );
          } catch {
            textbookGuide = null;
          }

          const focus = pendingGates[0] ?? null;
          lines.push("## 今日の一手");
          if (textbookGuide?.guidance) {
            lines.push(`- ${textbookGuide.guidance.briefingLine}`);
            lines.push(
              `  → Web: http://localhost:3100${textbookGuide.guidance.href}`,
            );
          }
          if (textbookGuide?.yesterdayBriefingLine) {
            lines.push(`- ${textbookGuide.yesterdayBriefingLine}`);
          }
          if (focus && !textbookGuide?.guidance) {
            const q =
              focus.question.length > 120
                ? `${focus.question.slice(0, 117)}…`
                : focus.question;
            lines.push(`- 今日のしれん: ${q} (gateId: ${focus.id})`);
            lines.push(
              "  → list_pending_gates で詳細 → ユーザーが提出を明示したら answer_gate",
            );
          } else if (focus && textbookGuide?.guidance) {
            lines.push(
              `- （控え）しれん pending あり: gateId ${focus.id} — Mastery 導線のあと list_pending_gates`,
            );
          } else if (!textbookGuide?.guidance) {
            lines.push(
              "- 今日のしれん: なし（監視中 repo へのコミット or request_gate で供給せよ）",
            );
            lines.push(
              "- きょうのしょ: /retro で材料を教科書にし、確認→Mastery で翌日導線を決めよ",
            );
          }
          try {
            const {
              probeWatchedRepos,
              summarizeWatched,
              repoLabel,
            } = await import("@/lib/watched-repos");
            const watched = probeWatchedRepos();
            const ws = summarizeWatched(watched);
            if (ws.total === 0) {
              lines.push(
                "- 監視リポジトリ: なし（watch_repos で追加しないと commit 供給は増えない）",
              );
            } else {
              const names = watched
                .map(
                  (r) =>
                    `${repoLabel(r)}:${r.connected ? "監視中" : "未接続"}`,
                )
                .join(", ");
              lines.push(
                `- 監視リポジトリ: ${ws.connected}/${ws.total} 監視中（${names}）`,
              );
            }
          } catch {
            /* ignore */
          }
          const yClear = yesterdayGraded.filter((g) =>
            ["passed", "self_graded_pass"].includes(g.status),
          ).length;
          const yMiss = yesterdayGraded.filter((g) =>
            ["failed", "self_graded_fail"].includes(g.status),
          ).length;
          const yHold = yesterdayGraded.filter(
            (g) => g.status === "grading_failed",
          ).length;
          if (yesterdayGraded.length === 0) {
            lines.push("- 昨日の判定: なし");
          } else {
            lines.push(
              `- 昨日の判定: CLEAR ${yClear} / miss ${yMiss} / 保留 ${yHold}（計 ${yesterdayGraded.length}）`,
            );
            const sample = yesterdayGraded[0];
            if (sample) {
              const label = ["passed", "self_graded_pass"].includes(
                sample.status,
              )
                ? "CLEAR"
                : sample.status === "grading_failed"
                  ? "保留"
                  : "miss";
              const sq =
                sample.question.length > 80
                  ? `${sample.question.slice(0, 77)}…`
                  : sample.question;
              lines.push(`  例: [${label}] ${sq}`);
            }
          }
          if (openMisconceptions > 0) {
            lines.push(`- 未解消の誤解: ${openMisconceptions} 件（ずかんで確認）`);
          }
          lines.push("");
        }

        if (pendingGates.length > 0) {
          lines.push(`## 理解度ゲート: ${pendingGates.length} 件の出題中`);
          for (const g of pendingGates) {
            lines.push(`- ${g.question} (gateId: ${g.id})`);
          }
          if (openMisconceptions > 0) {
            lines.push(`(未解消の誤解: ${openMisconceptions} 件)`);
          }
          lines.push(
            "",
            "list_pending_gates で詳細を取得し、answer_gate でセッション内に回答してください。"
          );
          lines.push("");
        } else if (openMisconceptions > 0) {
          lines.push(`## 未解消の誤解: ${openMisconceptions} 件`);
          lines.push("");
        }

        if (pending.length > 0) {
          lines.push(`## 受信箱: ${pending.length} 件の未処理候補 (重要度順)`);
          for (const c of pending) {
            const label = importanceLabel(c.importanceScore);
            const scorePart =
              label != null && c.importanceScore != null
                ? `重要度:${label}(${c.importanceScore})`
                : "重要度:未採点";
            const reasonPart = c.triageReason
              ? ` 根拠: ${c.triageReason}`
              : "";
            lines.push(
              `- ${c.title} (captureId: ${c.id}, ${scorePart}, ${c.sourceTool}, ${c.capturedAt.toISOString().slice(0, 10)})${reasonPart}`
            );
          }
          lines.push(
            "",
            "仕分けは triage_inbox(captureId, accept|skip) でセッション内に行ってください。"
          );
        } else {
          lines.push("## 受信箱: 空です");
        }
        lines.push("");

        // ADR-0013 §1: タスク起点マッピングの誘導
        lines.push("## 今日のタスク起点ビュー");
        lines.push(
          `今日のタスク (Hermes/TODO) を find_related_learnings でマッピングし、save_task_mappings で保存してください (dateKey: ${dateKeyJST(now)})。`
        );
        lines.push("");

        if (evidence.length > 0) {
          lines.push("## 今週の目標証跡");
          for (const e of evidence) {
            const total =
              e.counts.entries +
              e.counts.applications +
              e.counts.resolvedMisconceptions;
            lines.push(
              `- ${e.title}: 学び ${e.counts.entries} / 実務使用 ${e.counts.applications} / つまずき解消 ${e.counts.resolvedMisconceptions} (計 ${total})`
            );
          }
          lines.push("");
        }

        // ADR-0014: メテオフォール (表示対象が無ければ節ごと省略 = active 0 で実質 no-op)
        {
          const weekAgo = new Date(now.getTime() - 7 * 86400000);
          const [understood, nextReqs] = await Promise.all([
            recentlyUnderstoodRequirements(weekAgo, 5),
            nextRequirementCandidates(3),
          ]);
          if (understood.length > 0 || nextReqs.length > 0) {
            lines.push("## 理解確認の進み");
            if (understood.length > 0) {
              lines.push("理解確認済みになった要件:");
              for (const r of understood) {
                lines.push(`- ${r.title}`);
              }
            }
            if (nextReqs.length > 0) {
              lines.push("次の要件候補:");
              for (const r of nextReqs) {
                const progress =
                  r.totalApprovedGates === 0
                    ? "ゲート未紐付け"
                    : `ゲート ${r.passedCount}/${r.totalApprovedGates} 合格`;
                lines.push(`- ${r.title} (${progress})`);
              }
            }
            lines.push("");
          }
        }

        for (const exp of experiments) {
          const checked = exp.checkIns.length > 0 ? "チェックイン済み" : "未チェックイン";
          lines.push(`## 実験: ${exp.action} (${exp.entry.title}) — 今日は${checked}`);
        }
        return text(lines.join("\n"));
      }
    );

    server.registerTool(
      "register_requirement",
      {
        description:
          "理解確認の単位としての要件を登録する (ADR-0014)。タスク管理ではない。title 必須、why / criteria は任意。",
        inputSchema: {
          title: z.string().describe("要件のタイトル"),
          why: z.string().optional().describe("目的・背景"),
          criteria: z.string().optional().describe("受入条件 (自由記述)"),
        },
      },
      async ({ title, why, criteria }) => {
        await requireAuth();
        const trimmed = title.trim();
        if (!trimmed) {
          return { ...text("title が空です。"), isError: true };
        }
        const req = await prisma.requirement.create({
          data: {
            title: trimmed,
            why: why?.trim() || null,
            criteria: criteria?.trim() || null,
          },
        });
        return text(
          `要件を登録しました (id: ${req.id})。「${req.title}」。ゲート合格で理解確認済みになります。`
        );
      }
    );

    server.registerTool(
      "list_requirements",
      {
        description:
          "active な要件と、紐づく承認済みゲートの合格状況を返す。未承認の提案リンクは集計に含めない。",
        inputSchema: {},
      },
      async () => {
        await requireAuth();
        const summaries = await listRequirementSummaries(["active"]);
        if (summaries.length === 0) {
          return text(
            "active な要件はありません。register_requirement で登録できます。"
          );
        }
        const lines: string[] = ["# 要件一覧 (active)", ""];
        for (const r of summaries) {
          lines.push(`## ${r.title} (id: ${r.id})`);
          if (r.why) lines.push(`目的: ${r.why}`);
          if (r.criteria) lines.push(`受入条件: ${r.criteria}`);
          if (r.totalApprovedGates === 0) {
            lines.push("ゲート: 承認済みの紐付けなし");
          } else {
            lines.push(
              `ゲート進捗: ${r.passedCount}/${r.totalApprovedGates} 合格`
            );
            for (const g of r.approvedGates) {
              lines.push(
                `- [${g.passed ? "pass" : g.gateStatus}] ${g.question} (gateId: ${g.gateId})`
              );
            }
          }
          if (r.suggestedGateCount > 0) {
            lines.push(
              `(確認待ちの紐付け提案: ${r.suggestedGateCount} 件 — approve_requirement_link / /requirements)`
            );
          }
          lines.push("");
        }
        return text(lines.join("\n"));
      }
    );

    server.registerTool(
      "link_requirement",
      {
        description:
          "要件とゲート/学びを手動で紐付ける (承認済みとして作成)。",
        inputSchema: {
          requirementId: z.string().describe("要件 ID"),
          targetType: z.enum(["gate", "entry"]).describe("紐付け先の種別"),
          targetId: z.string().describe("ゲートまたは学びの ID"),
        },
      },
      async ({ requirementId, targetType, targetId }) => {
        await requireAuth();
        const result = await linkRequirementManual({
          requirementId: requirementId.trim(),
          targetType,
          targetId: targetId.trim(),
        });
        return result.ok
          ? text(result.message)
          : { ...text(result.message), isError: true };
      }
    );

    server.registerTool(
      "approve_requirement_link",
      {
        description:
          "要件↔ゲートの suggested 紐付けを承認する（メテオフォール。アプリUIと同等）。",
        inputSchema: {
          linkId: z.string().describe("RequirementLink ID"),
        },
      },
      async ({ linkId }) => {
        await requireAuth();
        const { approveRequirementLink } = await import("@/lib/requirement");
        const result = await approveRequirementLink(linkId.trim());
        return result.ok
          ? text(result.message)
          : { ...text(result.message), isError: true };
      },
    );

    server.registerTool(
      "reject_requirement_link",
      {
        description: "要件↔ゲートの suggested 紐付けを却下する。",
        inputSchema: {
          linkId: z.string().describe("RequirementLink ID"),
        },
      },
      async ({ linkId }) => {
        await requireAuth();
        const { rejectRequirementLink } = await import("@/lib/requirement");
        const result = await rejectRequirementLink(linkId.trim());
        return result.ok
          ? text(result.message)
          : { ...text(result.message), isError: true };
      },
    );

    server.registerTool(
      "watch_repos",
      {
        description: [
          "しれん供給の対象リポジトリ（git hook）を一覧・追加・外す。",
          "GitHub の PR 作成だけでは溜まらない。ローカル commit を拾う repo を明示登録する。",
          "ユーザーが「このリポジトリを監視して」「監視一覧」と明示したとき、またはじゅんび相当の設定を会話で行うときに呼ぶ。",
          "action=list（既定）: 監視中/未接続を返す。",
          "action=add: path を登録し、既定で鉤（post-commit）をかける。",
          "action=remove: 監視リストから外し鉤も外す。",
        ].join(" "),
        inputSchema: {
          action: z
            .enum(["list", "add", "remove"])
            .optional()
            .describe("list（省略時）/ add / remove"),
          path: z
            .string()
            .optional()
            .describe(
              "git リポジトリの絶対パスまたは ~/… 。add/remove で必須。例: ~/Desktop/triplethree/triple-onboarding",
            ),
          installHook: z
            .boolean()
            .optional()
            .describe("add 時に鉤をかけるか（既定 true）"),
        },
      },
      async ({ action, path, installHook }) => {
        await requireAuth();
        const act = action ?? "list";
        const {
          addWatchedRepo,
          disconnectRepoHook,
          installHooksForRepos,
          probeWatchedRepos,
          removeWatchedRepo,
          repoLabel,
          summarizeWatched,
        } = await import("@/lib/watched-repos");

        if (act === "list") {
          const rows = probeWatchedRepos();
          const s = summarizeWatched(rows);
          if (rows.length === 0) {
            return text(
              [
                "監視リポジトリ: まだ無い。",
                "仕事 repo を watch_repos action=add path=… で登録せよ。",
                "未登録のままではコミットからしれんは増えない（request_gate は別経路）。",
              ].join("\n"),
            );
          }
          const lines = [
            `# 監視リポジトリ 登録 ${s.total} / 監視中 ${s.connected}`,
            "",
            ...rows.map((r) => {
              const st = !r.isGit
                ? "gitではない"
                : r.connected
                  ? "監視中"
                  : "未接続";
              return `- [${st}] ${repoLabel(r)} — ${r.path}`;
            }),
            "",
            "未接続なら watch_repos action=add path=…（installHook true）で鉤をかけよ。",
          ];
          return text(lines.join("\n"));
        }

        const rawPath = path?.trim() ?? "";
        if (!rawPath) {
          return {
            ...text("path が必要です（例: ~/Desktop/triplethree/triple-onboarding）。"),
            isError: true,
          };
        }

        if (act === "remove") {
          disconnectRepoHook(rawPath);
          const res = removeWatchedRepo(rawPath);
          if (!res.ok) {
            return { ...text(res.error), isError: true };
          }
          return text(
            res.removed
              ? `監視から外した: ${rawPath}`
              : `リストに無かった（鉤だけ外していれば完了）: ${rawPath}`,
          );
        }

        // add
        const added = addWatchedRepo({ path: rawPath });
        if (!added.ok) {
          return { ...text(added.error), isError: true };
        }
        const doInstall = installHook !== false;
        if (doInstall) {
          const inst = installHooksForRepos([added.repo.path]);
          if (!inst.ok) {
            return {
              ...text(
                `リストには入れたが鉤に失敗: ${inst.error ?? inst.output}\npath=${added.repo.path}`,
              ),
              isError: true,
            };
          }
          try {
            const { recordActivationOnce } = await import(
              "@/lib/activation-funnel"
            );
            recordActivationOnce("hook_installed", { source: "mcp_watch_repos" });
          } catch {
            /* ignore */
          }
          const rows = probeWatchedRepos();
          const row = rows.find((r) => r.path === added.repo.path);
          return text(
            [
              `監視開始: ${repoLabel(added.repo)}`,
              `path: ${added.repo.path}`,
              `状態: ${row?.connected ? "監視中（鉤OK）" : "未接続（鉤を確認せよ）"}`,
              "この repo へのローカル commit がしれん供給になる。PR 作成だけでは溜まらない。",
            ].join("\n"),
          );
        }
        return text(
          `リストに追加した（鉤は未実行）: ${added.repo.path}\n鉤をかけるなら installHook=true で再実行。`,
        );
      },
    );
  },
  { serverInfo: { name: "applied-loop", version: "0.2.0" } }
);

async function withAuth(request: Request): Promise<Response> {
  const { getMcpEndpointInfo, isLocalRequestHost } = await import(
    "@/lib/mcp-endpoint"
  );
  const info = getMcpEndpointInfo();
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host");
  const remoteClient = !isLocalRequestHost(host);
  // Reachable MCP / 非ローカル Host ではトークン必須（localhost のみ従来どおり緩め）
  const tokenRequired = info.reachable || remoteClient;
  const token = process.env.MCP_TOKEN?.trim();

  if (tokenRequired && !token) {
    return new Response(
      "Unauthorized: MCP_TOKEN required for non-local / reachable MCP",
      { status: 401 },
    );
  }
  if (token) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  // チュートリアル診断用: 認証成功した MCP 疎通を記録
  try {
    const { touchMcpActivity } = await import("@/lib/tutorial-state");
    touchMcpActivity();
  } catch {
    /* ignore */
  }
  return handler(request);
}

export { withAuth as GET, withAuth as POST, withAuth as DELETE };
