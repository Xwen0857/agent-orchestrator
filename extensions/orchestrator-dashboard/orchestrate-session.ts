import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { EntryActionRoute } from "./orchestrate-entry-action-contract.js";

export type OrchestrateSubcommand =
  | "run"
  | "status"
  | "help"
  | "intake"
  | "amend"
  | "kb-sync"
  | "path"
  | "start"
  | "summary"
  | "stop"
  | "session";

export type ParsedOrchestrateArgs = {
  subcommand: OrchestrateSubcommand;
  payload: string;
};

export type OrchestrateConversationStatus =
  | "ACTIVE_DRAFTING"
  | "SUMMARY_READY"
  | "RUNNING"
  | "CLOSED";

export type OrchestrateReceptionistState = {
  active: boolean;
  mode: "guided_intake";
  last_briefing_at: string;
  pending_questions: string[];
  amendment_queue_open: boolean;
  action_route: EntryActionRoute;
  action_target_task_id: string | null;
  clarification_required: boolean;
  last_action_at: string;
};

export type OrchestrateSummary = {
  summary_id: string;
  created_at: string;
  version: number;
  status: "drafted" | "confirmed" | "superseded" | "consumed";
  content: {
    task_goal: string;
    project_id: string;
    workspace_root: string;
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    budget: {
      max_token_cost: number;
      max_execution_time_seconds: number;
    };
    requested_mode: "auto" | "single" | "multi";
    constraints: string[];
    deliverables: string[];
    notes: string[];
  };
};

export type OrchestrateSessionState = {
  schema_version: "orchestrate-session-v1";
  session_key: string;
  channel: string;
  sender_id: string;
  status: OrchestrateConversationStatus;
  started_at: string;
  updated_at: string;
  entry_agent: {
    active: boolean;
    mode: "conversation_capture";
  };
  receptionist: OrchestrateReceptionistState;
  draft: {
    goal_raw: string;
    task_goal: string;
    project_id: string;
    workspace_root: string;
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    budget: {
      max_token_cost: number;
      max_execution_time_seconds: number;
    };
    requested_mode: "auto" | "single" | "multi";
    constraints: string[];
    deliverables: string[];
    notes: string[];
    open_questions: string[];
  };
  history: Array<{
    timestamp: string;
    role: "user" | "entry_agent";
    kind: "message" | "summary";
    content: string;
  }>;
  latest_summary?: OrchestrateSummary;
  last_run?: {
    task_id: string;
    started_at: string;
    summary_id: string;
  };
};

type BuildSessionOptions = {
  now?: string;
};

type ApplyMessageOptions = {
  now?: string;
};

type BuildSummaryOptions = {
  now?: string;
  createSummaryId?: () => string;
};

type NormalizeSessionOptions = {
  fallbackSession: OrchestrateSessionState;
  now?: string;
};

const ORCHESTRATE_SUBCOMMANDS: ReadonlySet<OrchestrateSubcommand> = new Set([
  "run",
  "status",
  "help",
  "intake",
  "amend",
  "kb-sync",
  "path",
  "start",
  "summary",
  "stop",
  "session",
]);

function normalizePositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeRiskLevel(value: unknown, fallback: "LOW" | "MEDIUM" | "HIGH"): "LOW" | "MEDIUM" | "HIGH" {
  const normalized = normalizeString(value, fallback);
  if (normalized === "LOW" || normalized === "HIGH") {
    return normalized;
  }
  return "MEDIUM";
}

function normalizeRequestedMode(value: unknown): "auto" | "single" | "multi" {
  const normalized = normalizeString(value, "auto");
  if (normalized === "single" || normalized === "multi") {
    return normalized;
  }
  return "auto";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeString(item, "")).filter(Boolean);
}

function normalizeBudget(
  value: unknown,
  fallback: { max_token_cost: number; max_execution_time_seconds: number },
): { max_token_cost: number; max_execution_time_seconds: number } {
  const record = asRecord(value);
  return {
    max_token_cost: normalizePositiveInt(
      String(record?.max_token_cost ?? fallback.max_token_cost),
      fallback.max_token_cost,
    ),
    max_execution_time_seconds: normalizePositiveInt(
      String(record?.max_execution_time_seconds ?? fallback.max_execution_time_seconds),
      fallback.max_execution_time_seconds,
    ),
  };
}

function mergeUnique(base: string[], incoming: string[]): string[] {
  return [...new Set([...base, ...incoming].filter(Boolean))];
}

function buildDefaultReceptionistState(now: string): OrchestrateReceptionistState {
  return {
    active: true,
    mode: "guided_intake",
    last_briefing_at: now,
    pending_questions: [],
    amendment_queue_open: false,
    action_route: "intake_new_task",
    action_target_task_id: null,
    clarification_required: false,
    last_action_at: now,
  };
}

export function appendSessionHistory(
  session: OrchestrateSessionState,
  entry: OrchestrateSessionState["history"][number],
): OrchestrateSessionState {
  const history = [...session.history];
  const last = history[history.length - 1];
  if (!last || last.role !== entry.role || last.kind !== entry.kind || last.content !== entry.content) {
    history.push(entry);
  }
  return { ...session, history };
}

function createSummaryId(): string {
  return `sum_${Date.now().toString(36)}_${randomUUID().replace(/-/gu, "").slice(0, 6)}`;
}

export function parseOrchestrateArgs(argsRaw: string | undefined): ParsedOrchestrateArgs {
  const normalized = (argsRaw ?? "").trim();
  if (!normalized) {
    return { subcommand: "help", payload: "" };
  }
  const [first, ...rest] = normalized.split(/\s+/);
  const sub = (first ?? "").toLowerCase();
  if (ORCHESTRATE_SUBCOMMANDS.has(sub as OrchestrateSubcommand)) {
    return {
      subcommand: sub as OrchestrateSubcommand,
      payload: rest.join(" ").trim(),
    };
  }
  return { subcommand: "help", payload: "" };
}

export function resolveConversationSessionKey(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }
  const record = input as Record<string, unknown>;
  const commandTargetSessionKey =
    typeof record.commandTargetSessionKey === "string" ? record.commandTargetSessionKey : "";
  const sessionKey = typeof record.sessionKey === "string" ? record.sessionKey : "";
  return (commandTargetSessionKey || sessionKey).trim();
}

export function buildSessionFileStem(sessionKey: string): string {
  const safe = sessionKey
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  const digest = createHash("sha256").update(sessionKey).digest("hex").slice(0, 12);
  return `${safe || "session"}_${digest}`;
}

export function buildSessionFilePath(sessionsDir: string, sessionKey: string): string {
  return path.join(sessionsDir, `${buildSessionFileStem(sessionKey)}.json`);
}

export function buildSummaryFilePath(
  requestsDir: string,
  sessionKey: string,
  summaryId: string,
): string {
  return path.join(requestsDir, `${buildSessionFileStem(sessionKey)}.${summaryId}.summary.json`);
}

export function buildEmptyOrchestrateSession(
  params: {
    sessionKey: string;
    channel: string;
    senderId: string;
  },
  options: BuildSessionOptions = {},
): OrchestrateSessionState {
  const now = options.now ?? new Date().toISOString();
  return {
    schema_version: "orchestrate-session-v1",
    session_key: params.sessionKey,
    channel: params.channel,
    sender_id: params.senderId,
    status: "ACTIVE_DRAFTING",
    started_at: now,
    updated_at: now,
    entry_agent: {
      active: true,
      mode: "conversation_capture",
    },
    receptionist: buildDefaultReceptionistState(now),
    draft: {
      goal_raw: "",
      task_goal: "",
      project_id: "",
      workspace_root: "",
      risk_level: "MEDIUM",
      budget: {
        max_token_cost: 50000,
        max_execution_time_seconds: 3600,
      },
      requested_mode: "auto",
      constraints: [],
      deliverables: [],
      notes: [],
      open_questions: [],
    },
    history: [],
  };
}

export function renderSessionSummary(session: OrchestrateSessionState): string {
  const latestSummary = session.latest_summary;
  return [
    `session_key: ${session.session_key}`,
    `status: ${session.status}`,
    `task_goal: ${session.draft.task_goal || "(none)"}`,
    `project_id: ${session.draft.project_id || "(default)"}`,
    `workspace_root: ${session.draft.workspace_root || "(default)"}`,
    `risk_level: ${session.draft.risk_level}`,
    `budget: ${session.draft.budget.max_token_cost},${session.draft.budget.max_execution_time_seconds}`,
    `requested_mode: ${session.draft.requested_mode}`,
    `deliverables: ${session.draft.deliverables.join(", ") || "(none)"}`,
    `constraints: ${session.draft.constraints.join(", ") || "(none)"}`,
    latestSummary ? `latest_summary_id: ${latestSummary.summary_id}` : "latest_summary_id: (none)",
    latestSummary
      ? `latest_summary_version: ${String(latestSummary.version)}`
      : "latest_summary_version: (none)",
  ].join("\n");
}

export function applyMessageToDraft(
  session: OrchestrateSessionState,
  content: string,
  options: ApplyMessageOptions = {},
): OrchestrateSessionState {
  const text = content.trim();
  if (!text) {
    return session;
  }
  const last = session.history[session.history.length - 1];
  if (last && last.role === "user" && last.kind === "message" && last.content === text) {
    return session;
  }

  const next = structuredClone(session) as OrchestrateSessionState;
  const now = options.now ?? new Date().toISOString();
  next.updated_at = now;
  next.status = next.latest_summary ? "SUMMARY_READY" : "ACTIVE_DRAFTING";
  next.draft.goal_raw = next.draft.goal_raw ? `${next.draft.goal_raw}\n${text}` : text;
  next.draft.task_goal = next.draft.task_goal ? `${next.draft.task_goal}\n${text}` : text;

  const lower = text.toLowerCase();
  if (/\b(high|critical)\b/u.test(lower) || /高风险/u.test(text)) {
    next.draft.risk_level = "HIGH";
  } else if (/\b(low)\b/u.test(lower) || /低风险/u.test(text)) {
    next.draft.risk_level = "LOW";
  } else if (/\b(medium)\b/u.test(lower) || /中风险/u.test(text)) {
    next.draft.risk_level = "MEDIUM";
  }

  if (/(强制单任务|不要拆分|single mode|single task)/u.test(text)) {
    next.draft.requested_mode = "single";
  } else if (/(强制\s*multi|强制多任务|并行|拆分|多个模块|multi mode|multi task)/u.test(text)) {
    next.draft.requested_mode = "multi";
  } else if (/(自动模式|auto mode)/u.test(text)) {
    next.draft.requested_mode = "auto";
  }

  const projectMatch = text.match(/project[_\s-]*id\s*[:=]\s*([A-Za-z0-9._-]+)/iu);
  if (projectMatch?.[1]) {
    next.draft.project_id = projectMatch[1];
  }
  const workspaceMatch = text.match(/workspace[_\s-]*root\s*[:=]\s*([A-Za-z0-9._/\-]+)/iu);
  if (workspaceMatch?.[1]) {
    next.draft.workspace_root = workspaceMatch[1];
  }
  const budgetMatch = text.match(/budget\s*[:=]\s*([0-9]+)\s*,\s*([0-9]+)/iu);
  if (budgetMatch?.[1] && budgetMatch[2]) {
    next.draft.budget.max_token_cost = normalizePositiveInt(
      budgetMatch[1],
      next.draft.budget.max_token_cost,
    );
    next.draft.budget.max_execution_time_seconds = normalizePositiveInt(
      budgetMatch[2],
      next.draft.budget.max_execution_time_seconds,
    );
  }

  const deliverables: string[] = [];
  if (/runbook|文档/iu.test(text)) {
    deliverables.push("RUNBOOK.md");
  }
  if (/test|测试/iu.test(text)) {
    deliverables.push("tests");
  }
  if (/websocket|python|服务端|脚本/iu.test(text)) {
    deliverables.push("source");
  }
  next.draft.deliverables = mergeUnique(next.draft.deliverables, deliverables);
  next.draft.notes = mergeUnique(next.draft.notes, [text]);
  next.draft.open_questions = next.draft.task_goal ? [] : ["Please describe the task goal."];

  return appendSessionHistory(next, {
    timestamp: now,
    role: "user",
    kind: "message",
    content: text,
  });
}

export function buildSummaryFromDraft(
  session: OrchestrateSessionState,
  options: BuildSummaryOptions = {},
): OrchestrateSummary {
  const now = options.now ?? new Date().toISOString();
  const buildId = options.createSummaryId ?? createSummaryId;
  return {
    summary_id: buildId(),
    created_at: now,
    version: (session.latest_summary?.version ?? 0) + 1,
    status: "drafted",
    content: {
      task_goal: session.draft.task_goal.trim(),
      project_id: session.draft.project_id.trim(),
      workspace_root: session.draft.workspace_root.trim(),
      risk_level: session.draft.risk_level,
      budget: {
        max_token_cost: session.draft.budget.max_token_cost,
        max_execution_time_seconds: session.draft.budget.max_execution_time_seconds,
      },
      requested_mode: session.draft.requested_mode,
      constraints: [...session.draft.constraints],
      deliverables: [...session.draft.deliverables],
      notes: [...session.draft.notes],
    },
  };
}

export function normalizeOrchestrateSummary(
  raw: unknown,
  options: { now?: string } = {},
): OrchestrateSummary | undefined {
  const summaryRaw = asRecord(raw);
  if (!summaryRaw) {
    return undefined;
  }
  const contentRaw = asRecord(summaryRaw.content) ?? {};
  const now = options.now ?? new Date().toISOString();
  return {
    summary_id: normalizeString(summaryRaw.summary_id, ""),
    created_at: normalizeString(summaryRaw.created_at, now),
    version: normalizePositiveInt(String(summaryRaw.version ?? 1), 1),
    status: (() => {
      const status = normalizeString(summaryRaw.status, "drafted");
      if (
        status === "drafted" ||
        status === "confirmed" ||
        status === "superseded" ||
        status === "consumed"
      ) {
        return status;
      }
      return "drafted";
    })(),
    content: {
      task_goal: normalizeString(contentRaw.task_goal, ""),
      project_id: normalizeString(contentRaw.project_id, ""),
      workspace_root: normalizeString(contentRaw.workspace_root, ""),
      risk_level: normalizeRiskLevel(contentRaw.risk_level, "MEDIUM"),
      budget: normalizeBudget(contentRaw.budget, {
        max_token_cost: 50000,
        max_execution_time_seconds: 3600,
      }),
      requested_mode: normalizeRequestedMode(contentRaw.requested_mode),
      constraints: normalizeStringList(contentRaw.constraints),
      deliverables: normalizeStringList(contentRaw.deliverables),
      notes: normalizeStringList(contentRaw.notes),
    },
  };
}

export function normalizeOrchestrateSession(
  raw: unknown,
  options: NormalizeSessionOptions,
): OrchestrateSessionState {
  const record = asRecord(raw) ?? {};
  const fallback = options.fallbackSession;
  const now = options.now ?? new Date().toISOString();
  const draftRaw = asRecord(record.draft) ?? {};
  const lastRunRaw = asRecord(record.last_run) ?? {};
  const receptionistRaw = asRecord(record.receptionist) ?? {};
  const status = normalizeString(record.status, "ACTIVE_DRAFTING");
  const historyRaw = Array.isArray(record.history) ? record.history : [];

  const history: OrchestrateSessionState["history"] = historyRaw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        timestamp: normalizeString(item.timestamp, now),
        role: normalizeString(item.role, "user") === "entry_agent" ? "entry_agent" : "user",
        kind: normalizeString(item.kind, "message") === "summary" ? "summary" : "message",
        content: normalizeString(item.content, ""),
      };
    });

  return {
    schema_version: "orchestrate-session-v1",
    session_key: normalizeString(record.session_key, fallback.session_key),
    channel: normalizeString(record.channel, fallback.channel),
    sender_id: normalizeString(record.sender_id, fallback.sender_id),
    status:
      status === "SUMMARY_READY" || status === "RUNNING" || status === "CLOSED"
        ? status
        : "ACTIVE_DRAFTING",
    started_at: normalizeString(record.started_at, fallback.started_at || now),
    updated_at: normalizeString(record.updated_at, fallback.updated_at || now),
    entry_agent: {
      active: true,
      mode: "conversation_capture",
    },
    receptionist: (() => {
      const routeRaw = normalizeString(receptionistRaw.action_route, "");
      const actionRoute: EntryActionRoute =
        routeRaw === "amend_existing_task" ||
        routeRaw === "clarify_target" ||
        routeRaw === "intake_new_task"
          ? routeRaw
          : (fallback.receptionist?.action_route ?? "intake_new_task");
      return {
        active:
          typeof receptionistRaw.active === "boolean"
            ? receptionistRaw.active
            : (fallback.receptionist?.active ?? true),
        mode: "guided_intake",
        last_briefing_at: normalizeString(
          receptionistRaw.last_briefing_at,
          fallback.receptionist?.last_briefing_at || now,
        ),
        pending_questions: normalizeStringList(receptionistRaw.pending_questions),
        amendment_queue_open:
          typeof receptionistRaw.amendment_queue_open === "boolean"
            ? receptionistRaw.amendment_queue_open
            : (fallback.receptionist?.amendment_queue_open ?? false),
        action_route: actionRoute,
        action_target_task_id: (() => {
          const value = normalizeString(
            receptionistRaw.action_target_task_id,
            fallback.receptionist?.action_target_task_id ?? "",
          );
          return value || null;
        })(),
        clarification_required:
          typeof receptionistRaw.clarification_required === "boolean"
            ? receptionistRaw.clarification_required
            : (fallback.receptionist?.clarification_required ?? false),
        last_action_at: normalizeString(
          receptionistRaw.last_action_at,
          fallback.receptionist?.last_action_at || now,
        ),
      };
    })(),
    draft: {
      goal_raw: normalizeString(draftRaw.goal_raw, fallback.draft.goal_raw),
      task_goal: normalizeString(draftRaw.task_goal, fallback.draft.task_goal),
      project_id: normalizeString(draftRaw.project_id, fallback.draft.project_id),
      workspace_root: normalizeString(draftRaw.workspace_root, fallback.draft.workspace_root),
      risk_level: normalizeRiskLevel(draftRaw.risk_level, fallback.draft.risk_level),
      budget: normalizeBudget(draftRaw.budget, fallback.draft.budget),
      requested_mode: normalizeRequestedMode(draftRaw.requested_mode),
      constraints: normalizeStringList(draftRaw.constraints),
      deliverables: normalizeStringList(draftRaw.deliverables),
      notes: normalizeStringList(draftRaw.notes),
      open_questions: normalizeStringList(draftRaw.open_questions),
    },
    history,
    latest_summary: normalizeOrchestrateSummary(record.latest_summary, { now }),
    last_run:
      normalizeString(lastRunRaw.task_id, "") && normalizeString(lastRunRaw.summary_id, "")
        ? {
            task_id: normalizeString(lastRunRaw.task_id, ""),
            started_at: normalizeString(lastRunRaw.started_at, ""),
            summary_id: normalizeString(lastRunRaw.summary_id, ""),
          }
        : undefined,
  };
}

export function extractLatestUserMessage(messages: unknown[] | undefined): string {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const row = list[i];
    const msg = asRecord(row);
    if (!msg) {
      continue;
    }
    if (normalizeString(msg.role, "") !== "user") {
      continue;
    }
    if (typeof msg.content === "string") {
      return msg.content.trim();
    }
    if (!Array.isArray(msg.content)) {
      continue;
    }
    const chunks = msg.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        const segment = asRecord(part);
        return segment ? normalizeString(segment.text, "") : "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
    if (chunks) {
      return chunks;
    }
  }
  return "";
}

export function buildEntryAgentContext(
  session: OrchestrateSessionState,
  metaBlock?: string,
  decodeContractBlock?: string,
): string {
  const lines = [
    "You are currently acting as the orchestrate receptionist for an active /orchestrate session.",
    "Do not execute the task. Do not create tasks automatically.",
    "Your job is to help the user refine task goals and orchestration configuration.",
    "Planner remains isolated from raw user conversation. Only structured summaries and amendment batches flow downstream.",
    "Ask concise follow-up questions only when important details are missing.",
    "Remind the user to run /orchestrate summary when they want a structured recap.",
    "Current draft:",
    `- task_goal: ${session.draft.task_goal || "(none yet)"}`,
    `- project_id: ${session.draft.project_id || "(default)"}`,
    `- workspace_root: ${session.draft.workspace_root || "(default)"}`,
    `- risk_level: ${session.draft.risk_level}`,
    `- budget: ${session.draft.budget.max_token_cost},${session.draft.budget.max_execution_time_seconds}`,
    `- requested_mode: ${session.draft.requested_mode}`,
    `- deliverables: ${session.draft.deliverables.join(", ") || "(none)"}`,
  ];
  if (decodeContractBlock?.trim()) {
    lines.push("", decodeContractBlock.trim());
  }
  if (metaBlock?.trim()) {
    lines.push("", metaBlock.trim());
  }
  return lines.join("\n");
}

export function validateRunCommandPayload(payload: string): string | null {
  if (!payload.trim()) {
    return null;
  }
  return ["usage: /orchestrate run", "run no longer accepts free text; use /orchestrate start first"].join(
    "\n",
  );
}

export function getRunnableSummary(
  session: OrchestrateSessionState | null | undefined,
): { ok: true; summary: OrchestrateSummary } | { ok: false; error: string } {
  const latestSummary = session?.latest_summary;
  if (
    !session ||
    !latestSummary ||
    latestSummary.status === "superseded" ||
    latestSummary.status === "consumed"
  ) {
    return {
      ok: false,
      error: [
        "code: ORCHESTRATE_SUMMARY_NOT_FOUND",
        "message: current session has no usable summary; run /orchestrate summary first",
      ].join("\n"),
    };
  }
  if (!latestSummary.content.task_goal.trim()) {
    return {
      ok: false,
      error: [
        "code: ORCHESTRATE_SUMMARY_NOT_FOUND",
        "message: latest summary is empty; continue chatting and run /orchestrate summary again",
      ].join("\n"),
    };
  }
  return {
    ok: true,
    summary: latestSummary,
  };
}
