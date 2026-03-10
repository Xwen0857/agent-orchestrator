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

export type SchedulerConfigV1 = {
  schema_version: "scheduler-config-v1";
  scheduler_kernel_v2_enabled: boolean;
  strategy: "kernel_v2";
  retry: SchedulerRetryPolicy;
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
  agent_profile_snapshot: SchedulerAgentProfileMap;
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
  summary: {
    processed: number;
    advanced: number;
    failed: number;
    dispatch_attempts: number;
    dispatch_successes: number;
    recover_successes: number;
    retry_scheduled: number;
    recovery_applied: number;
    paused_by_replan: number;
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
    | "SCHEDULER_OVERRIDE_REJECTED";
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
  const throttle = extractObject(root.throttle);
  const laneQuota = extractObject(root.lane_quota);
  const aging = extractObject(root.aging);
  const agentProfiles = extractObject(root.agent_profiles);
  const distributed = extractObject(root.distributed);
  const queue = extractObject(distributed.queue);
  const consumer = extractObject(distributed.consumer);
  const container = extractObject(root.container);
  const rollbackGuard = extractObject(root.rollback_guard);

  return {
    schema_version: "scheduler-config-v1",
    // Legacy script fallback remains an internal runner rollback path only.
    scheduler_kernel_v2_enabled: true,
    strategy: "kernel_v2",
    retry: {
      base_ms: asPositiveInt(retry.base_ms, 2000),
      max_ms: asPositiveInt(retry.max_ms, 60000),
      max_attempts: asPositiveInt(retry.max_attempts, 4),
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
