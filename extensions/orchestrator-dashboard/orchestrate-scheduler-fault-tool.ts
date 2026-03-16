import path from "node:path";

import type { SchedulerConfigV1, SchedulerFaultHandlingAction } from "./orchestrate-scheduler-contract.js";
import { buildMaintenanceEventDetail, emitSchedulerEvent } from "./orchestrate-scheduler-repository.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";
import { patchWorkerFaultControlSummary } from "./orchestrate-scheduler-tool-meta-patch.js";
import type { SchedulerToolRuntime } from "./orchestrate-scheduler-tool-transition.js";

export async function applyWorkerFaultHandlingTool(input: {
  runtime: SchedulerToolRuntime;
  schedulerConfig: SchedulerConfigV1;
  task: TaskMeta;
  tasksRoot: string;
}): Promise<{
  skipTask: boolean;
  lastFaultActionApplied: SchedulerFaultHandlingAction | "none";
  faultActionBlockedByPolicy: boolean;
  workerFaultClass: string;
}> {
  // Fault handling remains a rigid scheduler-owned control surface in v1.
  // Runtime fault summaries and policy gates decide actuation; agent args do not.
  const action = input.task.runtimeWorkerControl.lastWorkerFaultAction;
  const mode = input.schedulerConfig.worker_fault_policy.fault_actuation_mode;
  const workerFaultClass = input.task.runtimeWorkerControl.workerFaultClass;
  if (action === "none") {
    return {
      skipTask: false,
      lastFaultActionApplied: input.task.runtimeWorkerControl.lastFaultActionApplied,
      faultActionBlockedByPolicy: input.task.runtimeWorkerControl.faultActionBlockedByPolicy,
      workerFaultClass,
    };
  }
  const metaPath = path.join(input.tasksRoot, input.task.taskId, "meta.json");
  const allowed =
    (action === "retry" && input.schedulerConfig.worker_fault_policy.allow_retry) ||
    (action === "rebuild" && input.schedulerConfig.worker_fault_policy.allow_rebuild) ||
    (action === "reclaim" && input.schedulerConfig.worker_fault_policy.allow_reclaim) ||
    (action === "block" && input.schedulerConfig.worker_fault_policy.allow_block);
  const eventBase = {
    schema_version: "scheduler-dispatch-event-v1" as const,
    event_id: `evt_scheduler_fault_${input.task.taskId}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    task_id: input.task.taskId,
    detail: buildMaintenanceEventDetail({
      action,
      reason: workerFaultClass || "unspecified",
    }),
  };
  if (mode === "disabled") {
    await patchWorkerFaultControlSummary(metaPath, {
      last_fault_action_applied: "none",
      fault_actuation_mode: mode,
      fault_action_blocked_by_policy: false,
      worker_fault_class: workerFaultClass,
    });
    return {
      skipTask: false,
      lastFaultActionApplied: "none",
      faultActionBlockedByPolicy: false,
      workerFaultClass,
    };
  }
  if (!allowed) {
    await patchWorkerFaultControlSummary(metaPath, {
      last_fault_action_applied: action,
      fault_actuation_mode: mode,
      fault_action_blocked_by_policy: true,
      worker_fault_class: workerFaultClass,
    });
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_FAULT_ACTION_BLOCKED" });
    return {
      skipTask: true,
      lastFaultActionApplied: action,
      faultActionBlockedByPolicy: true,
      workerFaultClass,
    };
  }
  if (mode === "summary_only") {
    await patchWorkerFaultControlSummary(metaPath, {
      last_fault_action_applied: action,
      fault_actuation_mode: mode,
      fault_action_blocked_by_policy: false,
      worker_fault_class: workerFaultClass,
    });
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_FAULT_ACTION_DEFERRED" });
    return {
      skipTask: true,
      lastFaultActionApplied: action,
      faultActionBlockedByPolicy: false,
      workerFaultClass,
    };
  }
  const now = new Date().toISOString();
  if (action === "rebuild") {
    await patchWorkerFaultControlSummary(metaPath, {
      last_worker_fault_action: "none",
      worker_fault_retryable: false,
      worker_fault_requires_rebuild: false,
      last_fault_action_applied: "rebuild",
      fault_actuation_mode: mode,
      fault_action_blocked_by_policy: false,
      worker_fault_class: workerFaultClass,
      rebuild_ready: true,
      rebuild_reason: "worker_fault_action_rebuild",
      last_rebuilt_at: now,
    });
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_FAULT_ACTION_APPLIED" });
    return { skipTask: false, lastFaultActionApplied: "rebuild", faultActionBlockedByPolicy: false, workerFaultClass };
  }
  if (action === "retry" && input.task.runtimeWorkerControl.workerFaultRetryable) {
    await patchWorkerFaultControlSummary(metaPath, {
      last_worker_fault_action: "none",
      worker_fault_retryable: false,
      worker_fault_requires_rebuild: false,
      last_fault_action_applied: "retry",
      fault_actuation_mode: mode,
      fault_action_blocked_by_policy: false,
      worker_fault_class: workerFaultClass,
    });
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_FAULT_ACTION_APPLIED" });
    return { skipTask: false, lastFaultActionApplied: "retry", faultActionBlockedByPolicy: false, workerFaultClass };
  }
  if (action === "reclaim") {
    await patchWorkerFaultControlSummary(metaPath, {
      last_worker_fault_action: "none",
      worker_fault_retryable: false,
      worker_fault_requires_rebuild: false,
      last_fault_action_applied: "reclaim",
      fault_actuation_mode: mode,
      fault_action_blocked_by_policy: false,
      worker_fault_class: workerFaultClass,
      reclaim_requested_at: now,
    });
    await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_FAULT_ACTION_APPLIED" });
    return { skipTask: true, lastFaultActionApplied: "reclaim", faultActionBlockedByPolicy: false, workerFaultClass };
  }
  await patchWorkerFaultControlSummary(metaPath, {
    last_worker_fault_action: "none",
    worker_fault_retryable: false,
    worker_fault_requires_rebuild: false,
    last_fault_action_applied: "block",
    fault_actuation_mode: mode,
    fault_action_blocked_by_policy: false,
    worker_fault_class: workerFaultClass,
  });
  await emitSchedulerEvent(input.runtime.emitEvent, { ...eventBase, action: "SCHEDULER_FAULT_ACTION_APPLIED" });
  return { skipTask: true, lastFaultActionApplied: "block", faultActionBlockedByPolicy: false, workerFaultClass };
}
