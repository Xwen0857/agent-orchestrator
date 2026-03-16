import type { SchedulerConfigV1 } from "./orchestrate-scheduler-contract.js";
import { stableJsonFingerprint, updateSchedulerOwnedMeta, extractObject } from "./orchestrate-scheduler-repository.js";
import { normalizeScheduler, type TaskMeta } from "./orchestrate-scheduler-task-model.js";

type DegradeEvaluation = {
  milestoneWindowSeconds: number;
  stageWriteStagnationSeconds: number;
  nextStallChecks: number;
  allMilestonesMet: boolean;
  stageSignature: string;
  reason: "milestone_stall" | "stage_write_stagnation" | "";
};

function evaluateDegradeCandidate(task: TaskMeta, schedulerConfig: SchedulerConfigV1): DegradeEvaluation | null {
  if (task.state !== "IN_PROGRESS" || !task.observerView) {
    return null;
  }
  const observerRuntime = extractObject(task.observerView.runtime);
  const observerWorkerStage = extractObject(task.observerView.worker_stage);
  const observerAllocation = extractObject(observerWorkerStage.allocation);
  const stageSignature = stableJsonFingerprint({
    bytes_used: Number(observerAllocation.worker_stage_bytes_used ?? 0),
    file_count: Number(observerAllocation.worker_stage_file_count ?? 0),
    overflow_status: String(observerAllocation.worker_stage_overflow_status ?? ""),
  });
  const allMilestonesMet = observerRuntime.all_milestones_met === true;
  const currentDetectionWindow = Number(observerRuntime.milestone_detection_window_seconds ?? 0);
  const currentStagnationWindow = Number(observerRuntime.stage_write_stagnation_seconds ?? 0);
  const milestoneWindowSeconds =
    currentDetectionWindow > 0
      ? currentDetectionWindow
      : task.scheduler.worker_execution.detection_window_seconds ||
        schedulerConfig.degrade.milestone_stall_window_seconds;
  const stageWriteStagnationSeconds =
    currentStagnationWindow > 0
      ? currentStagnationWindow
      : task.scheduler.worker_execution.stage_write_stagnation_seconds ||
        schedulerConfig.degrade.stage_write_stagnation_seconds;
  const degradeState = task.scheduler.degrade;
  const workerExecution = task.scheduler.worker_execution;
  const lastProgressAtMs = Date.parse(workerExecution.last_progress_at || "");
  const lastStageWriteAtMs = Date.parse(degradeState.last_stage_write_at || "");
  const nowMs = Date.now();
  const stageWriteStalled =
    degradeState.last_stage_signature === stageSignature &&
    Number.isFinite(lastStageWriteAtMs) &&
    nowMs - lastStageWriteAtMs >= stageWriteStagnationSeconds * 1000;
  const nextStallChecks =
    !allMilestonesMet &&
    Number.isFinite(lastProgressAtMs) &&
    nowMs - lastProgressAtMs >= milestoneWindowSeconds * 1000
      ? workerExecution.stall_checks + 1
      : allMilestonesMet
        ? 0
        : workerExecution.stall_checks;
  const milestoneStalled = nextStallChecks >= schedulerConfig.degrade.milestone_stall_checks;
  const reason = milestoneStalled ? "milestone_stall" : stageWriteStalled ? "stage_write_stagnation" : "";
  return {
    milestoneWindowSeconds,
    stageWriteStagnationSeconds,
    nextStallChecks,
    allMilestonesMet,
    stageSignature,
    reason,
  };
}

export function countDegradeCandidates(input: {
  schedulerConfig: SchedulerConfigV1;
  metas: TaskMeta[];
}): number {
  let count = 0;
  for (const task of input.metas) {
    const evaluation = evaluateDegradeCandidate(task, input.schedulerConfig);
    if (evaluation?.reason) {
      count += 1;
    }
  }
  return count;
}

export async function applyDegradeTool(input: {
  schedulerConfig: SchedulerConfigV1;
  metas: TaskMeta[];
  selectedToolArgs?: Record<string, unknown>;
}): Promise<number> {
  let applied = 0;
  const tokenBudgetDecayRatio =
    typeof input.selectedToolArgs?.token_budget_decay_ratio === "number" &&
    Number.isFinite(input.selectedToolArgs.token_budget_decay_ratio)
      ? Math.max(0, Math.min(1, input.selectedToolArgs.token_budget_decay_ratio))
      : input.schedulerConfig.degrade.token_budget_decay_ratio;
  const stageWriteBudgetDecayRatio =
    typeof input.selectedToolArgs?.stage_write_budget_decay_ratio === "number" &&
    Number.isFinite(input.selectedToolArgs.stage_write_budget_decay_ratio)
      ? Math.max(0, Math.min(1, input.selectedToolArgs.stage_write_budget_decay_ratio))
      : input.schedulerConfig.degrade.stage_write_budget_decay_ratio;

  for (const task of input.metas) {
    const evaluation = evaluateDegradeCandidate(task, input.schedulerConfig);
    if (!evaluation) {
      continue;
    }
    const now = new Date().toISOString();
    const reason = evaluation.reason;

    await updateSchedulerOwnedMeta(task.metaPath, (meta) => {
      const scheduler = normalizeScheduler(meta.scheduler);
      scheduler.worker_execution.detection_window_seconds = evaluation.milestoneWindowSeconds;
      scheduler.worker_execution.stage_write_stagnation_seconds = evaluation.stageWriteStagnationSeconds;
      scheduler.worker_execution.last_checked_at = now;
      scheduler.worker_execution.all_milestones_met = evaluation.allMilestonesMet;
      scheduler.worker_execution.tester_ready = evaluation.allMilestonesMet;
      scheduler.worker_execution.stall_checks = evaluation.nextStallChecks;
      if (scheduler.degrade.last_stage_signature !== evaluation.stageSignature) {
        scheduler.degrade.last_stage_signature = evaluation.stageSignature;
        scheduler.degrade.last_stage_write_at = now;
      }
      if (!reason) {
        meta.scheduler = scheduler;
        return;
      }
      const budget = extractObject(meta.budget);
      const workerStage = extractObject(meta.worker_stage);
      const allocation = extractObject(workerStage.allocation);
      const observerAllocation = extractObject(task.observerView?.worker_stage);
      const observerAllocationValues = extractObject(observerAllocation.allocation);
      const currentTokenBudget = Math.max(1, Number(budget.max_token_cost ?? 50000));
      const currentStageBudget = Math.max(
        1,
        Number(allocation.worker_stage_max_bytes ?? observerAllocationValues.worker_stage_max_bytes ?? 1_000_000),
      );
      const nextTokenCap =
        scheduler.degrade.current_token_budget_cap > 0
          ? Math.max(1, Math.floor(scheduler.degrade.current_token_budget_cap * (1 - tokenBudgetDecayRatio)))
          : Math.max(1, Math.floor(currentTokenBudget * (1 - tokenBudgetDecayRatio)));
      const nextStageCap =
        scheduler.degrade.current_stage_write_budget_cap > 0
          ? Math.max(
              1,
              Math.floor(scheduler.degrade.current_stage_write_budget_cap * (1 - stageWriteBudgetDecayRatio)),
            )
          : Math.max(1, Math.floor(currentStageBudget * (1 - stageWriteBudgetDecayRatio)));
      scheduler.degrade.active = true;
      scheduler.degrade.count = scheduler.degrade.count + 1;
      scheduler.degrade.last_reason = reason;
      scheduler.degrade.last_applied_at = now;
      scheduler.degrade.current_token_budget_cap = nextTokenCap;
      scheduler.degrade.current_stage_write_budget_cap = nextStageCap;
      meta.scheduler = scheduler;
      meta.worker_budget = {
        ...extractObject(meta.worker_budget),
        budget_lane: "degraded",
        fast_token_budget: nextTokenCap,
        updated_at: now,
      };
      meta.worker_stage = {
        ...workerStage,
        allocation: {
          ...allocation,
          worker_stage_max_bytes: nextStageCap,
        },
      };
    });
    if (reason) {
      applied += 1;
    }
  }
  return applied;
}
