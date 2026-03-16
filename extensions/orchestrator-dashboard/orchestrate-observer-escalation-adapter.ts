import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import {
  buildObserverRefinementPacket,
  type ObserverViewV1,
  type SchedulerEscalationAttempt,
  type SchedulerEscalationRequestV1,
  type SchedulerEscalationTrigger,
} from "./orchestrate-observer-contract.js";

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeFaultAction(value: unknown): "retry" | "rebuild" | "reclaim" | "block" | "none" {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "retry" || raw === "rebuild" || raw === "reclaim" || raw === "block" ? raw : "none";
}

function stableJsonFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.keys(entry)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (entry as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return entry;
  });
  return createHash("sha1").update(serialized).digest("hex");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectEvidencePaths(taskDir: string): Promise<string[]> {
  const candidates = [
    "work.md",
    "observer_view.json",
    "worker_terminal_digest.json",
    "worker_runtime_view.json",
    "worker_failure_pattern_summary.json",
    "scheduler_keeper_assembly_query.json",
    "delivery.export-records.json",
    "test.md",
  ];
  const paths: string[] = [];
  for (const relativePath of candidates) {
    if (await pathExists(path.join(taskDir, relativePath))) {
      paths.push(relativePath);
    }
  }
  return paths;
}

function deriveEscalationRoutingIndexes(input: {
  task: {
    taskId: string;
    observerView: ObserverViewV1 | null;
    terminalDigest: { worker_instance_id: string } | null;
    scheduler: { consecutive_failure_count: number };
  };
}): SchedulerEscalationRequestV1["routing_indexes"] {
  const observerRuntime = extractObject(input.task.observerView?.runtime ?? {});
  const refinementRouteRef = extractObject(observerRuntime.refinement_route_ref);
  return {
    module_id: String(refinementRouteRef.module_id ?? "").trim(),
    refinement_task_id: String(refinementRouteRef.refinement_task_id ?? "").trim() || input.task.taskId,
    worker_instance_id:
      input.task.terminalDigest?.worker_instance_id ||
      String(extractObject(input.task.observerView?.worker_stage ?? {}).worker_stage_id ?? "").trim(),
    failure_chain_id: `failure_chain_${input.task.taskId}_${Math.max(1, input.task.scheduler.consecutive_failure_count)}`,
  };
}

export type SchedulerEscalationConditionDetection = {
  nextBridgeState: {
    observed_fault_class: string;
    observed_fault_ticks: number;
    observed_stall_key: string;
    observed_stall_ticks: number;
    last_bridge_fingerprint: string;
    last_request_id: string;
    last_request_at: string;
    last_trigger: string;
  };
  trigger: SchedulerEscalationTrigger | null;
  context: null | {
    faultClass: string;
    convergenceClass: string;
    budgetLane: string;
    retentionDecision: string;
    blockedReasons: string[];
    attemptHistory: SchedulerEscalationAttempt[];
    fingerprint: string;
    routingIndexes: SchedulerEscalationRequestV1["routing_indexes"];
  };
};

export async function detectSatisfiedSchedulerEscalationCondition(input: {
  task: {
    taskId: string;
    taskDir: string;
    observerView: ObserverViewV1 | null;
    terminalDigest: { worker_instance_id: string } | null;
    scheduler: {
      retry_count: number;
      recovery_count: number;
      consecutive_failure_count: number;
      last_dispatch_mode: string;
      recent_failure_rate: number;
      recovery_hint: string;
      dispatch_seq: number;
      last_worker_lifecycle_result: "success" | "failure" | "";
      throttle_reason: string;
      degrade: { active: boolean };
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
  };
  taskMeta: Record<string, unknown>;
  observerView: ObserverViewV1;
  schedulerConfig: SchedulerConfigV1;
}): Promise<SchedulerEscalationConditionDetection> {
  const scheduler = input.task.scheduler;
  const runtimeControl = extractObject(input.taskMeta.runtime_worker_control);
  const workerConvergence = extractObject(input.taskMeta.worker_convergence);
  const state = String(input.taskMeta.state ?? "").trim();
  const faultClass = input.observerView.derived.fault_class.trim();
  const convergenceClass = input.observerView.derived.convergence_class.trim();
  const budgetLane = input.observerView.derived.budget_lane.trim();
  const retentionDecision = input.observerView.derived.retention_decision.trim();
  const reclaimReason = String(workerConvergence.reclaim_reason ?? "").trim();
  const lastFaultActionApplied = normalizeFaultAction(runtimeControl.last_fault_action_applied);
  const lastWorkerFaultAction = normalizeFaultAction(runtimeControl.last_worker_fault_action);
  const effectiveFaultAction =
    lastFaultActionApplied !== "none" ? lastFaultActionApplied : lastWorkerFaultAction;
  const reclaimRequestedAt = String(runtimeControl.reclaim_requested_at ?? "").trim();
  const previous = scheduler.escalation_bridge;
  const nextFaultTicks = faultClass
    ? previous.observed_fault_class === faultClass
      ? previous.observed_fault_ticks + 1
      : 1
    : 0;
  const stallKey =
    convergenceClass === "stalled" ? `${convergenceClass}:${reclaimReason || "none"}:${budgetLane || "fast"}` : "";
  const nextStallTicks = stallKey
    ? previous.observed_stall_key === stallKey
      ? previous.observed_stall_ticks + 1
      : 1
    : 0;

  let trigger: SchedulerEscalationTrigger | null = null;
  if (
    state === "REJECTED" &&
    scheduler.retry_count >= input.schedulerConfig.retry.max_attempts &&
    scheduler.recovery_count >= input.schedulerConfig.recovery.max_attempts
  ) {
    trigger = "recovery_exhausted";
  } else if (
    state === "REJECTED" &&
    scheduler.retry_count >= input.schedulerConfig.retry.max_attempts &&
    scheduler.recovery_count === 0
  ) {
    trigger = "retry_exhausted";
  } else if (state === "BLOCKED_SYSTEM_ERROR" && scheduler.recovery_hint && nextStallTicks >= 2) {
    trigger = "recovery_exhausted";
  } else if (effectiveFaultAction === "rebuild" && faultClass && nextFaultTicks >= 2) {
    trigger = "rebuild_exhausted";
  } else if ((effectiveFaultAction === "reclaim" || reclaimRequestedAt) && nextStallTicks >= 2) {
    trigger = "reclaim_exhausted";
  } else if (faultClass && nextFaultTicks >= 2 && effectiveFaultAction !== "none") {
    trigger = "persistent_fault";
  } else if (
    convergenceClass === "stalled" &&
    nextStallTicks >= 2 &&
    (scheduler.recovery_hint || reclaimRequestedAt || effectiveFaultAction === "reclaim")
  ) {
    trigger = "persistent_stall";
  }

  const nextBridgeState = {
    observed_fault_class: faultClass,
    observed_fault_ticks: nextFaultTicks,
    observed_stall_key: stallKey,
    observed_stall_ticks: nextStallTicks,
    last_bridge_fingerprint: previous.last_bridge_fingerprint,
    last_request_id: previous.last_request_id,
    last_request_at: previous.last_request_at,
    last_trigger: previous.last_trigger,
  };
  if (!trigger) {
    return {
      nextBridgeState,
      trigger: null,
      context: null,
    };
  }

  const blockedReasons = [
    runtimeControl.fault_action_blocked_by_policy === true ? "fault_action_blocked_by_policy" : "",
    String(input.taskMeta.last_error ?? "").trim(),
    scheduler.throttle_reason.trim(),
  ].filter(Boolean);
  const attemptHistory: SchedulerEscalationAttempt[] = [];
  if (scheduler.retry_count > 0) {
    attemptHistory.push({ kind: "retry", status: "attempted", detail: `retry_count=${scheduler.retry_count}` });
  }
  if (scheduler.recovery_hint) {
    attemptHistory.push({ kind: "recovery", status: "attempted", detail: scheduler.recovery_hint });
  }
  if (effectiveFaultAction !== "none") {
    attemptHistory.push({
      kind: "fault_action",
      status: lastFaultActionApplied !== "none" ? "applied" : "requested",
      detail: `${effectiveFaultAction}:${faultClass || "unspecified"}`,
    });
  }
  if (reclaimRequestedAt) {
    attemptHistory.push({ kind: "reclaim", status: "requested", detail: "worker_stage_reclaim_requested" });
  }
  if (budgetLane) {
    attemptHistory.push({ kind: "budget", status: "observed", detail: budgetLane });
  }

  const fingerprint = stableJsonFingerprint({
    task_id: input.task.taskId,
    trigger,
    fault_class: faultClass,
    convergence_class: convergenceClass,
    budget_lane: budgetLane,
    retention_decision: retentionDecision,
    attempt_history: attemptHistory,
  });
  if (fingerprint === previous.last_bridge_fingerprint) {
    return {
      nextBridgeState,
      trigger: null,
      context: null,
    };
  }

  return {
    nextBridgeState,
    trigger,
    context: {
      faultClass,
      convergenceClass,
      budgetLane,
      retentionDecision,
      blockedReasons,
      attemptHistory,
      fingerprint,
      routingIndexes: deriveEscalationRoutingIndexes({ task: input.task }),
    },
  };
}

export async function buildEscalationBridgeArtifacts(input: {
  task: {
    taskId: string;
    taskDir: string;
    observerView: ObserverViewV1 | null;
    scheduler: {
      retry_count: number;
      recovery_count: number;
      consecutive_failure_count: number;
      last_dispatch_mode: string;
      recent_failure_rate: number;
      recovery_hint: string;
      dispatch_seq: number;
      last_worker_lifecycle_result: "success" | "failure" | "";
      degrade: { active: boolean };
    };
  };
  taskMeta: Record<string, unknown>;
  observerView: ObserverViewV1;
  nextBridgeState: SchedulerEscalationConditionDetection["nextBridgeState"];
  trigger: SchedulerEscalationTrigger;
  context: NonNullable<SchedulerEscalationConditionDetection["context"]>;
}): Promise<{
  bridgeStatePatch: SchedulerEscalationConditionDetection["nextBridgeState"];
  request: SchedulerEscalationRequestV1;
  packet: ReturnType<typeof buildObserverRefinementPacket>;
}> {
  const refinementSignal = {
    necessity_tier:
      input.trigger === "recovery_exhausted"
        ? "critical"
        : input.trigger === "rebuild_exhausted" || input.trigger === "reclaim_exhausted"
          ? "high"
          : "medium",
    necessity_fingerprint: input.context.fingerprint,
  } as const;
  const runtimeControl = extractObject(input.taskMeta.runtime_worker_control);
  const now = new Date().toISOString();
  const requestId = `scheduler_escalation_${input.task.taskId}_${Date.now()}`;
  const request: SchedulerEscalationRequestV1 = {
    schema_version: "scheduler-escalation-request-v1",
    requested_at: now,
    task_id: input.task.taskId,
    request_id: requestId,
    trigger: input.trigger,
    scheduler_context: {
      retry_count: input.task.scheduler.retry_count,
      recovery_count: input.task.scheduler.recovery_count,
      consecutive_failure_count: input.task.scheduler.consecutive_failure_count,
      last_dispatch_mode: input.task.scheduler.last_dispatch_mode,
      recent_failure_rate: input.task.scheduler.recent_failure_rate,
      last_recovery_hint: input.task.scheduler.recovery_hint,
      dispatch_seq: input.task.scheduler.dispatch_seq,
      last_worker_lifecycle_result: input.task.scheduler.last_worker_lifecycle_result,
    },
    observation_snapshot: {
      has_worker_fault: input.observerView.derived.has_worker_fault,
      fault_class: input.context.faultClass,
      convergence_class: input.context.convergenceClass,
      budget_lane: input.context.budgetLane,
      retention_decision: input.context.retentionDecision,
      rebuild_ready: input.observerView.derived.rebuild_ready,
      archive_ready: input.observerView.derived.archive_ready,
      reclaim_ready: input.observerView.derived.reclaim_ready,
      purge_ready: input.observerView.derived.purge_ready,
      observation_health: input.observerView.derived.observation_health,
      last_fault_action_applied: String(runtimeControl.last_fault_action_applied ?? "").trim(),
      fault_action_blocked_by_policy: runtimeControl.fault_action_blocked_by_policy === true,
      all_milestones_met: input.observerView.derived.all_milestones_met,
      milestone_target_count: input.observerView.derived.milestone_target_count,
      completed_milestone_count: input.observerView.derived.completed_milestone_count,
      current_instance_degraded: input.task.scheduler.degrade.active,
    },
    attempt_history: input.context.attemptHistory,
    failure_summary: {
      fault_class: input.context.faultClass,
      convergence_class: input.context.convergenceClass,
      budget_lane: input.context.budgetLane,
      retention_decision: input.context.retentionDecision,
      blocked_reasons: input.context.blockedReasons,
      current_instance_degraded: input.task.scheduler.degrade.active,
    },
    refinement_signal: refinementSignal,
    evidence: {
      paths: await collectEvidencePaths(input.task.taskDir),
    },
    routing_indexes: input.context.routingIndexes,
    evidence_indexes: {
      terminal_digest_path: "worker_terminal_digest.json",
      raw_log_index_path: "worker_raw_log_index.json",
      observer_view_path: "observer_view.json",
    },
    bridge_fingerprint: input.context.fingerprint,
  };
  return {
    bridgeStatePatch: {
      ...input.nextBridgeState,
      last_bridge_fingerprint: input.context.fingerprint,
      last_request_id: requestId,
      last_request_at: now,
      last_trigger: input.trigger,
    },
    request,
    packet: buildObserverRefinementPacket({
      schedulerEscalationRequest: request,
    }),
  };
}
