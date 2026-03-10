import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ORCHESTRATE_SCRIPT_MAP = {
  create_task_from_strategy: "agent-orchestrator/scripts/create_task_from_strategy.sh",
  planner_entry: "agent-orchestrator/scripts/planner_entry.sh",
  planner_apply_amendment_batch: "agent-orchestrator/scripts/planner_apply_amendment_batch.sh",
  planner_prepare_single_worker: "agent-orchestrator/scripts/planner_prepare_single_worker.sh",
  planner_prepare_workers: "agent-orchestrator/scripts/planner_prepare_workers.sh",
  transition_task_state: "agent-orchestrator/scripts/transition_task_state.sh",
  dashboard_summary: "agent-orchestrator/scripts/dashboard_summary.sh",
  orchestrate_once: "agent-orchestrator/scripts/orchestrate_once.sh",
  orchestrate_multi_once: "agent-orchestrator/scripts/orchestrate_multi_once.sh",
  agent_dispatch: "agent-orchestrator/scripts/agent_dispatch.sh",
  append_task_event: "agent-orchestrator/scripts/append_task_event.sh",
  kb_import_from_workspace: "agent-orchestrator/scripts/kb_import_from_workspace.sh",
} as const;

export type OrchestrateScriptName = keyof typeof ORCHESTRATE_SCRIPT_MAP;

export type StrategyRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type OrchestrateStrategy = {
  task_id: string;
  source: {
    channel: string;
    sender_id: string;
    session_key: string;
    message_thread_id: number | null;
  };
  raw_request: string;
  title: string;
  goal: string;
  risk_level: StrategyRiskLevel;
  owner: string;
  budget: {
    max_token_cost: number;
    max_execution_time_seconds: number;
  };
  execution: {
    requested_mode: "auto" | "single" | "multi";
  };
  summary_input?: {
    task_goal: string;
    constraints: string[];
    deliverables: string[];
    notes: string[];
  };
  planning_decision?: {
    requested_mode: "auto" | "single" | "multi";
    resolved_mode: "single" | "multi";
    decision_source: "manual_override" | "planner_llm" | "planner_rules_fallback";
    decision_reason: string;
    decision_signals: {
      estimated_minutes: number;
      artifact_count_hint: number;
      complexity_keywords: string[];
      budget_seconds: number;
    };
  };
  workspace?: {
    project_id: string;
    workspace_root: string;
    source: "run_flag" | "path_default" | "runtime_default";
  };
  created_at: string;
  status: "drafted" | "applied";
};

function toIsoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function safeSingleLine(input: string, maxLen: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return normalized.slice(0, Math.max(1, maxLen - 3)).trimEnd() + "...";
}

function buildTitleFromRequest(request: string): string {
  const oneLine = request.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return "orchestrate task";
  }
  const firstClause = oneLine.split(/[。！？!?\.]/u)[0]?.trim() || oneLine;
  return safeSingleLine(firstClause, 72) || "orchestrate task";
}

export function buildTaskId(title: string, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const slug = (title || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const randomSuffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return `task_${stamp}_${slug || "task"}_${randomSuffix}`;
}

export function normalizeFreeTextToStrategy(params: {
  input: string;
  taskId: string;
  channel: string;
  senderId?: string;
  sessionKey?: string;
  messageThreadId?: number;
  now?: Date;
  owner?: string;
  riskLevel?: StrategyRiskLevel;
  budget?: { max_token_cost: number; max_execution_time_seconds: number };
  requestedMode?: "auto" | "single" | "multi";
  workspace?: {
    project_id: string;
    workspace_root: string;
    source: "run_flag" | "path_default" | "runtime_default";
  };
}): OrchestrateStrategy {
  const now = params.now ?? new Date();
  const raw = params.input.trim();
  const normalizedRequest = raw || "(empty request)";
  const title = buildTitleFromRequest(normalizedRequest);
  const goal = safeSingleLine(normalizedRequest, 280) || "Execute orchestrator task";

  return {
    task_id: params.taskId,
    source: {
      channel: params.channel,
      sender_id: params.senderId?.trim() || "unknown",
      session_key: params.sessionKey?.trim() || "unknown",
      message_thread_id: typeof params.messageThreadId === "number" ? params.messageThreadId : null,
    },
    raw_request: normalizedRequest,
    title,
    goal,
    risk_level: params.riskLevel ?? "MEDIUM",
    owner: params.owner?.trim() || "planner-core",
    budget: params.budget ?? {
      max_token_cost: 50000,
      max_execution_time_seconds: 3600,
    },
    execution: {
      requested_mode: params.requestedMode ?? "auto",
    },
    workspace: params.workspace,
    created_at: toIsoUtc(now),
    status: "drafted",
  };
}

export function buildStrategyFromSummary(params: {
  summary: {
    task_goal: string;
    risk_level?: StrategyRiskLevel;
    budget?: {
      max_token_cost?: number;
      max_execution_time_seconds?: number;
    };
    requested_mode?: "auto" | "single" | "multi";
    constraints?: string[];
    deliverables?: string[];
    notes?: string[];
  };
  taskId: string;
  channel: string;
  senderId?: string;
  sessionKey?: string;
  messageThreadId?: number;
  now?: Date;
  workspace?: {
    project_id: string;
    workspace_root: string;
    source: "run_flag" | "path_default" | "runtime_default";
  };
}): OrchestrateStrategy {
  const constraints = Array.isArray(params.summary.constraints)
    ? params.summary.constraints.filter((v) => typeof v === "string" && v.trim())
    : [];
  const deliverables = Array.isArray(params.summary.deliverables)
    ? params.summary.deliverables.filter((v) => typeof v === "string" && v.trim())
    : [];
  const notes = Array.isArray(params.summary.notes)
    ? params.summary.notes.filter((v) => typeof v === "string" && v.trim())
    : [];
  const taskGoal = params.summary.task_goal.trim();
  const strategy = normalizeFreeTextToStrategy({
    input: taskGoal,
    taskId: params.taskId,
    channel: params.channel,
    senderId: params.senderId,
    sessionKey: params.sessionKey,
    messageThreadId: params.messageThreadId,
    now: params.now,
    owner: "planner-core",
    riskLevel: params.summary.risk_level ?? "MEDIUM",
    budget: {
      max_token_cost: Math.max(1, Number(params.summary.budget?.max_token_cost ?? 50000)),
      max_execution_time_seconds: Math.max(
        1,
        Number(params.summary.budget?.max_execution_time_seconds ?? 3600),
      ),
    },
    requestedMode: params.summary.requested_mode ?? "auto",
    workspace: params.workspace,
  });

  return {
    ...strategy,
    summary_input: {
      task_goal: taskGoal,
      constraints,
      deliverables,
      notes,
    },
  };
}

function validateScriptArg(arg: string): void {
  if (arg.length === 0 || arg.length > 256) {
    throw new Error("invalid script argument length");
  }
  if (!/^[A-Za-z0-9._/:@+=,-]+$/u.test(arg)) {
    throw new Error("invalid script argument characters");
  }
}

export async function runWhitelistedScript(params: {
  repoRoot: string;
  scriptName: OrchestrateScriptName;
  args: string[];
  timeoutMs?: number;
  maxBufferBytes?: number;
}): Promise<{ stdout: string; stderr: string; scriptPath: string }> {
  const scriptRel = ORCHESTRATE_SCRIPT_MAP[params.scriptName];
  if (!scriptRel) {
    throw new Error("script is not allowed");
  }
  if (params.args.length > 16) {
    throw new Error("too many script arguments");
  }

  for (const arg of params.args) {
    validateScriptArg(arg);
  }

  const scriptPath = `${params.repoRoot}/${scriptRel}`;
  const res = await execFileAsync(scriptPath, params.args, {
    cwd: params.repoRoot,
    timeout: params.timeoutMs ?? 30_000,
    maxBuffer: params.maxBufferBytes ?? 1024 * 1024,
  });

  return {
    scriptPath,
    stdout: String(res.stdout ?? "").trim(),
    stderr: String(res.stderr ?? "").trim(),
  };
}

export function buildOperationId(params: {
  subcommand: string;
  sessionKey?: string;
  messageThreadId?: number;
  request: string;
}): string {
  const seed = [
    params.subcommand,
    params.sessionKey?.trim() || "unknown",
    typeof params.messageThreadId === "number" ? String(params.messageThreadId) : "na",
    params.request.trim(),
  ].join("|");
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `op_${digest}`;
}
