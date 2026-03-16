/**
 * Shared command-layer helpers for strategy creation, script dispatch, and id generation.
 * These helpers convert user/session context into script-ready payloads while keeping
 * shell execution bounded to a fixed allowlist.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Fixed whitelist of shell scripts the dashboard plugin is allowed to execute.
 * Callers must use the symbolic name so dispatch remains explicit and auditable.
 */
export const ORCHESTRATE_SCRIPT_MAP = {
  create_task_from_strategy: "agent-orchestrator/scripts/create_task_from_strategy.sh",
  planner_entry: "agent-orchestrator/scripts/planner_entry.sh",
  planner_apply_amendment_batch: "agent-orchestrator/scripts/planner_apply_amendment_batch.sh",
  planner_resume_hard_replan: "agent-orchestrator/scripts/planner_resume_hard_replan.sh",
  planner_prepare_single_worker: "agent-orchestrator/scripts/planner_prepare_single_worker.sh",
  planner_prepare_workers: "agent-orchestrator/scripts/planner_prepare_workers.sh",
  transition_task_state: "agent-orchestrator/scripts/transition_task_state.sh",
  dashboard_summary: "agent-orchestrator/scripts/dashboard_summary.sh",
  orchestrate_once: "agent-orchestrator/scripts/orchestrate_once.sh",
  orchestrate_multi_once: "agent-orchestrator/scripts/orchestrate_multi_once.sh",
  agent_dispatch: "agent-orchestrator/scripts/agent_dispatch.sh",
  append_task_event: "agent-orchestrator/scripts/append_task_event.sh",
  kb_submit_candidate: "agent-orchestrator/scripts/kb_submit_candidate.sh",
  kb_import_from_workspace: "agent-orchestrator/scripts/kb_import_from_workspace.sh",
} as const;

export type OrchestrateScriptName = keyof typeof ORCHESTRATE_SCRIPT_MAP;

export type StrategyRiskLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * Canonical task creation payload passed into planner/bootstrap scripts.
 * It preserves both the raw request and the normalized fields derived from it.
 */
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
  summary_input?: {
    task_goal: string;
    constraints: string[];
    deliverables: string[];
    notes: string[];
  };
  planning_decision?: {
    decision_source: "manual_override" | "planner_llm" | "planner_rules_fallback";
    decision_reason: string;
    decision_signals: {
      estimated_minutes: number;
      artifact_count_hint: number;
      complexity_keywords: string[];
      budget_seconds: number;
    };
    planner_phase?: "initial_plan" | "replan";
    decomposition_strategy?: "single_path" | "module_first";
    release_policy?: "immediate_first_wave" | "rolling_followup";
    request_authority?: "task_local_strategy_meta";
    llm_role?: "primary";
    llm_decision_used?: boolean;
    token_priority_context?: {
      tier: "highest";
      reserved_ratio: number;
      min_planning_tokens: number;
      max_planning_tokens: number;
      inline_override_applied: boolean;
      effective_planning_tokens: number;
    };
    mcp_soft_boundary_signals?: {
      mode: "bias_plan";
      isolation_enabled: boolean;
      orchestrator_profile_name: string;
      project_profile_name: string;
      orchestrator_mcp_dir: string;
      project_mcp_dir: string;
      orchestrator_namespace_read_only: boolean;
      project_namespace_read_only: boolean;
    };
    meta_decomposition?: {
      resolved_action: "skip_initial_split" | "force_initial_split";
      decision_source: "manual_override" | "planner_llm" | "planner_rules_fallback";
      decomposition_strategy: "meta_single_unit" | "meta_module_partition";
    };
    worker_refinement?: {
      required: true;
      refinement_strategy: "linear_split_units_placeholder";
      refinement_scope: "single_meta_input" | "multi_meta_input";
    };
    agent_contract_version?: "planner-core-v2";
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

/**
 * Builds a task id that is sortable by creation time and still collision-resistant.
 */
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

/**
 * Converts free-form request text into a deterministic baseline strategy.
 * Missing optional fields fall back to the orchestrator defaults expected by planner-core.
 */
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
    workspace: params.workspace,
    created_at: toIsoUtc(now),
    status: "drafted",
  };
}

/**
 * Rebuilds a script-ready strategy from a structured session summary.
 * Array fields are filtered to non-empty strings before being embedded in the payload.
 */
export function buildStrategyFromSummary(params: {
  summary: {
    task_goal: string;
    risk_level?: StrategyRiskLevel;
    budget?: {
      max_token_cost?: number;
      max_execution_time_seconds?: number;
    };
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

/**
 * Executes one shell script from the explicit whitelist after validating argument shape.
 * This prevents arbitrary command execution while still allowing the plugin to invoke
 * the repository's orchestration scripts.
 */
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

  // Reject malformed arguments before anything reaches the process boundary.
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

/**
 * Derives a deterministic id for idempotent command operations from visible request context.
 */
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
