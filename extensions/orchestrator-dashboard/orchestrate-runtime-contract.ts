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
  selected_template_id: string | null;
  selected_template_origin: string | null;
  selected_template_source_id: string | null;
  template_version: string | null;
  registration_source: string | null;
  delivery_mode: string | null;
  template_kind: string | null;
  governance_policy_id: string | null;
  result_contract_version: string | null;
  allowed_template_origins: string[];
  custom_registration_required: boolean;
  worker_stage_id: string | null;
  worker_stage_root: string | null;
  worker_stage_profile: string | null;
  worker_stage_isolation_mode: string | null;
  worker_stage_runtime_class: string | null;
  worker_stage_allowed_execution_mode: string | null;
  worker_stage_max_bytes: number;
  worker_stage_max_file_count: number;
  worker_stage_max_single_file_bytes: number;
  worker_stage_overflow_policy: string | null;
  worker_stage_bytes_used: number;
  worker_stage_file_count: number;
  worker_stage_overflow_status: string | null;
  worker_stage_retention_policy: string | null;
  worker_stage_exported_artifact_count: number;
  worker_stage_last_export_status: string | null;
  worker_stage_last_export_manifest_class: string | null;
  worker_stage_last_fault_class: string | null;
  worker_stage_retention_result: Record<string, unknown>;
  worker_stage_last_cleanup_at: string | null;
  worker_stage_last_retained_artifact_ids: string[];
  custom_runtime_gate_status: string | null;
  custom_capability_gate_reason: string | null;
  worker_stage_archive_ready: boolean;
  worker_stage_reclaim_ready: boolean;
  worker_stage_purge_ready: boolean;
  worker_stage_retention_decision: string | null;
  cluster_root: string | null;
  default_message_type: string | null;
  default_target_role_types: string[];
  semantic_topology: Record<string, unknown>;
  implementation_topology: Record<string, unknown>;
  cluster_projection: Record<string, unknown>;
  task_cluster_id: string | null;
  task_cluster_mailbox_counts: {
    published: number;
    acknowledged: number;
    consumed: number;
    archived: number;
  };
  task_cluster_last_message_type: string | null;
  keeper_feedback_types: string[];
  keeper_feedback_fingerprints: string[];
  keeper_last_submitted_at: string | null;
  runtime_control: {
    budget_status: string | null;
    reclaim_requested_at: string | null;
    rebuild_ready: boolean;
    rebuild_reason: string | null;
    last_rebuilt_at: string | null;
    last_worker_fault_action: string | null;
    worker_fault_retryable: boolean;
    worker_fault_requires_rebuild: boolean;
    last_fault_action_applied: string | null;
    fault_actuation_mode: string | null;
    fault_action_blocked_by_policy: boolean;
    worker_fault_class: string | null;
    archive_ready: boolean;
    reclaim_ready: boolean;
    purge_ready: boolean;
    retention_decision: string | null;
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
  const workerRuntime = extractRecord(meta?.worker_runtime);
  const workerStage = extractRecord(meta?.worker_stage);
  const workerStageAllocation = extractRecord(workerStage.allocation);
  const workerStageRetention = extractRecord(workerStage.retention);
  const taskCluster = extractRecord(meta?.task_cluster);
  const mailboxCounters = extractRecord(taskCluster.mailbox_counters);
  const keeperFeedback = extractRecord(meta?.keeper_feedback);
  const runtimeControl = extractRecord(meta?.runtime_worker_control);
  const feedbackTypes = Array.isArray(keeperFeedback.feedback_types)
    ? keeperFeedback.feedback_types.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const defaultTargetRoleTypes = Array.isArray(workerRuntime.default_target_role_types)
    ? workerRuntime.default_target_role_types.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const allowedTemplateOrigins = Array.isArray(workerRuntime.allowed_template_origins)
    ? workerRuntime.allowed_template_origins.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return {
    budget_lane: normalizeOptionalString(workerBudget.budget_lane) as
      | "fast"
      | "degraded"
      | "reclaim_pending"
      | null,
    convergence_class: normalizeOptionalString(workerConvergence.convergence_class),
    reclaim_reason: normalizeOptionalString(workerConvergence.reclaim_reason),
    selected_template_id: normalizeOptionalString(workerRuntime.selected_template_id),
    selected_template_origin: normalizeOptionalString(workerRuntime.selected_template_origin),
    selected_template_source_id: normalizeOptionalString(workerRuntime.selected_template_source_id),
    template_version: normalizeOptionalString(workerRuntime.template_version),
    registration_source: normalizeOptionalString(workerRuntime.registration_source),
    delivery_mode: normalizeOptionalString(workerRuntime.delivery_mode),
    template_kind: normalizeOptionalString(workerRuntime.template_kind),
    governance_policy_id: normalizeOptionalString(workerRuntime.governance_policy_id),
    result_contract_version: normalizeOptionalString(workerRuntime.result_contract_version),
    allowed_template_origins: allowedTemplateOrigins,
    custom_registration_required: workerRuntime.custom_registration_required === true,
    worker_stage_id: normalizeOptionalString(workerStage.worker_stage_id),
    worker_stage_root: normalizeOptionalString(workerStage.worker_stage_root),
    worker_stage_profile: normalizeOptionalString(workerStage.worker_stage_profile),
    worker_stage_isolation_mode: normalizeOptionalString(workerStage.stage_isolation_mode),
    worker_stage_runtime_class: normalizeOptionalString(workerStage.stage_runtime_class),
    worker_stage_allowed_execution_mode: normalizeOptionalString(workerStage.allowed_execution_mode),
    worker_stage_max_bytes: normalizeOptionalNumber(workerStageAllocation.worker_stage_max_bytes),
    worker_stage_max_file_count: normalizeOptionalNumber(workerStageAllocation.worker_stage_max_file_count),
    worker_stage_max_single_file_bytes: normalizeOptionalNumber(workerStageAllocation.worker_stage_max_single_file_bytes),
    worker_stage_overflow_policy: normalizeOptionalString(workerStageAllocation.worker_stage_overflow_policy),
    worker_stage_bytes_used: normalizeOptionalNumber(workerStageAllocation.worker_stage_bytes_used),
    worker_stage_file_count: normalizeOptionalNumber(workerStageAllocation.worker_stage_file_count),
    worker_stage_overflow_status: normalizeOptionalString(workerStageAllocation.worker_stage_overflow_status),
    worker_stage_retention_policy: normalizeOptionalString(workerStageRetention.worker_stage_retention_policy),
    worker_stage_exported_artifact_count: normalizeOptionalNumber(workerStageRetention.worker_stage_exported_artifact_count),
    worker_stage_last_export_status: normalizeOptionalString(workerStageRetention.worker_stage_last_export_status),
    worker_stage_last_export_manifest_class: normalizeOptionalString(
      workerStageRetention.worker_stage_last_export_manifest_class,
    ),
    worker_stage_last_fault_class: normalizeOptionalString(workerStageRetention.worker_stage_last_fault_class),
    worker_stage_retention_result: extractRecord(workerStageRetention.worker_stage_retention_result),
    worker_stage_last_cleanup_at: normalizeOptionalString(workerStageRetention.worker_stage_last_cleanup_at),
    worker_stage_last_retained_artifact_ids: Array.isArray(workerStageRetention.worker_stage_last_retained_artifact_ids)
      ? workerStageRetention.worker_stage_last_retained_artifact_ids
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [],
    custom_runtime_gate_status: normalizeOptionalString(workerRuntime.custom_runtime_gate_status),
    custom_capability_gate_reason: normalizeOptionalString(workerRuntime.custom_capability_gate_reason),
    worker_stage_archive_ready: workerStageRetention.worker_stage_archive_ready === true,
    worker_stage_reclaim_ready: workerStageRetention.worker_stage_reclaim_ready === true,
    worker_stage_purge_ready: workerStageRetention.worker_stage_purge_ready === true,
    worker_stage_retention_decision: normalizeOptionalString(workerStageRetention.worker_stage_retention_decision),
    cluster_root: normalizeOptionalString(extractRecord(meta?.task_cluster).cluster_root),
    default_message_type: normalizeOptionalString(workerRuntime.default_message_type),
    default_target_role_types: defaultTargetRoleTypes,
    semantic_topology: extractRecord(workerRuntime.semantic_topology),
    implementation_topology: extractRecord(workerRuntime.implementation_topology),
    cluster_projection: extractRecord(workerRuntime.cluster_projection),
    task_cluster_id: normalizeOptionalString(taskCluster.cluster_id),
    task_cluster_mailbox_counts: {
      published: normalizeOptionalNumber(mailboxCounters.published),
      acknowledged: normalizeOptionalNumber(mailboxCounters.acknowledged),
      consumed: normalizeOptionalNumber(mailboxCounters.consumed),
      archived: normalizeOptionalNumber(mailboxCounters.archived),
    },
    task_cluster_last_message_type: normalizeOptionalString(taskCluster.last_published_message_type),
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
      last_worker_fault_action: normalizeOptionalString(runtimeControl.last_worker_fault_action),
      worker_fault_retryable: runtimeControl.worker_fault_retryable === true,
      worker_fault_requires_rebuild: runtimeControl.worker_fault_requires_rebuild === true,
      last_fault_action_applied: normalizeOptionalString(runtimeControl.last_fault_action_applied),
      fault_actuation_mode: normalizeOptionalString(runtimeControl.fault_actuation_mode),
      fault_action_blocked_by_policy: runtimeControl.fault_action_blocked_by_policy === true,
      worker_fault_class: normalizeOptionalString(runtimeControl.worker_fault_class),
      archive_ready: runtimeControl.archive_ready === true,
      reclaim_ready: runtimeControl.reclaim_ready === true,
      purge_ready: runtimeControl.purge_ready === true,
      retention_decision: normalizeOptionalString(runtimeControl.retention_decision),
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
