import path from "node:path";

import type {
  SchedulerConfigV1,
  SchedulerExecutionMode,
  SchedulerFaultActuationMode,
  SchedulerFaultHandlingAction,
} from "./orchestrate-scheduler-contract.js";
import {
  extractObject,
  readJson,
  updateSchedulerOwnedMeta,
} from "./orchestrate-scheduler-repository.js";
import { normalizeScheduler } from "./orchestrate-scheduler-task-model.js";

export async function patchRetryMeta(
  tasksRoot: string,
  taskId: string,
  config: SchedulerConfigV1,
  mode: SchedulerExecutionMode,
  policyOverride?: {
    retry_max_attempts?: number;
    retry_base_ms?: number;
  },
): Promise<number> {
  const metaPath = path.join(tasksRoot, taskId, "meta.json");
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    const currentRetry = Number(scheduler.retry_count ?? 0);
    const nextRetry = Number.isFinite(currentRetry) ? Math.max(0, Math.floor(currentRetry) + 1) : 1;
    const retryBaseMs =
      typeof policyOverride?.retry_base_ms === "number" && Number.isFinite(policyOverride.retry_base_ms)
        ? Math.max(100, Math.floor(policyOverride.retry_base_ms))
        : config.retry.base_ms;
    const backoffMs = Math.min(config.retry.max_ms, retryBaseMs * Math.pow(2, Math.max(0, nextRetry - 1)));
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(retryBaseMs / 2)));
    const until = new Date(Date.now() + backoffMs + jitter).toISOString();
    scheduler.retry_count = nextRetry;
    scheduler.consecutive_failure_count = Math.max(scheduler.consecutive_failure_count + 1, nextRetry);
    scheduler.last_worker_lifecycle_result = "failure";
    scheduler.retry_backoff_until = until;
    scheduler.last_dispatch_at = new Date().toISOString();
    scheduler.last_dispatch_mode = mode;
    scheduler.queue_priority = Math.max(40, scheduler.queue_priority);
    scheduler.throttle_reason = "";
    scheduler.dispatch_seq = scheduler.dispatch_seq + 1;
    scheduler.degrade.active = false;
    scheduler.degrade.current_token_budget_cap = 0;
    scheduler.degrade.current_stage_write_budget_cap = 0;
    scheduler.inflight = { operation_id: "", dispatch_seq: 0, requested_at: "", ack_at: "", last_heartbeat_at: "" };
    meta.scheduler = scheduler;
  });
  const updated = await readJson<Record<string, unknown>>(metaPath, {});
  return normalizeScheduler(updated.scheduler).dispatch_seq;
}

export async function patchRecoveryMeta(input: {
  tasksRoot: string;
  taskId: string;
  config: SchedulerConfigV1;
  mode: SchedulerExecutionMode;
  policyOverride?: {
    token_uplift_ratio?: number;
    stage_write_budget_uplift_ratio?: number;
  };
}): Promise<number> {
  const metaPath = path.join(input.tasksRoot, input.taskId, "meta.json");
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    const budget = extractObject(meta.budget);
    const workerStage = extractObject(meta.worker_stage);
    const allocation = extractObject(workerStage.allocation);
    const currentTokenBudget = Math.max(1, Number(budget.max_token_cost ?? 50000));
    const currentStageBudget = Math.max(1, Number(allocation.worker_stage_max_bytes ?? 1_000_000));
    const tokenUpliftRatio =
      typeof input.policyOverride?.token_uplift_ratio === "number" &&
      Number.isFinite(input.policyOverride.token_uplift_ratio)
        ? Math.max(0, Math.min(1, input.policyOverride.token_uplift_ratio))
        : input.config.recovery.token_uplift_ratio;
    const stageWriteBudgetUpliftRatio =
      typeof input.policyOverride?.stage_write_budget_uplift_ratio === "number" &&
      Number.isFinite(input.policyOverride.stage_write_budget_uplift_ratio)
        ? Math.max(0, Math.min(1, input.policyOverride.stage_write_budget_uplift_ratio))
        : input.config.recovery.stage_write_budget_uplift_ratio;
    budget.max_token_cost = Math.max(
      currentTokenBudget + 1,
      Math.floor(currentTokenBudget * (1 + tokenUpliftRatio)),
    );
    workerStage.allocation = {
      ...allocation,
      worker_stage_max_bytes: Math.max(
        currentStageBudget + 1,
        Math.floor(currentStageBudget * (1 + stageWriteBudgetUpliftRatio)),
      ),
    };
    meta.budget = budget;
    meta.worker_stage = workerStage;
    scheduler.recovery_count = scheduler.recovery_count + 1;
    scheduler.consecutive_failure_count = Math.max(
      scheduler.consecutive_failure_count,
      scheduler.retry_count + scheduler.recovery_count,
    );
    scheduler.last_worker_lifecycle_result = "failure";
    scheduler.retry_backoff_until = "";
    scheduler.last_dispatch_at = new Date().toISOString();
    scheduler.last_dispatch_mode = input.mode;
    scheduler.recovery_hint = "recovery_uplift_relaunch";
    scheduler.dispatch_seq = scheduler.dispatch_seq + 1;
    scheduler.degrade.active = false;
    scheduler.degrade.current_token_budget_cap = 0;
    scheduler.degrade.current_stage_write_budget_cap = 0;
    scheduler.degrade.last_reason = "";
    scheduler.inflight.requested_at = new Date().toISOString();
    scheduler.inflight.dispatch_seq = scheduler.dispatch_seq;
    scheduler.inflight.ack_at = "";
    scheduler.inflight.last_heartbeat_at = "";
    meta.scheduler = scheduler;
  });
  const updated = await readJson<Record<string, unknown>>(metaPath, {});
  return normalizeScheduler(updated.scheduler).dispatch_seq;
}

export async function patchSchedulerDispatchMeta(
  tasksRoot: string,
  taskId: string,
  mode: SchedulerExecutionMode,
  updates: { queue_priority?: number; throttle_reason?: string; recovery_hint?: string },
): Promise<number> {
  const metaPath = path.join(tasksRoot, taskId, "meta.json");
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.queue_priority = updates.queue_priority ?? scheduler.queue_priority;
    scheduler.last_dispatch_at = new Date().toISOString();
    scheduler.last_dispatch_mode = mode;
    scheduler.throttle_reason = updates.throttle_reason ?? "";
    if (updates.recovery_hint) {
      scheduler.recovery_hint = updates.recovery_hint;
    }
    scheduler.dispatch_seq = scheduler.dispatch_seq + 1;
    scheduler.inflight.requested_at = new Date().toISOString();
    scheduler.inflight.dispatch_seq = scheduler.dispatch_seq;
    scheduler.inflight.ack_at = "";
    scheduler.inflight.last_heartbeat_at = "";
    meta.scheduler = scheduler;
  });
  const updated = await readJson<Record<string, unknown>>(metaPath, {});
  return normalizeScheduler(updated.scheduler).dispatch_seq;
}

export async function patchWorkerFaultControlSummary(
  metaPath: string,
  patch: {
    last_worker_fault_action?: SchedulerFaultHandlingAction | "none";
    worker_fault_retryable?: boolean;
    worker_fault_requires_rebuild?: boolean;
    last_fault_action_applied?: SchedulerFaultHandlingAction | "none";
    fault_actuation_mode?: SchedulerFaultActuationMode;
    fault_action_blocked_by_policy?: boolean;
    worker_fault_class?: string;
    rebuild_ready?: boolean;
    rebuild_reason?: string;
    last_rebuilt_at?: string;
    reclaim_requested_at?: string;
    archive_ready?: boolean;
    reclaim_ready?: boolean;
    purge_ready?: boolean;
    retention_decision?: string;
  },
): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const runtimeControl = extractObject(meta.runtime_worker_control);
    const workerStage = extractObject(meta.worker_stage);
    const retention = extractObject(workerStage.retention);
    meta.runtime_worker_control = {
      ...runtimeControl,
      ...(patch.last_worker_fault_action !== undefined ? { last_worker_fault_action: patch.last_worker_fault_action } : {}),
      ...(patch.worker_fault_retryable !== undefined ? { worker_fault_retryable: patch.worker_fault_retryable } : {}),
      ...(patch.worker_fault_requires_rebuild !== undefined ? { worker_fault_requires_rebuild: patch.worker_fault_requires_rebuild } : {}),
      ...(patch.last_fault_action_applied !== undefined ? { last_fault_action_applied: patch.last_fault_action_applied } : {}),
      ...(patch.fault_actuation_mode !== undefined ? { fault_actuation_mode: patch.fault_actuation_mode } : {}),
      ...(patch.fault_action_blocked_by_policy !== undefined ? { fault_action_blocked_by_policy: patch.fault_action_blocked_by_policy } : {}),
      ...(patch.worker_fault_class !== undefined ? { worker_fault_class: patch.worker_fault_class } : {}),
      ...(patch.rebuild_ready !== undefined ? { rebuild_ready: patch.rebuild_ready } : {}),
      ...(patch.rebuild_reason !== undefined ? { rebuild_reason: patch.rebuild_reason } : {}),
      ...(patch.last_rebuilt_at !== undefined ? { last_rebuilt_at: patch.last_rebuilt_at } : {}),
      ...(patch.reclaim_requested_at !== undefined ? { reclaim_requested_at: patch.reclaim_requested_at } : {}),
      ...(patch.archive_ready !== undefined ? { archive_ready: patch.archive_ready } : {}),
      ...(patch.reclaim_ready !== undefined ? { reclaim_ready: patch.reclaim_ready } : {}),
      ...(patch.purge_ready !== undefined ? { purge_ready: patch.purge_ready } : {}),
      ...(patch.retention_decision !== undefined ? { retention_decision: patch.retention_decision } : {}),
    };
    meta.worker_stage = {
      ...workerStage,
      retention: {
        ...retention,
        ...(patch.archive_ready !== undefined ? { worker_stage_archive_ready: patch.archive_ready } : {}),
        ...(patch.reclaim_ready !== undefined ? { worker_stage_reclaim_ready: patch.reclaim_ready } : {}),
        ...(patch.purge_ready !== undefined ? { worker_stage_purge_ready: patch.purge_ready } : {}),
        ...(patch.retention_decision !== undefined ? { worker_stage_retention_decision: patch.retention_decision } : {}),
      },
    };
  });
}
