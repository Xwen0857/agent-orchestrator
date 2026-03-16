import { extractWorkerRuntimeCoordinationSignals } from "./orchestrate-runtime-contract.js";
import type { ObserverViewV1 } from "./orchestrate-observer-contract.js";
import {
  deriveObservationHealth,
  extractRecord,
  normalizeNonNegativeInt,
  normalizeObserverSection,
  normalizeRuntimeControlSection,
  normalizeRuntimeSection,
  normalizeString,
  normalizeStringArray,
  normalizeTaskClusterSection,
  normalizeWorkerBudgetSection,
  normalizeWorkerConvergenceSection,
  normalizeWorkerStageSection,
} from "./orchestrate-observer-contract-support.js";

export function buildObserverView(params: {
  taskMeta: Record<string, unknown>;
  now?: string;
}): ObserverViewV1 {
  const runtime = normalizeRuntimeSection(params.taskMeta);
  const workerStage = normalizeWorkerStageSection(params.taskMeta);
  const runtimeControl = normalizeRuntimeControlSection(params.taskMeta);
  const workerBudget = normalizeWorkerBudgetSection(params.taskMeta);
  const workerConvergence = normalizeWorkerConvergenceSection(params.taskMeta);
  const taskCluster = normalizeTaskClusterSection(params.taskMeta);
  const observer = normalizeObserverSection(params.taskMeta);
  const workerSignals = extractWorkerRuntimeCoordinationSignals(params.taskMeta);
  const faultClass =
    workerSignals.runtime_control.worker_fault_class ?? workerSignals.worker_stage_last_fault_class ?? "";
  const milestoneSet = extractRecord(runtime.milestone_set);
  const milestoneSummary = extractRecord(milestoneSet.summary);
  const milestoneTargets = Array.isArray(milestoneSet.milestones)
    ? (milestoneSet.milestones as unknown[])
        .map((entry) => normalizeString(extractRecord(entry).milestone_id))
        .filter(Boolean)
    : normalizeStringArray(runtime.milestone_targets);
  const progressSignal = extractRecord(runtime.milestone_progress_signal);
  const completedMilestoneCount =
    normalizeNonNegativeInt(progressSignal.completed_count) ||
    normalizeNonNegativeInt(milestoneSummary.satisfied_count) ||
    normalizeStringArray(runtime.milestone_completed_targets).length;
  return {
    schema_version: "observer-view-v1",
    observed_at: params.now ?? new Date().toISOString(),
    task_id: normalizeString(params.taskMeta.id) || "task_unknown",
    runtime,
    worker_stage: workerStage,
    runtime_control: runtimeControl,
    worker_budget: workerBudget,
    worker_convergence: workerConvergence,
    task_cluster: taskCluster,
    terminal: {
      available: normalizeString(observer.terminal_digest_path).length > 0,
      lifecycle_result:
        normalizeString(observer.terminal_lifecycle_result) === "success"
          ? "success"
          : normalizeString(observer.terminal_lifecycle_result) === "failure"
            ? "failure"
            : "",
      digest_path: normalizeString(observer.terminal_digest_path),
      raw_log_index_path: normalizeString(observer.raw_log_index_path),
      observed_at: normalizeString(observer.terminal_last_observed_at),
    },
    derived: {
      has_worker_fault: Boolean(faultClass),
      fault_class: faultClass,
      rebuild_ready: workerSignals.runtime_control.rebuild_ready,
      archive_ready:
        workerSignals.runtime_control.archive_ready || workerSignals.worker_stage_archive_ready,
      reclaim_ready:
        workerSignals.runtime_control.reclaim_ready || workerSignals.worker_stage_reclaim_ready,
      purge_ready: workerSignals.runtime_control.purge_ready || workerSignals.worker_stage_purge_ready,
      retention_decision:
        workerSignals.runtime_control.retention_decision ??
        workerSignals.worker_stage_retention_decision ??
        "",
      convergence_class: workerSignals.convergence_class ?? "",
      budget_lane: workerSignals.budget_lane ?? "",
      all_milestones_met: milestoneSummary.all_required_met === true || runtime.all_milestones_met === true,
      milestone_target_count:
        normalizeNonNegativeInt(milestoneSummary.total_count) || milestoneTargets.length,
      completed_milestone_count: completedMilestoneCount,
      current_instance_degraded: extractRecord(params.taskMeta.scheduler).degrade
        ? extractRecord(extractRecord(params.taskMeta.scheduler).degrade).active === true
        : false,
      observation_health: deriveObservationHealth({
        runtime,
        workerStage,
        runtimeControl,
        workerBudget,
        workerConvergence,
        taskCluster,
      }),
    },
  };
}
