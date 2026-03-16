import type { ObserverViewV1, WorkerTerminalDigestV1 } from "./orchestrate-observer-contract.js";
import type {
  SchedulerAgentProfile,
  SchedulerFaultActuationMode,
  SchedulerFaultHandlingAction,
} from "./orchestrate-scheduler-contract.js";
import type { SchedulerDispatchCapabilitySummary } from "./orchestrate-worker-runtime-contract.js";

export type NormalizedSchedulerDispatchCapabilitySummary = SchedulerDispatchCapabilitySummary & {
  projection_source: "worker_runtime" | "missing";
};

export type SchedulerAgentPolicyContext = {
  task_id: string;
  agent_type: TaskMeta["scheduler"]["agent_type"];
  agent_profile: SchedulerAgentProfile;
  compatibility_mode: "formal" | "missing";
  selected_template_id: string;
  selected_template_origin: string;
  custom_runtime_gate_status: string;
  custom_capability_gate_reason: string;
  dispatch_gate: {
    allowed: boolean;
    reason: string;
    source: NormalizedSchedulerDispatchCapabilitySummary["projection_source"];
  };
  skill_capability_gate: {
    allowed: boolean;
    reason: string;
  };
  lane_eligibility: {
    recovery: boolean;
    retry: boolean;
    assigned_ready: boolean;
  };
  capability_summary: NormalizedSchedulerDispatchCapabilitySummary;
};

export type TaskMeta = {
  taskId: string;
  taskDir: string;
  metaPath: string;
  observerPath: string;
  observerView: ObserverViewV1 | null;
  terminalDigestPath: string;
  rawLogIndexPath: string;
  terminalDigest: WorkerTerminalDigestV1 | null;
  state: string;
  updatedAt: string;
  runtimeReplanConsumeStatus: string;
  agentDispatchCapability: NormalizedSchedulerDispatchCapabilitySummary;
  scheduler: {
    agent_type: "worker-delivery" | "tester-ephemeral" | "audit-guard" | "unknown";
    queue_priority: number;
    retry_count: number;
    recovery_count: number;
    consecutive_failure_count: number;
    retry_backoff_until: string;
    last_dispatch_at: string;
    last_dispatch_mode: string;
    throttle_reason: string;
    recovery_hint: string;
    wait_age_seconds: number;
    dispatch_seq: number;
    recent_failure_rate: number;
    last_worker_lifecycle_result: "success" | "failure" | "";
    history_reload_hint: string;
    knowledge_handoff: {
      keeper_query_path: string;
      failure_pattern_summary_path: string;
      failure_pattern_index_refs: string[];
      last_terminal_digest_path: string;
      last_terminal_digest_observed_at: string;
    };
    inflight: {
      operation_id: string;
      dispatch_seq: number;
      requested_at: string;
      ack_at: string;
      last_heartbeat_at: string;
    };
    worker_execution: {
      milestones: string[];
      completed_targets: string[];
      detection_window_seconds: number;
      stage_write_stagnation_seconds: number;
      all_milestones_met: boolean;
      tester_ready: boolean;
      last_progress_at: string;
      last_checked_at: string;
      stall_checks: number;
    };
    degrade: {
      active: boolean;
      count: number;
      last_reason: string;
      last_applied_at: string;
      current_token_budget_cap: number;
      current_stage_write_budget_cap: number;
      last_stage_signature: string;
      last_stage_write_at: string;
    };
    escalation_bridge: {
      observed_fault_class: string;
      observed_fault_ticks: number;
      observed_stall_key: string;
      observed_stall_ticks: number;
      last_bridge_fingerprint: string;
      last_request_id: string;
      last_request_at: string;
      last_trigger: string;
    };
  };
  runtimeWorkerControl: {
    lastWorkerFaultAction: SchedulerFaultHandlingAction | "none";
    workerFaultRetryable: boolean;
    workerFaultRequiresRebuild: boolean;
    workerFaultClass: string;
    lastFaultActionApplied: SchedulerFaultHandlingAction | "none";
    faultActuationMode: SchedulerFaultActuationMode;
    faultActionBlockedByPolicy: boolean;
    archiveReady: boolean;
    reclaimReady: boolean;
    purgeReady: boolean;
    retentionDecision: string;
  };
};

function normalizeAgentType(value: unknown): TaskMeta["scheduler"]["agent_type"] {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "worker-delivery" || raw === "tester-ephemeral" || raw === "audit-guard"
    ? raw
    : "unknown";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeGateStatus(value: unknown): "not_applicable" | "allowed" | "blocked" {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "allowed" || raw === "blocked" ? raw : "not_applicable";
}

function normalizeSkillGateStatus(value: unknown): "allowed" | "blocked" {
  return typeof value === "string" && value.trim() === "blocked" ? "blocked" : "allowed";
}

function normalizeDispatchCapabilityClass(
  value: unknown,
): NormalizedSchedulerDispatchCapabilitySummary["dispatch_capability_class"] {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "tester_targeted" || raw === "audit_targeted" ? raw : "general";
}

export function normalizeAgentDispatchCapability(
  taskMeta: Record<string, unknown> | null | undefined,
  schedulerAgentType?: TaskMeta["scheduler"]["agent_type"],
): NormalizedSchedulerDispatchCapabilitySummary {
  const workerRuntime =
    taskMeta?.worker_runtime &&
    typeof taskMeta.worker_runtime === "object" &&
    !Array.isArray(taskMeta.worker_runtime)
      ? (taskMeta.worker_runtime as Record<string, unknown>)
      : {};
  const explicit =
    workerRuntime.agent_dispatch_capability &&
    typeof workerRuntime.agent_dispatch_capability === "object" &&
    !Array.isArray(workerRuntime.agent_dispatch_capability)
      ? (workerRuntime.agent_dispatch_capability as Record<string, unknown>)
      : null;
  if (explicit) {
    return {
      schema_version: "scheduler-agent-dispatch-capability-v1",
      allowed_agent_types: normalizeStringArray(explicit.allowed_agent_types),
      default_target_role_types: normalizeStringArray(explicit.default_target_role_types),
      selected_template_id: String(explicit.selected_template_id ?? "").trim(),
      selected_template_origin: String(explicit.selected_template_origin ?? "").trim(),
      custom_runtime_gate_status: normalizeGateStatus(explicit.custom_runtime_gate_status),
      custom_capability_gate_reason: String(explicit.custom_capability_gate_reason ?? "").trim(),
      skill_gate_status: normalizeSkillGateStatus(explicit.skill_gate_status),
      skill_gate_reason: String(explicit.skill_gate_reason ?? "").trim(),
      dispatch_capability_class: normalizeDispatchCapabilityClass(explicit.dispatch_capability_class),
      projection_source: "worker_runtime",
    };
  }

  if (Object.keys(workerRuntime).length > 0) {
    return {
      schema_version: "scheduler-agent-dispatch-capability-v1",
      allowed_agent_types: [],
      default_target_role_types: [],
      selected_template_id: "",
      selected_template_origin: "",
      custom_runtime_gate_status: "not_applicable",
      custom_capability_gate_reason: "",
      skill_gate_status: "blocked",
      skill_gate_reason: "gate_denied_by_missing_capability_summary",
      dispatch_capability_class: "general",
      projection_source: "missing",
    };
  }

  if (taskMeta && Object.keys(taskMeta).length > 0) {
    return {
      schema_version: "scheduler-agent-dispatch-capability-v1",
      allowed_agent_types: [],
      default_target_role_types: [],
      selected_template_id: "",
      selected_template_origin: "",
      custom_runtime_gate_status: "not_applicable",
      custom_capability_gate_reason: "",
      skill_gate_status: "blocked",
      skill_gate_reason: "gate_denied_by_missing_capability_summary",
      dispatch_capability_class: "general",
      projection_source: "missing",
    };
  }

  return {
    schema_version: "scheduler-agent-dispatch-capability-v1",
    allowed_agent_types: [],
    default_target_role_types: [],
    selected_template_id: "",
    selected_template_origin: "",
    custom_runtime_gate_status: "not_applicable",
    custom_capability_gate_reason: "",
    skill_gate_status: "blocked",
    skill_gate_reason: "gate_denied_by_missing_capability_summary",
    dispatch_capability_class: "general",
    projection_source: "missing",
  };
}

export function normalizeRuntimeReplan(
  value: Record<string, unknown> | null | undefined,
): {
  consume_status: string;
} {
  const raw =
    value?.runtime_replan &&
    typeof value.runtime_replan === "object" &&
    !Array.isArray(value.runtime_replan)
      ? (value.runtime_replan as Record<string, unknown>)
      : {};
  return {
    consume_status: String(raw.consume_status ?? "").trim(),
  };
}

function normalizeFaultAction(value: unknown): SchedulerFaultHandlingAction | "none" {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "retry" || raw === "rebuild" || raw === "reclaim" || raw === "block" ? raw : "none";
}

function normalizeFaultActuationMode(value: unknown): SchedulerFaultActuationMode {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "disabled" || raw === "enabled" ? raw : "summary_only";
}

export function normalizeRuntimeWorkerControl(
  value: ObserverViewV1 | Record<string, unknown> | null | undefined,
): TaskMeta["runtimeWorkerControl"] {
  const runtimeControl =
    value &&
    typeof value === "object" &&
    "runtime_control" in value &&
    value.runtime_control &&
    typeof value.runtime_control === "object" &&
    !Array.isArray(value.runtime_control)
      ? (value.runtime_control as Record<string, unknown>)
      : {};
  const lastWorkerFaultAction = normalizeFaultAction(runtimeControl.last_worker_fault_action);
  const lastFaultActionApplied = normalizeFaultAction(runtimeControl.last_fault_action_applied);
  const faultActuationMode = normalizeFaultActuationMode(runtimeControl.fault_actuation_mode);
  return {
    lastWorkerFaultAction,
    workerFaultRetryable: runtimeControl.worker_fault_retryable === true,
    workerFaultRequiresRebuild: runtimeControl.worker_fault_requires_rebuild === true,
    workerFaultClass: String(runtimeControl.worker_fault_class ?? "").trim(),
    lastFaultActionApplied,
    faultActuationMode,
    faultActionBlockedByPolicy: runtimeControl.fault_action_blocked_by_policy === true,
    archiveReady: runtimeControl.archive_ready === true,
    reclaimReady: runtimeControl.reclaim_ready === true,
    purgeReady: runtimeControl.purge_ready === true,
    retentionDecision: String(runtimeControl.retention_decision ?? "").trim(),
  };
}

export function normalizeScheduler(value: unknown): TaskMeta["scheduler"] {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const inflightRaw = raw.inflight && typeof raw.inflight === "object" && !Array.isArray(raw.inflight)
    ? (raw.inflight as Record<string, unknown>)
    : {};
  const workerExecutionRaw =
    raw.worker_execution &&
    typeof raw.worker_execution === "object" &&
    !Array.isArray(raw.worker_execution)
      ? (raw.worker_execution as Record<string, unknown>)
      : {};
  const degradeRaw =
    raw.degrade &&
    typeof raw.degrade === "object" &&
    !Array.isArray(raw.degrade)
      ? (raw.degrade as Record<string, unknown>)
      : {};
  const knowledgeHandoffRaw =
    raw.knowledge_handoff &&
    typeof raw.knowledge_handoff === "object" &&
    !Array.isArray(raw.knowledge_handoff)
      ? (raw.knowledge_handoff as Record<string, unknown>)
      : {};
  const escalationBridgeRaw =
    raw.escalation_bridge &&
    typeof raw.escalation_bridge === "object" &&
    !Array.isArray(raw.escalation_bridge)
      ? (raw.escalation_bridge as Record<string, unknown>)
      : {};

  const agentType = String(raw.agent_type ?? "unknown").trim();
  const normalizedAgentType =
    agentType === "worker-delivery" ||
    agentType === "tester-ephemeral" ||
    agentType === "audit-guard"
      ? (agentType as TaskMeta["scheduler"]["agent_type"])
      : "unknown";

  const retryCount = Number(raw.retry_count ?? 0);
  const queuePriority = Number(raw.queue_priority ?? 30);
  const recentFailureRate = Number(raw.recent_failure_rate ?? 0);

  return {
    agent_type: normalizedAgentType,
    queue_priority: Number.isFinite(queuePriority) ? Math.floor(queuePriority) : 30,
    retry_count: Number.isFinite(retryCount) ? Math.max(0, Math.floor(retryCount)) : 0,
    recovery_count: Number.isFinite(Number(raw.recovery_count))
      ? Math.max(0, Math.floor(Number(raw.recovery_count)))
      : 0,
    consecutive_failure_count: Number.isFinite(Number(raw.consecutive_failure_count))
      ? Math.max(0, Math.floor(Number(raw.consecutive_failure_count)))
      : Math.max(0, Math.floor(retryCount || 0)),
    retry_backoff_until: String(raw.retry_backoff_until ?? ""),
    last_dispatch_at: String(raw.last_dispatch_at ?? ""),
    last_dispatch_mode: String(raw.last_dispatch_mode ?? ""),
    throttle_reason: String(raw.throttle_reason ?? ""),
    recovery_hint: String(raw.recovery_hint ?? ""),
    wait_age_seconds: Number(raw.wait_age_seconds ?? 0),
    dispatch_seq: Number.isFinite(Number(raw.dispatch_seq))
      ? Math.max(0, Math.floor(Number(raw.dispatch_seq)))
      : 0,
    recent_failure_rate:
      Number.isFinite(recentFailureRate) && recentFailureRate >= 0
        ? Math.min(1, recentFailureRate)
        : 0,
    last_worker_lifecycle_result:
      String(raw.last_worker_lifecycle_result ?? "").trim() === "success"
        ? "success"
        : String(raw.last_worker_lifecycle_result ?? "").trim() === "failure"
          ? "failure"
          : "",
    history_reload_hint: String(raw.history_reload_hint ?? ""),
    knowledge_handoff: {
      keeper_query_path: String(knowledgeHandoffRaw.keeper_query_path ?? ""),
      failure_pattern_summary_path: String(knowledgeHandoffRaw.failure_pattern_summary_path ?? ""),
      failure_pattern_index_refs: Array.isArray(knowledgeHandoffRaw.failure_pattern_index_refs)
        ? knowledgeHandoffRaw.failure_pattern_index_refs.map((item) => String(item).trim()).filter(Boolean)
        : [],
      last_terminal_digest_path: String(knowledgeHandoffRaw.last_terminal_digest_path ?? ""),
      last_terminal_digest_observed_at: String(knowledgeHandoffRaw.last_terminal_digest_observed_at ?? ""),
    },
    inflight: {
      operation_id: String(inflightRaw.operation_id ?? ""),
      dispatch_seq: Number.isFinite(Number(inflightRaw.dispatch_seq))
        ? Math.max(0, Math.floor(Number(inflightRaw.dispatch_seq)))
        : 0,
      requested_at: String(inflightRaw.requested_at ?? ""),
      ack_at: String(inflightRaw.ack_at ?? ""),
      last_heartbeat_at: String(inflightRaw.last_heartbeat_at ?? ""),
    },
    worker_execution: {
      milestones: Array.isArray(workerExecutionRaw.milestones)
        ? workerExecutionRaw.milestones.map((item) => String(item).trim()).filter(Boolean)
        : ["task_complete"],
      completed_targets: Array.isArray(workerExecutionRaw.completed_targets)
        ? workerExecutionRaw.completed_targets.map((item) => String(item).trim()).filter(Boolean)
        : [],
      detection_window_seconds: Number.isFinite(Number(workerExecutionRaw.detection_window_seconds))
        ? Math.max(1, Math.floor(Number(workerExecutionRaw.detection_window_seconds)))
        : 300,
      stage_write_stagnation_seconds: Number.isFinite(Number(workerExecutionRaw.stage_write_stagnation_seconds))
        ? Math.max(1, Math.floor(Number(workerExecutionRaw.stage_write_stagnation_seconds)))
        : 120,
      all_milestones_met: workerExecutionRaw.all_milestones_met === true,
      tester_ready: workerExecutionRaw.tester_ready === true,
      last_progress_at: String(workerExecutionRaw.last_progress_at ?? ""),
      last_checked_at: String(workerExecutionRaw.last_checked_at ?? ""),
      stall_checks: Number.isFinite(Number(workerExecutionRaw.stall_checks))
        ? Math.max(0, Math.floor(Number(workerExecutionRaw.stall_checks)))
        : 0,
    },
    degrade: {
      active: degradeRaw.active === true,
      count: Number.isFinite(Number(degradeRaw.count)) ? Math.max(0, Math.floor(Number(degradeRaw.count))) : 0,
      last_reason: String(degradeRaw.last_reason ?? ""),
      last_applied_at: String(degradeRaw.last_applied_at ?? ""),
      current_token_budget_cap: Number.isFinite(Number(degradeRaw.current_token_budget_cap))
        ? Math.max(0, Math.floor(Number(degradeRaw.current_token_budget_cap)))
        : 0,
      current_stage_write_budget_cap: Number.isFinite(Number(degradeRaw.current_stage_write_budget_cap))
        ? Math.max(0, Math.floor(Number(degradeRaw.current_stage_write_budget_cap)))
        : 0,
      last_stage_signature: String(degradeRaw.last_stage_signature ?? ""),
      last_stage_write_at: String(degradeRaw.last_stage_write_at ?? ""),
    },
    escalation_bridge: {
      observed_fault_class: String(escalationBridgeRaw.observed_fault_class ?? ""),
      observed_fault_ticks: Number.isFinite(Number(escalationBridgeRaw.observed_fault_ticks))
        ? Math.max(0, Math.floor(Number(escalationBridgeRaw.observed_fault_ticks)))
        : 0,
      observed_stall_key: String(escalationBridgeRaw.observed_stall_key ?? ""),
      observed_stall_ticks: Number.isFinite(Number(escalationBridgeRaw.observed_stall_ticks))
        ? Math.max(0, Math.floor(Number(escalationBridgeRaw.observed_stall_ticks)))
        : 0,
      last_bridge_fingerprint: String(escalationBridgeRaw.last_bridge_fingerprint ?? ""),
      last_request_id: String(escalationBridgeRaw.last_request_id ?? ""),
      last_request_at: String(escalationBridgeRaw.last_request_at ?? ""),
      last_trigger: String(escalationBridgeRaw.last_trigger ?? ""),
    },
  };
}

export function computeAgeSeconds(iso: string): number {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}
