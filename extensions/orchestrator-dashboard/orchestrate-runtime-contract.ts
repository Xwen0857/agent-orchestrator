import type { RuntimeConsistencySnapshot } from "./orchestrate-runtime-consistency.js";

export type RuntimeReplanSignals = {
  status: string | null;
  impact: string | null;
  worker_policy: string | null;
  execution_status: string | null;
  scope_summary: string[];
  requested_at: string | null;
  applied_at: string | null;
  consumed_at: string | null;
  resumed_at: string | null;
  blocked_reason: string | null;
};

export type ExecutionGuardSignals = {
  runtime_consistency: "ok" | "mismatch" | "unknown";
  should_block_side_effects: boolean;
};

export type OrchestrateRuntimeCoordinationState = {
  replan: RuntimeReplanSignals;
  guard: ExecutionGuardSignals;
  worker: WorkerRuntimeCoordinationSignals;
};

export type WorkerRuntimeCoordinationSignals = {
  budget_lane: "fast" | "degraded" | "reclaim_pending" | null;
  convergence_class: string | null;
  reclaim_reason: string | null;
  task_cluster_id: string | null;
  task_cluster_mailbox_counts: {
    published: number;
    acknowledged: number;
    consumed: number;
    archived: number;
  };
  keeper_feedback_types: string[];
  keeper_feedback_fingerprints: string[];
  keeper_last_submitted_at: string | null;
  runtime_control: {
    budget_status: string | null;
    reclaim_requested_at: string | null;
    rebuild_ready: boolean;
    rebuild_reason: string | null;
    last_rebuilt_at: string | null;
  };
};

export type EntryAgentToolPolicyView = {
  allow_summary_hint: boolean;
  allow_status_hint: boolean;
  allow_resume_hint: boolean;
  allow_clarify_hint: boolean;
  resume_task_id: string | null;
  blocked_by_guard: boolean;
  blocked_reason: "runtime_mismatch" | "planner_paused" | null;
};

export type EntryActionPolicyView = {
  allow_clarification_only: boolean;
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function extractRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function extractRuntimeReplanSignals(meta: Record<string, unknown> | null | undefined): RuntimeReplanSignals {
  const plannerReplan = extractRecord(meta?.planner_replan);
  const runtimeReplan = extractRecord(meta?.runtime_replan);
  const scopeSummary = Array.isArray(plannerReplan.scope_summary)
    ? plannerReplan.scope_summary.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return {
    status: normalizeOptionalString(plannerReplan.status),
    impact: normalizeOptionalString(plannerReplan.impact),
    worker_policy: normalizeOptionalString(plannerReplan.worker_policy),
    execution_status: normalizeOptionalString(runtimeReplan.consume_status),
    scope_summary: scopeSummary,
    requested_at: normalizeOptionalString(plannerReplan.requested_at),
    applied_at: normalizeOptionalString(plannerReplan.applied_at),
    consumed_at: normalizeOptionalString(runtimeReplan.consumed_at),
    resumed_at: normalizeOptionalString(runtimeReplan.resumed_at),
    blocked_reason: normalizeOptionalString(runtimeReplan.blocked_reason),
  };
}

export function normalizeRuntimeConsistency(
  snapshot?: Pick<RuntimeConsistencySnapshot, "runtimeConsistency"> | null,
): ExecutionGuardSignals["runtime_consistency"] {
  if (!snapshot) {
    return "unknown";
  }
  return snapshot.runtimeConsistency === "mismatch" ? "mismatch" : "ok";
}

export function buildRuntimeCoordinationState(params: {
  taskMeta?: Record<string, unknown> | null;
  runtimeConsistency?: Pick<RuntimeConsistencySnapshot, "runtimeConsistency"> | null;
}): OrchestrateRuntimeCoordinationState {
  const replan = extractRuntimeReplanSignals(params.taskMeta);
  const consistency = normalizeRuntimeConsistency(params.runtimeConsistency);
  const blockedByMismatch = consistency === "mismatch";
  const blockedByPlannerPause = replan.execution_status === "paused";
  return {
    replan,
    guard: {
      runtime_consistency: consistency,
      should_block_side_effects: blockedByMismatch || blockedByPlannerPause,
    },
    worker: extractWorkerRuntimeCoordinationSignals(params.taskMeta),
  };
}

function normalizeOptionalNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function extractWorkerRuntimeCoordinationSignals(
  meta: Record<string, unknown> | null | undefined,
): WorkerRuntimeCoordinationSignals {
  const workerBudget = extractRecord(meta?.worker_budget);
  const workerConvergence = extractRecord(meta?.worker_convergence);
  const taskCluster = extractRecord(meta?.task_cluster);
  const mailboxCounters = extractRecord(taskCluster.mailbox_counters);
  const keeperFeedback = extractRecord(meta?.keeper_feedback);
  const runtimeControl = extractRecord(meta?.runtime_worker_control);
  const feedbackTypes = Array.isArray(keeperFeedback.feedback_types)
    ? keeperFeedback.feedback_types.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return {
    budget_lane: normalizeOptionalString(workerBudget.budget_lane) as
      | "fast"
      | "degraded"
      | "reclaim_pending"
      | null,
    convergence_class: normalizeOptionalString(workerConvergence.convergence_class),
    reclaim_reason: normalizeOptionalString(workerConvergence.reclaim_reason),
    task_cluster_id: normalizeOptionalString(taskCluster.cluster_id),
    task_cluster_mailbox_counts: {
      published: normalizeOptionalNumber(mailboxCounters.published),
      acknowledged: normalizeOptionalNumber(mailboxCounters.acknowledged),
      consumed: normalizeOptionalNumber(mailboxCounters.consumed),
      archived: normalizeOptionalNumber(mailboxCounters.archived),
    },
    keeper_feedback_types: feedbackTypes,
    keeper_feedback_fingerprints: Array.isArray(keeperFeedback.submitted_fingerprints)
      ? keeperFeedback.submitted_fingerprints.map((item) => String(item).trim()).filter(Boolean)
      : [],
    keeper_last_submitted_at: normalizeOptionalString(keeperFeedback.last_submitted_at),
    runtime_control: {
      budget_status: normalizeOptionalString(runtimeControl.budget_status),
      reclaim_requested_at: normalizeOptionalString(runtimeControl.reclaim_requested_at),
      rebuild_ready: runtimeControl.rebuild_ready === true,
      rebuild_reason: normalizeOptionalString(runtimeControl.rebuild_reason),
      last_rebuilt_at: normalizeOptionalString(runtimeControl.last_rebuilt_at),
    },
  };
}

export function buildEntryAgentToolPolicyView(params: {
  coordination: OrchestrateRuntimeCoordinationState;
  sessionStatus: "ACTIVE_DRAFTING" | "SUMMARY_READY" | "RUNNING" | "CLOSED";
  runTaskId: string | null;
  hasDraftInput: boolean;
  clarificationRequired?: boolean;
}): EntryAgentToolPolicyView {
  const blockedByMismatch = params.coordination.guard.runtime_consistency === "mismatch";
  const blockedByPlannerPause = params.coordination.replan.execution_status === "paused";
  const blockedReason = blockedByMismatch
    ? "runtime_mismatch"
    : blockedByPlannerPause
      ? "planner_paused"
      : null;
  const allowResume =
    params.sessionStatus === "RUNNING" &&
    Boolean(params.runTaskId) &&
    params.coordination.replan.impact === "hard" &&
    params.coordination.replan.worker_policy === "pause_and_require_replan" &&
    params.coordination.replan.execution_status === "paused";

  return {
    allow_summary_hint: params.sessionStatus === "ACTIVE_DRAFTING" && params.hasDraftInput,
    allow_status_hint: params.sessionStatus === "RUNNING" && Boolean(params.runTaskId),
    allow_resume_hint: allowResume,
    allow_clarify_hint: Boolean(params.clarificationRequired),
    resume_task_id: allowResume ? params.runTaskId : null,
    blocked_by_guard: blockedByMismatch || blockedByPlannerPause,
    blocked_reason: blockedReason,
  };
}

export function buildEntryActionPolicyView(params: {
  clarificationRequired: boolean;
}): EntryActionPolicyView {
  return {
    allow_clarification_only: params.clarificationRequired,
  };
}
