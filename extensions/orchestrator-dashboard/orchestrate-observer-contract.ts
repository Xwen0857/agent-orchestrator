import { buildObserverRefinementPacket as buildObserverRefinementPacketImpl } from "./orchestrate-observer-bridge-packet-builder.js";
import { buildObserverView as buildObserverViewImpl } from "./orchestrate-observer-runtime-page-builder.js";
import { buildWorkerTerminalDigest as buildWorkerTerminalDigestImpl } from "./orchestrate-observer-terminal-digest-builder.js";

export type ObserverViewHealth = "ok" | "missing_runtime" | "missing_stage" | "partial";

export type SchedulerEscalationTrigger =
  | "retry_exhausted"
  | "recovery_exhausted"
  | "rebuild_exhausted"
  | "reclaim_exhausted"
  | "persistent_fault"
  | "persistent_stall";

export type SchedulerEscalationAttempt = {
  kind: "retry" | "recovery" | "fault_action" | "reclaim" | "budget";
  status: "attempted" | "applied" | "requested" | "observed";
  detail: string;
};

export type SchedulerEscalationRefinementSignal = {
  necessity_tier: "medium" | "high" | "critical";
  necessity_fingerprint: string;
};

export type SchedulerEscalationRequestV1 = {
  schema_version: "scheduler-escalation-request-v1";
  requested_at: string;
  task_id: string;
  request_id: string;
  trigger: SchedulerEscalationTrigger;
  scheduler_context: {
    retry_count: number;
    recovery_count: number;
    consecutive_failure_count: number;
    last_dispatch_mode: string;
    recent_failure_rate: number;
    last_recovery_hint: string;
    dispatch_seq: number;
    last_worker_lifecycle_result: "success" | "failure" | "";
  };
  observation_snapshot: {
    has_worker_fault: boolean;
    fault_class: string;
    convergence_class: string;
    budget_lane: string;
    retention_decision: string;
    rebuild_ready: boolean;
    archive_ready: boolean;
    reclaim_ready: boolean;
    purge_ready: boolean;
    observation_health: ObserverViewHealth;
    last_fault_action_applied: string;
    fault_action_blocked_by_policy: boolean;
    all_milestones_met: boolean;
    milestone_target_count: number;
    completed_milestone_count: number;
    current_instance_degraded: boolean;
  };
  attempt_history: SchedulerEscalationAttempt[];
  failure_summary: {
    fault_class: string;
    convergence_class: string;
    budget_lane: string;
    retention_decision: string;
    blocked_reasons: string[];
    current_instance_degraded: boolean;
  };
  refinement_signal: SchedulerEscalationRefinementSignal;
  evidence: {
    paths: string[];
  };
  routing_indexes: {
    module_id: string;
    refinement_task_id: string;
    worker_instance_id: string;
    failure_chain_id: string;
  };
  evidence_indexes: {
    terminal_digest_path: string;
    raw_log_index_path: string;
    observer_view_path: string;
  };
  bridge_fingerprint: string;
};

export type ObserverRefinementPacketV1 = {
  schema_version: "observer-refinement-packet-v1";
  observed_at: string;
  task_id: string;
  request_id: string;
  bridge_fingerprint: string;
  escalation_reason: SchedulerEscalationTrigger;
  execution_exhaustion: {
    retry_count: number;
    recovery_count: number;
    consecutive_failure_count: number;
    last_dispatch_mode: string;
    last_recovery_hint: string;
    dispatch_seq: number;
    last_worker_lifecycle_result: "success" | "failure" | "";
    attempts: SchedulerEscalationAttempt[];
  };
  runtime_summary: {
    has_worker_fault: boolean;
    fault_class: string;
    convergence_class: string;
    budget_lane: string;
    retention_decision: string;
    blocked_reasons: string[];
    observation_health: ObserverViewHealth;
    all_milestones_met: boolean;
    milestone_target_count: number;
    completed_milestone_count: number;
    current_instance_degraded: boolean;
  };
  refinement_signal: SchedulerEscalationRefinementSignal;
  routing_indexes: {
    module_id: string;
    refinement_task_id: string;
    worker_instance_id: string;
    failure_chain_id: string;
  };
  evidence_bundle: {
    paths: string[];
    terminal_digest_path: string;
    raw_log_index_path: string;
    observer_view_path: string;
    attempt_count: number;
    blocked_reason_count: number;
  };
  core_ingress_hint: {
    re_refinement_candidate: true;
  };
};

export type ObserverRuntimePageV1 = {
  page_id: "runtime";
  observed_at: string;
  task_id: string;
  runtime: Record<string, unknown>;
  worker_stage: Record<string, unknown>;
  runtime_control: Record<string, unknown>;
  worker_budget: Record<string, unknown>;
  worker_convergence: Record<string, unknown>;
  task_cluster: Record<string, unknown>;
  derived: ObserverViewV1["derived"];
};

export type ObserverTerminalPageV1 = {
  page_id: "terminal";
  observed_at: string;
  task_id: string;
  available: boolean;
  lifecycle_result: "success" | "failure" | "";
  digest_path: string;
  raw_log_index_path: string;
  terminal_page_fingerprint: string;
};

export type ObserverViewV1 = {
  schema_version: "observer-view-v1";
  observed_at: string;
  task_id: string;
  runtime: Record<string, unknown>;
  worker_stage: Record<string, unknown>;
  runtime_control: Record<string, unknown>;
  worker_budget: Record<string, unknown>;
  worker_convergence: Record<string, unknown>;
  task_cluster: Record<string, unknown>;
  terminal: {
    available: boolean;
    lifecycle_result: "success" | "failure" | "";
    digest_path: string;
    raw_log_index_path: string;
    observed_at: string;
  };
  derived: {
    has_worker_fault: boolean;
    fault_class: string;
    rebuild_ready: boolean;
    archive_ready: boolean;
    reclaim_ready: boolean;
    purge_ready: boolean;
    retention_decision: string;
    convergence_class: string;
    budget_lane: string;
    all_milestones_met: boolean;
    milestone_target_count: number;
    completed_milestone_count: number;
    current_instance_degraded: boolean;
    observation_health: ObserverViewHealth;
  };
};

export type WorkerRawLogIndexV1 = {
  schema_version: "worker-raw-log-index-v1";
  indexed_at: string;
  task_id: string;
  worker_instance_id: string;
  worker_stage_root: string;
  entries: Array<{
    slot: string;
    path: string;
    size_bytes: number;
    updated_at: string;
  }>;
  indexed_paths: string[];
};

export type WorkerTerminalDigestV1 = {
  schema_version: "worker-terminal-digest-v1";
  observed_at: string;
  task_id: string;
  worker_instance_id: string;
  lifecycle_result: "success" | "failure";
  milestones: {
    target_count: number;
    completed_count: number;
    all_required_met: boolean;
  };
  resources: {
    token_cost_used: number;
    budget_lane: string;
    worker_stage_bytes_used: number;
    worker_stage_file_count: number;
  };
  progress: {
    last_progress_at: string;
    recent_stage_write: boolean;
    convergence_class: string;
  };
  stage_snapshot: {
    overflow_status: string;
    retention_decision: string;
    archive_ready: boolean;
    reclaim_ready: boolean;
    purge_ready: boolean;
    last_fault_class: string;
  };
  evidence: {
    raw_log_index_path: string;
    paths: string[];
  };
};

export function buildObserverView(params: {
  taskMeta: Record<string, unknown>;
  now?: string;
}): ObserverViewV1 {
  return buildObserverViewImpl(params);
}

export function buildWorkerTerminalDigest(params: {
  taskMeta: Record<string, unknown>;
  rawLogIndexPath: string;
  evidencePaths: string[];
  now?: string;
}): WorkerTerminalDigestV1 | null {
  return buildWorkerTerminalDigestImpl(params);
}

export function buildObserverRefinementPacket(params: {
  schedulerEscalationRequest: SchedulerEscalationRequestV1 | Record<string, unknown>;
  now?: string;
}): ObserverRefinementPacketV1 {
  return buildObserverRefinementPacketImpl(params);
}
