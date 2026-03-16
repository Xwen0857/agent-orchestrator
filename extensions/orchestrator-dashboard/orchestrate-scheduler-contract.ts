export type SchedulerExecutionMode = "local_threads" | "container" | "distributed";

export type SchedulerDecisionAuthorityLevel = "L0" | "L1" | "L2";
export type SchedulerDecisionAuthoritySource = "runtime_guard" | "planner" | "scheduler_kernel";
export type SchedulerOverrideScope =
  | "batch_selection"
  | "parallel_window"
  | "retry_policy"
  | "lane_route";

export type SchedulerDecisionAuthority = {
  level: SchedulerDecisionAuthorityLevel;
  source: SchedulerDecisionAuthoritySource;
  override_applied: boolean;
  override_reason: string;
  override_scope: SchedulerOverrideScope | "";
  override_ttl_ticks: number;
};

export type SchedulerRetryPolicy = {
  base_ms: number;
  max_ms: number;
  max_attempts: number;
};

export type SchedulerRecoveryPolicy = {
  max_attempts: number;
  token_uplift_ratio: number;
  stage_write_budget_uplift_ratio: number;
};

export type SchedulerDegradePolicy = {
  milestone_stall_window_seconds: number;
  milestone_stall_checks: number;
  stage_write_stagnation_seconds: number;
  token_budget_decay_ratio: number;
  stage_write_budget_decay_ratio: number;
};

export type SchedulerThrottlePolicy = {
  reserve_ratio: number;
};

export type SchedulerLaneQuotaPolicy = {
  recovery_min_share: number;
  retry_min_share: number;
  assigned_ready_min_share: number;
};

export type SchedulerAgingPolicy = {
  step_seconds: number;
  max_boost: number;
};

export type SchedulerAgentProfile = {
  base_weight: number;
  max_parallel_share: number;
  failure_penalty_weight: number;
};

export type SchedulerAgentProfileMap = {
  "worker-delivery": SchedulerAgentProfile;
  "tester-ephemeral": SchedulerAgentProfile;
  "audit-guard": SchedulerAgentProfile;
  unknown: SchedulerAgentProfile;
};

export type SchedulerAgentFlowId =
  | "selection_flow"
  | "retry_flow"
  | "recovery_flow"
  | "degrade_flow"
  | "lifecycle_flow"
  | "escalation_flow";

export type SchedulerAgentSkillId =
  | "selection-skill"
  | "retry-skill"
  | "recovery-skill"
  | "degrade-skill"
  | "lifecycle-skill"
  | "escalation-skill";

export type SchedulerAgentMainToolId =
  | "run_selection_tool"
  | "schedule_retry_tool"
  | "apply_recovery_tool"
  | "apply_degrade_tool"
  | "apply_lifecycle_tool"
  | "emit_escalation_tool";

export const SCHEDULER_PARAMETERIZED_MAIN_TOOLS = [
  "run_selection_tool",
  "schedule_retry_tool",
  "apply_recovery_tool",
  "apply_degrade_tool",
] as const satisfies ReadonlyArray<SchedulerAgentMainToolId>;

export const SCHEDULER_RIGID_MAIN_TOOLS = [
  "emit_escalation_tool",
  "apply_lifecycle_tool",
] as const satisfies ReadonlyArray<SchedulerAgentMainToolId>;

export type SchedulerAgentToolArgValue = string | number | boolean;

export type SchedulerAgentToolParameterRange = {
  min: number;
  max: number;
  default: number;
  agent_tunable: boolean;
  governance_locked: boolean;
};

export type SchedulerWorkflowTemplate = {
  flow_id: SchedulerAgentFlowId;
  default_skill: SchedulerAgentSkillId;
  default_main_tool: SchedulerAgentMainToolId;
  fixed_steps: string[];
};

export type SchedulerWorkflowBaseline = SchedulerWorkflowTemplate & {
  default_args: Record<string, SchedulerAgentToolArgValue>;
  tool_parameter_ranges: Record<string, SchedulerAgentToolParameterRange>;
};

export type SchedulerBaselineReference = {
  flow: SchedulerAgentFlowId | "";
  skill: SchedulerAgentSkillId | "";
  main_tool: SchedulerAgentMainToolId | "";
  args: Record<string, SchedulerAgentToolArgValue>;
};

export type SchedulerBaselineDecision = {
  baseline_flow: SchedulerAgentFlowId | "";
  baseline_skill: SchedulerAgentSkillId | "";
  baseline_main_tool: SchedulerAgentMainToolId | "";
  baseline_args: Record<string, SchedulerAgentToolArgValue>;
  decision_mode: "baseline_followed" | "baseline_bypassed" | "blocked";
  deviation_reason: string;
};

export type SchedulerAgentReasoningSummary = {
  baseline_status: "followed" | "bypassed" | "blocked";
  rationale: string;
  signals_used: string[];
  parameter_adjustments: string[];
};

export type SchedulerInferenceDivergenceRecordV1 = {
  schema_version: "scheduler-inference-divergence-record-v1";
  timestamp: string;
  event_id: string;
  baseline_reference: SchedulerBaselineReference;
  divergence_description: string;
  inference_summary: SchedulerAgentReasoningSummary;
  operation_summary: {
    selected_flow: SchedulerAgentFlowId | "";
    selected_skill: SchedulerAgentSkillId | "";
    selected_main_tool: SchedulerAgentMainToolId | "";
    selected_tool_args: Record<string, SchedulerAgentToolArgValue>;
  };
  downstream_impact_chain: string[];
  constraint_context: {
    hard_gates: string[];
    flow_combination_bans: string[];
    governance_locked_fields_ignored: string[];
  };
};

export type SchedulerObserverBridgeSummary = {
  active: boolean;
  request_count: number;
  packet_count: number;
  bridged_task_ids: string[];
  bridged_task_refs: Array<{
    task_id: string;
    request_id: string;
    fingerprint: string;
    trigger: string;
    request_path: string;
    packet_path: string;
    requested_at: string;
  }>;
  last_request_id: string;
  last_fingerprint: string;
  last_trigger: string;
  last_request_at: string;
  packet_path: string;
};

export type SchedulerAgentHeartbeatV1 = {
  schema_version: "scheduler-agent-heartbeat-v1";
  observed_signals: {
    candidate_count: number;
    throttled: boolean;
    runtime_consistency: "ok" | "mismatch" | "unknown";
    planner_gate_active: boolean;
    lifecycle_action_count: number;
    degrade_applied: number;
    observer_escalation_requests: number;
    observer_bridge_active: boolean;
    guard_skip_count: number;
  };
  observer_bridge: SchedulerObserverBridgeSummary;
  matched_constraints: {
    hard_gates: string[];
    flow_combination_bans: string[];
    tool_parameter_ranges: Record<string, SchedulerAgentToolParameterRange>;
  };
  selected_flow: SchedulerAgentFlowId | "";
  selected_skill: SchedulerAgentSkillId | "";
  selected_main_tool: SchedulerAgentMainToolId | "";
  selected_tool_args: Record<string, SchedulerAgentToolArgValue>;
  baseline_reference: SchedulerBaselineReference;
  baseline_flow: SchedulerAgentFlowId | "";
  baseline_skill: SchedulerAgentSkillId | "";
  baseline_main_tool: SchedulerAgentMainToolId | "";
  baseline_args: Record<string, SchedulerAgentToolArgValue>;
  baseline_bypassed: boolean;
  decision_mode: SchedulerBaselineDecision["decision_mode"];
  deviation_reason: string;
  reasoning_summary: SchedulerAgentReasoningSummary;
  execution_log_ref: string;
  reasoning_record_ref: string;
  why_this_skill: string;
  blocked_by: string[];
  execution_result: "idle" | "blocked" | "selected" | "completed" | "partial" | "maintenance_only";
  next_tick_hint: string;
};

export type SchedulerMainToolInvocation = {
  selected_flow: SchedulerAgentFlowId | "";
  selected_skill: SchedulerAgentSkillId | "";
  selected_main_tool: SchedulerAgentMainToolId | "";
  selected_tool_args: Record<string, SchedulerAgentToolArgValue>;
  tool_parameter_ranges: Record<string, SchedulerAgentToolParameterRange>;
  reasoning_summary: SchedulerAgentReasoningSummary;
  why_this_skill: string;
  blocked_by: string[];
  flow_combination_bans: string[];
};

export type SchedulerDistributedQueueConfig = {
  root: string;
  request_topic: string;
  ack_topic: string;
  result_topic: string;
  heartbeat_topic: string;
  visibility_timeout_ms: number;
  heartbeat_timeout_ms: number;
};

export type SchedulerDistributedConsumerConfig = {
  idempotency_max_keys: number;
  idempotency_ttl_ms: number;
};

export type SchedulerRollbackGuard = {
  max_consecutive_tick_failures: number;
  min_dispatch_success_rate: number;
  max_queue_depth_growth: number;
};

export type SchedulerFaultActuationMode = "disabled" | "summary_only" | "enabled";
export type SchedulerFaultHandlingAction = "retry" | "rebuild" | "reclaim" | "block";
export type SchedulerArtifactLifecycleActuationMode = "disabled" | "summary_only" | "enabled";
export type SchedulerArtifactLifecycleAction = "archive" | "purge" | "reclaim";

export type SchedulerWorkerFaultPolicy = {
  fault_actuation_mode: SchedulerFaultActuationMode;
  allow_retry: boolean;
  allow_rebuild: boolean;
  allow_reclaim: boolean;
  allow_block: boolean;
};

export type SchedulerArtifactLifecyclePolicy = {
  actuation_mode: SchedulerArtifactLifecycleActuationMode;
  allow_archive: boolean;
  allow_purge: boolean;
  allow_reclaim: boolean;
};

export type SchedulerConfigV1 = {
  schema_version: "scheduler-config-v1";
  scheduler_kernel_v2_enabled: boolean;
  strategy: "legacy_script" | "kernel_v2";
  retry: SchedulerRetryPolicy;
  recovery: SchedulerRecoveryPolicy;
  degrade: SchedulerDegradePolicy;
  throttle: SchedulerThrottlePolicy;
  lane_quota: SchedulerLaneQuotaPolicy;
  aging: SchedulerAgingPolicy;
  agent_profiles: SchedulerAgentProfileMap;
  stale_in_progress_minutes: number;
  container: {
    execute: boolean;
  };
  distributed: {
    at_least_once: true;
    idempotency_scope: "task_id+dispatch_seq+operation_id";
    queue: SchedulerDistributedQueueConfig;
    consumer: SchedulerDistributedConsumerConfig;
  };
  worker_fault_policy: SchedulerWorkerFaultPolicy;
  artifact_lifecycle_policy: SchedulerArtifactLifecyclePolicy;
  rollback_guard: SchedulerRollbackGuard;
};

export type SchedulerRequestV1 = {
  schema_version: "scheduler-request-v1";
  request_id: string;
  mode: SchedulerExecutionMode;
  tasks_root: string;
  max_parallel: number;
  max_tasks: number;
  runtime_guard: {
    runtime_consistency: "ok" | "mismatch" | "unknown";
  };
  queue_snapshot: {
    candidates: number;
    now: string;
  };
  replan_guard: {
    pause_and_require_replan_count: number;
    awaiting_revalidation_count: number;
  };
  decision_authority: SchedulerDecisionAuthority;
  lane_quota_snapshot: {
    recovery_min_share: number;
    retry_min_share: number;
    assigned_ready_min_share: number;
  };
  agent_control: {
    role: "scheduler-agent";
    mode: "control_agent_v1";
    heartbeat_schema_version: "scheduler-agent-heartbeat-v1";
  };
};

export type SchedulerDecisionTask = {
  task_id: string;
  from_state: string;
  action: "recover" | "retry" | "dispatch" | "skip";
  reason: string;
  lane:
    | "recovery"
    | "retry"
    | "assigned_ready"
    | "paused_by_replan"
    | "awaiting_revalidation"
    | "unsupported";
  operation_id?: string;
};

export type SchedulerFlowPlan = SchedulerMainToolInvocation & {
  selected: SchedulerDecisionTask[];
  deferred: SchedulerDecisionTask[];
};

export type SchedulerScoringBreakdown = {
  task_id: string;
  lane: string;
  lane_base: number;
  queue_priority: number;
  age_boost: number;
  retry_penalty: number;
  agent_profile_boost: number;
  failure_penalty: number;
  total: number;
};

export type SchedulerInflightSummary = {
  total: number;
  timed_out: number;
  acked: number;
  failed_results: number;
  heartbeat_expired: number;
};

export type SchedulerDecisionV1 = {
  schema_version: "scheduler-decision-v1";
  request_id: string;
  selected: SchedulerDecisionTask[];
  skipped: SchedulerDecisionTask[];
  throttled: boolean;
  parallel_limit: number;
  queue_depth: number;
  decision_authority: SchedulerDecisionAuthority;
  scoring_breakdown: SchedulerScoringBreakdown[];
  inflight_summary: SchedulerInflightSummary;
  agent_heartbeat: SchedulerAgentHeartbeatV1;
  summary: {
    selected_count: number;
    execution_attempted_count: number;
    guard_skip_count: number;
    advanced: number;
    failed: number;
    dispatch_attempts: number;
    dispatch_successes: number;
    recover_successes: number;
    retry_scheduled: number;
    recovery_applied: number;
    degrade_applied: number;
    observer_escalation_requests: number;
    observer_bridge_packets: number;
    observer_bridge: SchedulerObserverBridgeSummary;
    paused_by_replan: number;
    last_fault_action_applied: SchedulerFaultHandlingAction | "none";
    fault_actuation_mode: SchedulerFaultActuationMode;
    fault_action_blocked_by_policy: boolean;
    worker_fault_class: string;
  };
};

export type SchedulerDispatchEventV1 = {
  schema_version: "scheduler-dispatch-event-v1";
  event_id: string;
  timestamp: string;
  action:
    | "SCHEDULER_DISPATCH_SELECTED"
    | "SCHEDULER_DISPATCH_SKIPPED"
    | "SCHEDULER_RETRY_SCHEDULED"
    | "SCHEDULER_THROTTLED"
    | "SCHEDULER_RECOVERY_APPLIED"
    | "SCHEDULER_OVERRIDE_APPLIED"
    | "SCHEDULER_OVERRIDE_REJECTED"
    | "SCHEDULER_FAULT_ACTION_APPLIED"
    | "SCHEDULER_FAULT_ACTION_DEFERRED"
    | "SCHEDULER_FAULT_ACTION_BLOCKED"
    | "SCHEDULER_ARTIFACT_LIFECYCLE_APPLIED"
    | "SCHEDULER_ARTIFACT_LIFECYCLE_DEFERRED"
    | "SCHEDULER_ARTIFACT_LIFECYCLE_BLOCKED";
  task_id?: string;
  operation_id?: string;
  detail: string;
};

export function extractSchedulerConfig(raw: Record<string, unknown> | null | undefined): SchedulerConfigV1 {
  const root =
    raw && raw.scheduler && typeof raw.scheduler === "object" && !Array.isArray(raw.scheduler)
      ? (raw.scheduler as Record<string, unknown>)
      : {};
  const retry = extractObject(root.retry);
  const recovery = extractObject(root.recovery);
  const degrade = extractObject(root.degrade);
  const throttle = extractObject(root.throttle);
  const laneQuota = extractObject(root.lane_quota);
  const aging = extractObject(root.aging);
  const agentProfiles = extractObject(root.agent_profiles);
  const distributed = extractObject(root.distributed);
  const queue = extractObject(distributed.queue);
  const consumer = extractObject(distributed.consumer);
  const container = extractObject(root.container);
  const workerFaultPolicy = extractObject(root.worker_fault_policy);
  const artifactLifecyclePolicy = extractObject(root.artifact_lifecycle_policy);
  const rollbackGuard = extractObject(root.rollback_guard);

  const strategyRaw = String(root.strategy ?? "legacy_script").trim();
  const strategy = strategyRaw === "kernel_v2" ? "kernel_v2" : "legacy_script";
  const faultActuationModeRaw = String(workerFaultPolicy.fault_actuation_mode ?? "summary_only").trim();
  const faultActuationMode: SchedulerFaultActuationMode =
    faultActuationModeRaw === "disabled" || faultActuationModeRaw === "enabled"
      ? faultActuationModeRaw
      : "summary_only";
  const artifactActuationModeRaw = String(artifactLifecyclePolicy.actuation_mode ?? "summary_only").trim();
  const artifactActuationMode: SchedulerArtifactLifecycleActuationMode =
    artifactActuationModeRaw === "disabled" || artifactActuationModeRaw === "enabled"
      ? artifactActuationModeRaw
      : "summary_only";

  return {
    schema_version: "scheduler-config-v1",
    scheduler_kernel_v2_enabled: root.scheduler_kernel_v2_enabled === true || strategy === "kernel_v2",
    strategy,
    retry: {
      base_ms: asPositiveInt(retry.base_ms, 2000),
      max_ms: asPositiveInt(retry.max_ms, 60000),
      max_attempts: asPositiveInt(retry.max_attempts, 3),
    },
    recovery: {
      max_attempts: asPositiveInt(recovery.max_attempts, 3),
      token_uplift_ratio: asRatio(recovery.token_uplift_ratio, 0.25),
      stage_write_budget_uplift_ratio: asRatio(recovery.stage_write_budget_uplift_ratio, 0.25),
    },
    degrade: {
      milestone_stall_window_seconds: asPositiveInt(degrade.milestone_stall_window_seconds, 300),
      milestone_stall_checks: asPositiveInt(degrade.milestone_stall_checks, 3),
      stage_write_stagnation_seconds: asPositiveInt(degrade.stage_write_stagnation_seconds, 120),
      token_budget_decay_ratio: asRatio(degrade.token_budget_decay_ratio, 0.2),
      stage_write_budget_decay_ratio: asRatio(degrade.stage_write_budget_decay_ratio, 0.2),
    },
    throttle: {
      reserve_ratio: asRatio(throttle.reserve_ratio, 0.25),
    },
    lane_quota: {
      recovery_min_share: asRatio(laneQuota.recovery_min_share, 0.2),
      retry_min_share: asRatio(laneQuota.retry_min_share, 0.2),
      assigned_ready_min_share: asRatio(laneQuota.assigned_ready_min_share, 0.4),
    },
    aging: {
      step_seconds: asPositiveInt(aging.step_seconds, 60),
      max_boost: asPositiveInt(aging.max_boost, 60),
    },
    agent_profiles: {
      "worker-delivery": extractAgentProfile(agentProfiles["worker-delivery"], {
        base_weight: 20,
        max_parallel_share: 0.7,
        failure_penalty_weight: 20,
      }),
      "tester-ephemeral": extractAgentProfile(agentProfiles["tester-ephemeral"], {
        base_weight: 12,
        max_parallel_share: 0.5,
        failure_penalty_weight: 12,
      }),
      "audit-guard": extractAgentProfile(agentProfiles["audit-guard"], {
        base_weight: 8,
        max_parallel_share: 0.4,
        failure_penalty_weight: 8,
      }),
      unknown: extractAgentProfile(agentProfiles.unknown, {
        base_weight: 6,
        max_parallel_share: 0.3,
        failure_penalty_weight: 10,
      }),
    },
    stale_in_progress_minutes: asPositiveInt(root.stale_in_progress_minutes, 60),
    container: {
      execute: container.execute === true,
    },
    distributed: {
      at_least_once: true,
      idempotency_scope: "task_id+dispatch_seq+operation_id",
      queue: {
        root: String(queue.root ?? "runtime/scheduler-queue"),
        request_topic: String(queue.request_topic ?? "scheduler.dispatch.request"),
        ack_topic: String(queue.ack_topic ?? "scheduler.dispatch.ack"),
        result_topic: String(queue.result_topic ?? "scheduler.dispatch.result"),
        heartbeat_topic: String(queue.heartbeat_topic ?? "scheduler.worker.heartbeat"),
        visibility_timeout_ms: asPositiveInt(queue.visibility_timeout_ms, 30000),
        heartbeat_timeout_ms: asPositiveInt(queue.heartbeat_timeout_ms, 45000),
      },
      consumer: {
        idempotency_max_keys: asPositiveInt(consumer.idempotency_max_keys, 10000),
        idempotency_ttl_ms: asPositiveInt(consumer.idempotency_ttl_ms, 24 * 60 * 60 * 1000),
      },
    },
    worker_fault_policy: {
      fault_actuation_mode: faultActuationMode,
      allow_retry: workerFaultPolicy.allow_retry !== false,
      allow_rebuild: workerFaultPolicy.allow_rebuild !== false,
      allow_reclaim: workerFaultPolicy.allow_reclaim !== false,
      allow_block: workerFaultPolicy.allow_block !== false,
    },
    artifact_lifecycle_policy: {
      actuation_mode: artifactActuationMode,
      allow_archive: artifactLifecyclePolicy.allow_archive !== false,
      allow_purge: artifactLifecyclePolicy.allow_purge !== false,
      allow_reclaim: artifactLifecyclePolicy.allow_reclaim !== false,
    },
    rollback_guard: {
      max_consecutive_tick_failures: asPositiveInt(rollbackGuard.max_consecutive_tick_failures, 5),
      min_dispatch_success_rate: asRatio(rollbackGuard.min_dispatch_success_rate, 0.6),
      max_queue_depth_growth: asPositiveInt(rollbackGuard.max_queue_depth_growth, 200),
    },
  };
}

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractAgentProfile(value: unknown, fallback: SchedulerAgentProfile): SchedulerAgentProfile {
  const profile = extractObject(value);
  return {
    base_weight: asInt(profile.base_weight, fallback.base_weight),
    max_parallel_share: asRatio(profile.max_parallel_share, fallback.max_parallel_share),
    failure_penalty_weight: asInt(profile.failure_penalty_weight, fallback.failure_penalty_weight),
  };
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const normalized = Math.floor(n);
  return normalized > 0 ? normalized : fallback;
}

function asInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.floor(n);
}

function asRatio(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 0.95) {
    return fallback;
  }
  return n;
}
