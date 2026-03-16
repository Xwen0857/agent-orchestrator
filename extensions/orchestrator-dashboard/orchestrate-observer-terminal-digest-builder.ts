import type { WorkerTerminalDigestV1 } from "./orchestrate-observer-contract.js";
import {
  extractRecord,
  normalizeNonNegativeInt,
  normalizeRuntimeSection,
  normalizeString,
  normalizeStringArray,
  normalizeWorkerBudgetSection,
  normalizeWorkerConvergenceSection,
  normalizeWorkerStageSection,
} from "./orchestrate-observer-contract-support.js";

export function buildWorkerTerminalDigest(params: {
  taskMeta: Record<string, unknown>;
  rawLogIndexPath: string;
  evidencePaths: string[];
  now?: string;
}): WorkerTerminalDigestV1 | null {
  const taskId = normalizeString(params.taskMeta.id);
  const state = normalizeString(params.taskMeta.state);
  const runtime = normalizeRuntimeSection(params.taskMeta);
  const workerStage = normalizeWorkerStageSection(params.taskMeta);
  const workerBudget = normalizeWorkerBudgetSection(params.taskMeta);
  const workerConvergence = normalizeWorkerConvergenceSection(params.taskMeta);
  const scheduler = extractRecord(params.taskMeta.scheduler);
  const workerExecution = extractRecord(scheduler.worker_execution);
  const lifecycleResult =
    state === "REJECTED"
      ? "failure"
      : (state === "TESTING" || state === "APPROVED" || state === "CLOSED") &&
          (runtime.all_milestones_met === true || workerExecution.all_milestones_met === true)
        ? "success"
        : "";
  if (!taskId || !lifecycleResult) {
    return null;
  }

  const milestoneSet = extractRecord(runtime.milestone_set);
  const milestoneSummary = extractRecord(milestoneSet.summary);
  const progressSignal = extractRecord(runtime.milestone_progress_signal);
  const targetCount =
    normalizeNonNegativeInt(milestoneSummary.total_count) || normalizeStringArray(runtime.milestone_targets).length;
  const completedCount =
    normalizeNonNegativeInt(progressSignal.completed_count) ||
    normalizeNonNegativeInt(milestoneSummary.satisfied_count) ||
    normalizeStringArray(runtime.milestone_completed_targets).length;
  const degrade = extractRecord(scheduler.degrade);
  const lastStageWriteAtMs = Date.parse(normalizeString(degrade.last_stage_write_at));
  const observedAt = params.now ?? new Date().toISOString();
  const observedAtMs = Date.parse(observedAt);
  const recentStageWrite =
    Number.isFinite(lastStageWriteAtMs) &&
    normalizeNonNegativeInt(runtime.stage_write_stagnation_seconds) > 0 &&
    observedAtMs - lastStageWriteAtMs <= normalizeNonNegativeInt(runtime.stage_write_stagnation_seconds) * 1000;
  const workerStageAllocation = extractRecord(workerStage.allocation);
  const workerStageRetention = extractRecord(workerStage.retention);

  return {
    schema_version: "worker-terminal-digest-v1",
    observed_at: observedAt,
    task_id: taskId,
    worker_instance_id: normalizeString(workerStage.worker_stage_id) || `${taskId}_worker`,
    lifecycle_result: lifecycleResult,
    milestones: {
      target_count: targetCount,
      completed_count: completedCount,
      all_required_met: milestoneSummary.all_required_met === true || runtime.all_milestones_met === true,
    },
    resources: {
      token_cost_used: normalizeNonNegativeInt(workerBudget.token_cost_used),
      budget_lane: normalizeString(workerBudget.budget_lane),
      worker_stage_bytes_used: normalizeNonNegativeInt(workerStageAllocation.worker_stage_bytes_used),
      worker_stage_file_count: normalizeNonNegativeInt(workerStageAllocation.worker_stage_file_count),
    },
    progress: {
      last_progress_at: normalizeString(milestoneSummary.last_progress_at || workerExecution.last_progress_at),
      recent_stage_write: recentStageWrite,
      convergence_class: normalizeString(workerConvergence.convergence_class),
    },
    stage_snapshot: {
      overflow_status: normalizeString(workerStageAllocation.worker_stage_overflow_status),
      retention_decision: normalizeString(workerStageRetention.worker_stage_retention_decision),
      archive_ready: workerStageRetention.worker_stage_archive_ready === true,
      reclaim_ready: workerStageRetention.worker_stage_reclaim_ready === true,
      purge_ready: workerStageRetention.worker_stage_purge_ready === true,
      last_fault_class: normalizeString(workerStageRetention.worker_stage_last_fault_class),
    },
    evidence: {
      raw_log_index_path: params.rawLogIndexPath,
      paths: params.evidencePaths,
    },
  };
}
