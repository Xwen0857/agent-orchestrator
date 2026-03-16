import type { SchedulerConfigV1, SchedulerExecutionMode } from "./orchestrate-scheduler-contract.js";
import type { SchedulerDispatchAdapter } from "./orchestrate-scheduler-adapters.js";
import { buildExecutionEventDetail, emitSchedulerEvent } from "./orchestrate-scheduler-repository.js";
import type { TaskMeta } from "./orchestrate-scheduler-task-model.js";
import {
  patchRecoveryMeta,
  patchSchedulerDispatchMeta,
} from "./orchestrate-scheduler-tool-meta-patch.js";
import {
  ensureRetryEvidence,
  prepareWorkerRuntimeArtifacts,
} from "./orchestrate-scheduler-tool-runtime-assembly.js";
import {
  buildOperationId,
  runTransition,
  type SchedulerToolRuntime,
} from "./orchestrate-scheduler-tool-transition.js";

export async function applyRecoveryTool(input: {
  runtime: SchedulerToolRuntime;
  adapter: SchedulerDispatchAdapter;
  selectedMeta: TaskMeta;
  tasksRoot: string;
  schedulerConfig: SchedulerConfigV1;
  mode: SchedulerExecutionMode;
  taskId: string;
  compatibilityMode: string;
  lane: string;
  selectedToolArgs?: Record<string, unknown>;
}): Promise<{ ok: boolean; attemptedDispatch: boolean; operationId: string }> {
  const op = buildOperationId(input.taskId, "recover");
  if (input.selectedMeta.state === "REJECTED") {
    const dispatchSeq = await patchRecoveryMeta({
      tasksRoot: input.tasksRoot,
      taskId: input.taskId,
      config: input.schedulerConfig,
      mode: input.mode,
      policyOverride: {
        token_uplift_ratio:
          typeof input.selectedToolArgs?.token_uplift_ratio === "number"
            ? input.selectedToolArgs.token_uplift_ratio
            : undefined,
        stage_write_budget_uplift_ratio:
          typeof input.selectedToolArgs?.stage_write_budget_uplift_ratio === "number"
            ? input.selectedToolArgs.stage_write_budget_uplift_ratio
            : undefined,
      },
    });
    await prepareWorkerRuntimeArtifacts({
      runtime: input.runtime,
      tasksRoot: input.tasksRoot,
      taskId: input.taskId,
      action: "retry",
      lane: "recovery",
      operationId: op,
      dispatchSeq,
      mode: input.mode,
    });
    await ensureRetryEvidence(input.tasksRoot, input.taskId);
    await runTransition({
      runtime: input.runtime,
      taskDir: `${input.tasksRoot}/${input.taskId}`,
      actor: "scheduler-ops",
      fromState: "REJECTED",
      toState: "IN_PROGRESS",
      operationId: op,
      reason: "scheduler kernel recovery relaunch",
    });
    let dispatchOk = false;
    try {
      const dispatch = await input.adapter.dispatch({
        taskId: input.taskId,
        tasksRoot: input.tasksRoot,
        repoRoot: input.runtime.repoRoot,
        operationId: op,
        dispatchSeq,
      });
      dispatchOk = dispatch.ok;
    } catch {
      dispatchOk = false;
    }
    await emitSchedulerEvent(input.runtime.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_recovery_${input.taskId}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_RECOVERY_APPLIED",
      task_id: input.taskId,
      operation_id: op,
      detail: buildExecutionEventDetail({
        compatibilityMode: input.compatibilityMode,
        lane: input.lane,
        reason: `rejected_worker_relaunched_with_uplift;token_uplift_ratio=${String(input.selectedToolArgs?.token_uplift_ratio ?? input.schedulerConfig.recovery.token_uplift_ratio)};stage_write_budget_uplift_ratio=${String(input.selectedToolArgs?.stage_write_budget_uplift_ratio ?? input.schedulerConfig.recovery.stage_write_budget_uplift_ratio)}`,
      }),
    });
    return { ok: dispatchOk, attemptedDispatch: true, operationId: op };
  }

  await runTransition({
    runtime: input.runtime,
    taskDir: `${input.tasksRoot}/${input.taskId}`,
    actor: "scheduler-ops",
    fromState: "BLOCKED_SYSTEM_ERROR",
    toState: "ASSIGNED",
    operationId: op,
    reason: "scheduler kernel recovery",
  });
  await patchSchedulerDispatchMeta(input.tasksRoot, input.taskId, input.mode, {
    recovery_hint: "recovered_to_assigned",
    throttle_reason: "",
  });
  await emitSchedulerEvent(input.runtime.emitEvent, {
    schema_version: "scheduler-dispatch-event-v1",
    event_id: `evt_scheduler_recovery_${input.taskId}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "SCHEDULER_RECOVERY_APPLIED",
    task_id: input.taskId,
    operation_id: op,
    detail: buildExecutionEventDetail({
      compatibilityMode: input.compatibilityMode,
      lane: input.lane,
      reason: "blocked_system_error_recovered",
    }),
  });
  return { ok: true, attemptedDispatch: false, operationId: op };
}
