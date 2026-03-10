import { extractRuntimeReplanSignals } from "./orchestrate-runtime-contract.js";
import {
  handleReceptionistBriefing,
  handleReceptionistStart,
} from "./orchestrate-receptionist-command.js";
import {
  readPlannerAmendmentWatermarkV2Store,
  readReceptionistAmendmentQueueStore,
} from "./orchestrate-receptionist-state.js";
import {
  appendSessionHistory,
  buildEmptyOrchestrateSession,
  buildSummaryFromDraft,
  renderSessionSummary,
  resolveConversationSessionKey,
  type OrchestrateSessionState,
  type ParsedOrchestrateArgs,
} from "./orchestrate-session.js";
import type { OrchestrateStateIo, OrchestrateStatePaths } from "./orchestrate-state.js";
import { writeSummarySnapshotStore } from "./orchestrate-state.js";
import path from "node:path";

type SessionCommandContext = {
  channel?: string;
  senderId?: string;
  messageThreadId?: string | number;
  sessionKey?: string;
  commandTargetSessionKey?: string;
};

type SessionCommandSubcommand = Extract<ParsedOrchestrateArgs["subcommand"], "start" | "session" | "stop" | "summary">;

function extractReplanBriefingFields(meta: Record<string, unknown> | null): {
  status: string;
  impact: string;
  workerPolicy: string;
  executionStatus: string;
} | null {
  const replan = extractRuntimeReplanSignals(meta);
  if (!replan.status && !replan.impact && !replan.worker_policy && !replan.execution_status) {
    return null;
  }
  return {
    status: replan.status ?? "(none)",
    impact: replan.impact ?? "(none)",
    workerPolicy: replan.worker_policy ?? "(none)",
    executionStatus: replan.execution_status ?? "(none)",
  };
}

export async function handleSessionSubcommand(params: {
  subcommand: SessionCommandSubcommand;
  ctx: SessionCommandContext;
  repoRoot: string;
  taskFoldersRoot: string;
  paths: OrchestrateStatePaths;
  io: OrchestrateStateIo;
  readOrchestrateSession: (sessionKey: string) => Promise<OrchestrateSessionState | null>;
  writeOrchestrateSession: (next: OrchestrateSessionState) => Promise<void>;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "planner_apply_amendment_batch";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<string> {
  const sessionKey = resolveConversationSessionKey(params.ctx);
  const missingKeyPrefix = `orchestrate ${params.subcommand} failed`;
  if (!sessionKey) {
    return `${missingKeyPrefix}: missing session key`;
  }

  if (params.subcommand === "start") {
    const existing = await params.readOrchestrateSession(sessionKey);
    if (existing && existing.status !== "CLOSED") {
      return [
        "orchestrate session already active",
        renderSessionSummary(existing),
        "",
        "continue by sending normal messages, then use /orchestrate summary",
      ].join("\n");
    }
    const created = buildEmptyOrchestrateSession({
      sessionKey,
      channel: params.ctx.channel ?? "unknown",
      senderId: params.ctx.senderId ?? "unknown",
    });
    await params.writeOrchestrateSession(created);
    await params.emitEvent("orchestrate.session.started", {
      session_key: sessionKey,
      channel: params.ctx.channel ?? "unknown",
      sender_id: params.ctx.senderId ?? "unknown",
    });
    return handleReceptionistStart(created);
  }

  const session = await params.readOrchestrateSession(sessionKey);
  if (!session || (params.subcommand === "session" && session.status === "CLOSED")) {
    return params.subcommand === "session"
      ? "no active orchestrate session\n\nuse /orchestrate start"
      : params.subcommand === "stop"
        ? "no active orchestrate session"
        : "no active orchestrate session\n\nuse /orchestrate start";
  }

  if (params.subcommand === "session") {
    return renderSessionSummary(session);
  }

  if (params.subcommand === "stop") {
    const next: OrchestrateSessionState = {
      ...session,
      status: "CLOSED",
      updated_at: new Date().toISOString(),
      receptionist: {
        ...session.receptionist,
        active: false,
        amendment_queue_open: false,
      },
    };
    await params.writeOrchestrateSession(next);
    await params.emitEvent("orchestrate.session.closed", {
      session_key: sessionKey,
      reason: "user_stop",
    });
    return "orchestrate session closed";
  }

  if (
    params.subcommand === "summary" &&
    session.status === "RUNNING" &&
    session.receptionist.action_route !== "intake_new_task"
  ) {
    const now = new Date().toISOString();
    const taskMetaPath = session.last_run ? path.join(params.taskFoldersRoot, session.last_run.task_id, "meta.json") : "";
    const queue = session.last_run
      ? await readReceptionistAmendmentQueueStore({
          io: params.io,
          paths: params.paths,
          sessionKey,
          taskId: session.last_run.task_id,
        })
      : null;
    const taskMeta =
      taskMetaPath && (await params.io.fileExists(taskMetaPath))
        ? await params.io.readJsonOrDefault<Record<string, unknown>>(taskMetaPath, {})
        : null;
    const amendmentWatermark = session.last_run
      ? await readPlannerAmendmentWatermarkV2Store({
          io: params.io,
          paths: params.paths,
          sessionKey,
          taskId: session.last_run.task_id,
        })
      : null;
    const nextSession: OrchestrateSessionState = {
      ...session,
      updated_at: now,
      receptionist: {
        ...session.receptionist,
        last_briefing_at: now,
        amendment_queue_open: Boolean(queue && queue.items.length > 0),
      },
    };
    await params.writeOrchestrateSession(nextSession);
    return handleReceptionistBriefing({
      session: nextSession,
      queue,
      amendmentWatermark,
      replan: extractReplanBriefingFields(taskMeta),
    });
  }

  if (!session.draft.task_goal.trim()) {
    return [
      "cannot create summary: task goal is empty",
      "",
      "send normal messages to describe the task first",
    ].join("\n");
  }

  const previous = session.latest_summary;
  const summary = buildSummaryFromDraft(session);
  if (previous) {
    await writeSummarySnapshotStore({
      io: params.io,
      paths: params.paths,
      sessionKey,
      summary: {
        ...previous,
        status: "superseded",
      },
    });
  }
  const next: OrchestrateSessionState = appendSessionHistory(
    {
      ...session,
      status: "SUMMARY_READY",
      updated_at: new Date().toISOString(),
      receptionist: {
        ...session.receptionist,
        last_briefing_at: new Date().toISOString(),
      },
      latest_summary: summary,
    },
    {
      timestamp: summary.created_at,
      role: "entry_agent",
      kind: "summary",
      content: summary.summary_id,
    },
  );
  const summaryPath = await writeSummarySnapshotStore({
    io: params.io,
    paths: params.paths,
    sessionKey,
    summary,
  });
  await params.writeOrchestrateSession(next);
  await params.emitEvent("orchestrate.session.summary_created", {
    session_key: sessionKey,
    summary_id: summary.summary_id,
    summary_path: summaryPath,
    version: summary.version,
  });
  return [
    handleReceptionistBriefing({ session: next }),
    "",
    `summary_id: ${summary.summary_id}`,
    `summary_version: ${String(summary.version)}`,
    `task_goal: ${summary.content.task_goal}`,
    `project_id: ${summary.content.project_id || "(default)"}`,
    `workspace_root: ${summary.content.workspace_root || "(default)"}`,
    `risk_level: ${summary.content.risk_level}`,
    `budget: ${summary.content.budget.max_token_cost},${summary.content.budget.max_execution_time_seconds}`,
    "planner_ingress: auto-only",
    "initial_split_decision: planner-managed",
    `deliverables: ${summary.content.deliverables.join(", ") || "(none)"}`,
    `constraints: ${summary.content.constraints.join(", ") || "(none)"}`,
    `summary_path: ${summaryPath}`,
    "",
    "if you want changes, keep chatting and run /orchestrate summary again",
    "when ready, run /orchestrate run",
  ].join("\n");
}
