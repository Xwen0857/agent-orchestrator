import type {
  ObserverViewHealth,
  SchedulerEscalationAttempt,
  SchedulerEscalationTrigger,
} from "./orchestrate-observer-contract.js";

export function extractRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

export function normalizeNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function normalizeRuntimeSection(meta: Record<string, unknown>): Record<string, unknown> {
  const runtime = extractRecord(meta.worker_runtime);
  return {
    schema_version: normalizeString(runtime.schema_version),
    assembled_at: normalizeString(runtime.assembled_at),
    role_type: normalizeString(runtime.role_type),
    dispatch_action: normalizeString(runtime.dispatch_action),
    lane: normalizeString(runtime.lane),
    mode: normalizeString(runtime.mode),
    refinement_scope: normalizeString(runtime.refinement_scope),
    runtime_view_path: normalizeString(runtime.runtime_view_path),
    cluster_id: normalizeString(runtime.cluster_id),
    selected_template_id: normalizeString(runtime.selected_template_id),
    selected_template_origin: normalizeString(runtime.selected_template_origin),
    selected_template_source_id: normalizeString(runtime.selected_template_source_id),
    template_version: normalizeString(runtime.template_version),
    registration_source: normalizeString(runtime.registration_source),
    delivery_mode: normalizeString(runtime.delivery_mode),
    template_kind: normalizeString(runtime.template_kind),
    governance_policy_id: normalizeString(runtime.governance_policy_id),
    result_contract_version: normalizeString(runtime.result_contract_version),
    allowed_template_origins: normalizeStringArray(runtime.allowed_template_origins),
    custom_registration_required: runtime.custom_registration_required === true,
    custom_runtime_gate_status: normalizeString(runtime.custom_runtime_gate_status),
    custom_capability_gate_reason: normalizeString(runtime.custom_capability_gate_reason),
    default_message_type: normalizeString(runtime.default_message_type),
    default_target_role_types: normalizeStringArray(runtime.default_target_role_types),
    agent_dispatch_capability: extractRecord(runtime.agent_dispatch_capability),
    refinement_route_ref: extractRecord(runtime.refinement_route_ref),
    milestone_set: extractRecord(runtime.milestone_set),
    milestone_targets: normalizeStringArray(runtime.milestone_targets),
    milestone_completed_targets: normalizeStringArray(runtime.milestone_completed_targets),
    milestone_progress_signal: extractRecord(runtime.milestone_progress_signal),
    milestone_completion_signal: extractRecord(runtime.milestone_completion_signal),
    milestone_detection_window_seconds: normalizeNonNegativeInt(runtime.milestone_detection_window_seconds),
    stage_write_stagnation_seconds: normalizeNonNegativeInt(runtime.stage_write_stagnation_seconds),
    all_milestones_met: runtime.all_milestones_met === true,
    keeper_query_path: normalizeString(runtime.keeper_query_path),
    failure_pattern_summary_path: normalizeString(runtime.failure_pattern_summary_path),
    failure_pattern_index_refs: normalizeStringArray(runtime.failure_pattern_index_refs),
    failure_pattern_read_contract: extractRecord(runtime.failure_pattern_read_contract),
    semantic_topology: extractRecord(runtime.semantic_topology),
    implementation_topology: extractRecord(runtime.implementation_topology),
    cluster_projection: extractRecord(runtime.cluster_projection),
  };
}

export function normalizeWorkerStageSection(meta: Record<string, unknown>): Record<string, unknown> {
  const stage = extractRecord(meta.worker_stage);
  const allocation = extractRecord(stage.allocation);
  const retention = extractRecord(stage.retention);
  return {
    schema_version: normalizeString(stage.schema_version),
    worker_stage_id: normalizeString(stage.worker_stage_id),
    worker_stage_root: normalizeString(stage.worker_stage_root),
    worker_stage_profile: normalizeString(stage.worker_stage_profile),
    stage_isolation_mode: normalizeString(stage.stage_isolation_mode),
    stage_runtime_class: normalizeString(stage.stage_runtime_class),
    allowed_execution_mode: normalizeString(stage.allowed_execution_mode),
    scratch_root: normalizeString(stage.scratch_root),
    delivery_root: normalizeString(stage.delivery_root),
    inputs_root: normalizeString(stage.inputs_root),
    runtime_root: normalizeString(stage.runtime_root),
    mount_policy: extractRecord(stage.mount_policy),
    allocation: {
      worker_stage_scope: normalizeString(allocation.worker_stage_scope),
      worker_stage_max_bytes: normalizeNonNegativeInt(allocation.worker_stage_max_bytes),
      worker_stage_max_file_count: normalizeNonNegativeInt(allocation.worker_stage_max_file_count),
      worker_stage_max_single_file_bytes: normalizeNonNegativeInt(
        allocation.worker_stage_max_single_file_bytes,
      ),
      allow_binary_artifacts: allocation.allow_binary_artifacts === true,
      worker_stage_overflow_policy: normalizeString(allocation.worker_stage_overflow_policy),
      worker_stage_bytes_used: normalizeNonNegativeInt(allocation.worker_stage_bytes_used),
      worker_stage_file_count: normalizeNonNegativeInt(allocation.worker_stage_file_count),
      worker_stage_overflow_status: normalizeString(allocation.worker_stage_overflow_status),
    },
    retention: {
      worker_stage_retention_policy: normalizeString(retention.worker_stage_retention_policy),
      success_cleanup_rule: normalizeString(retention.success_cleanup_rule),
      failure_cleanup_rule: normalizeString(retention.failure_cleanup_rule),
      purge_on_success: retention.purge_on_success === true,
      purge_on_failure: retention.purge_on_failure === true,
      worker_stage_exported_artifact_count: normalizeNonNegativeInt(
        retention.worker_stage_exported_artifact_count,
      ),
      worker_stage_last_export_status: normalizeString(retention.worker_stage_last_export_status),
      worker_stage_last_export_manifest_class: normalizeString(
        retention.worker_stage_last_export_manifest_class,
      ),
      worker_stage_last_fault_class: normalizeString(retention.worker_stage_last_fault_class),
      worker_stage_retention_result: extractRecord(retention.worker_stage_retention_result),
      worker_stage_last_cleanup_at: normalizeString(retention.worker_stage_last_cleanup_at),
      worker_stage_last_retained_artifact_ids: normalizeStringArray(
        retention.worker_stage_last_retained_artifact_ids,
      ),
      worker_stage_archive_ready: retention.worker_stage_archive_ready === true,
      worker_stage_reclaim_ready: retention.worker_stage_reclaim_ready === true,
      worker_stage_purge_ready: retention.worker_stage_purge_ready === true,
      worker_stage_retention_decision: normalizeString(retention.worker_stage_retention_decision),
    },
  };
}

export function normalizeRuntimeControlSection(meta: Record<string, unknown>): Record<string, unknown> {
  const runtimeControl = extractRecord(meta.runtime_worker_control);
  return {
    budget_status: normalizeString(runtimeControl.budget_status),
    reclaim_requested_at: normalizeString(runtimeControl.reclaim_requested_at),
    rebuild_ready: runtimeControl.rebuild_ready === true,
    rebuild_reason: normalizeString(runtimeControl.rebuild_reason),
    last_rebuilt_at: normalizeString(runtimeControl.last_rebuilt_at),
    last_worker_fault_action: normalizeString(runtimeControl.last_worker_fault_action),
    worker_fault_retryable: runtimeControl.worker_fault_retryable === true,
    worker_fault_requires_rebuild: runtimeControl.worker_fault_requires_rebuild === true,
    last_fault_action_applied: normalizeString(runtimeControl.last_fault_action_applied),
    fault_actuation_mode: normalizeString(runtimeControl.fault_actuation_mode),
    fault_action_blocked_by_policy: runtimeControl.fault_action_blocked_by_policy === true,
    worker_fault_class: normalizeString(runtimeControl.worker_fault_class),
    archive_ready: runtimeControl.archive_ready === true,
    reclaim_ready: runtimeControl.reclaim_ready === true,
    purge_ready: runtimeControl.purge_ready === true,
    retention_decision: normalizeString(runtimeControl.retention_decision),
  };
}

export function normalizeWorkerBudgetSection(meta: Record<string, unknown>): Record<string, unknown> {
  const budget = extractRecord(meta.worker_budget);
  return {
    budget_lane: normalizeString(budget.budget_lane),
    fast_token_budget: normalizeNonNegativeInt(budget.fast_token_budget),
    degraded_token_budget: normalizeNonNegativeInt(budget.degraded_token_budget),
    reclaim_threshold: normalizeNonNegativeInt(budget.reclaim_threshold),
    token_cost_used: normalizeNonNegativeInt(budget.token_cost_used),
    max_token_cost: normalizeNonNegativeInt(budget.max_token_cost),
    updated_at: normalizeString(budget.updated_at),
  };
}

export function normalizeWorkerConvergenceSection(meta: Record<string, unknown>): Record<string, unknown> {
  const convergence = extractRecord(meta.worker_convergence);
  return {
    convergence_class: normalizeString(convergence.convergence_class),
    convergence_confidence:
      typeof convergence.convergence_confidence === "number"
        ? convergence.convergence_confidence
        : Number(convergence.convergence_confidence ?? 0) || 0,
    progress_delta: normalizeNonNegativeInt(convergence.progress_delta),
    remaining_work_estimate: normalizeString(convergence.remaining_work_estimate),
    reclaim_reason: normalizeString(convergence.reclaim_reason),
    reported_at: normalizeString(convergence.reported_at),
  };
}

export function normalizeTaskClusterSection(meta: Record<string, unknown>): Record<string, unknown> {
  const taskCluster = extractRecord(meta.task_cluster);
  const counters = extractRecord(taskCluster.mailbox_counters);
  return {
    cluster_id: normalizeString(taskCluster.cluster_id),
    cluster_root: normalizeString(taskCluster.cluster_root),
    workspace_root: normalizeString(taskCluster.workspace_root),
    mailbox_path: normalizeString(taskCluster.mailbox_path),
    archive_path: normalizeString(taskCluster.archive_path),
    default_target_role_types: normalizeStringArray(taskCluster.default_target_role_types),
    cluster_projection: extractRecord(taskCluster.cluster_projection),
    mailbox_counters: {
      published: normalizeNonNegativeInt(counters.published),
      acknowledged: normalizeNonNegativeInt(counters.acknowledged),
      consumed: normalizeNonNegativeInt(counters.consumed),
      archived: normalizeNonNegativeInt(counters.archived),
    },
    last_published_message_type: normalizeString(taskCluster.last_published_message_type),
    mailbox_last_expired_at: normalizeString(taskCluster.mailbox_last_expired_at),
    updated_at: normalizeString(taskCluster.updated_at),
  };
}

export function normalizeObserverSection(meta: Record<string, unknown>): Record<string, unknown> {
  return extractRecord(meta.observer);
}

function hasMeaningfulObjectFields(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => {
    if (entry === null || entry === undefined) {
      return false;
    }
    if (typeof entry === "string") {
      return entry.trim().length > 0;
    }
    if (typeof entry === "number") {
      return entry !== 0;
    }
    if (typeof entry === "boolean") {
      return entry;
    }
    if (Array.isArray(entry)) {
      return entry.length > 0;
    }
    if (typeof entry === "object") {
      return hasMeaningfulObjectFields(entry as Record<string, unknown>);
    }
    return false;
  });
}

export function deriveObservationHealth(sections: {
  runtime: Record<string, unknown>;
  workerStage: Record<string, unknown>;
  runtimeControl: Record<string, unknown>;
  workerBudget: Record<string, unknown>;
  workerConvergence: Record<string, unknown>;
  taskCluster: Record<string, unknown>;
}): ObserverViewHealth {
  const hasRuntime = hasMeaningfulObjectFields(sections.runtime);
  const hasWorkerStage = hasMeaningfulObjectFields(sections.workerStage);
  const hasSupportingSections =
    hasMeaningfulObjectFields(sections.runtimeControl) ||
    hasMeaningfulObjectFields(sections.workerBudget) ||
    hasMeaningfulObjectFields(sections.workerConvergence) ||
    hasMeaningfulObjectFields(sections.taskCluster);
  if (hasRuntime && hasWorkerStage && !hasSupportingSections) {
    return "partial";
  }
  if (hasRuntime && hasWorkerStage) {
    return "ok";
  }
  if (!hasRuntime && hasWorkerStage) {
    return "missing_runtime";
  }
  if (hasRuntime && !hasWorkerStage) {
    return "missing_stage";
  }
  return "partial";
}

export function normalizeTrigger(value: unknown): SchedulerEscalationTrigger {
  const raw = normalizeString(value);
  if (
    raw === "retry_exhausted" ||
    raw === "recovery_exhausted" ||
    raw === "rebuild_exhausted" ||
    raw === "reclaim_exhausted" ||
    raw === "persistent_fault" ||
    raw === "persistent_stall"
  ) {
    return raw;
  }
  return "persistent_fault";
}

export function normalizeAttemptHistory(value: unknown): SchedulerEscalationAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => extractRecord(entry))
    .map((entry) => {
      const kind = normalizeString(entry.kind);
      const status = normalizeString(entry.status);
      return {
        kind:
          kind === "retry" ||
          kind === "recovery" ||
          kind === "fault_action" ||
          kind === "reclaim" ||
          kind === "budget"
            ? kind
            : "retry",
        status:
          status === "attempted" ||
          status === "applied" ||
          status === "requested" ||
          status === "observed"
            ? status
            : "observed",
        detail: normalizeString(entry.detail),
      };
    });
}

export function normalizeBlockedReasons(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => normalizeString(entry)).filter(Boolean) : [];
}

export function normalizeEvidencePaths(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => normalizeString(entry)).filter(Boolean) : [];
}
