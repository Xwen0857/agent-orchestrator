import type { SchedulerConfigV1, SchedulerExecutionMode } from "./orchestrate-scheduler-contract.js";
import type { SchedulerDispatchAdapter } from "./orchestrate-scheduler-adapters.js";
import { buildExecutionEventDetail, emitSchedulerEvent } from "./orchestrate-scheduler-repository.js";
import { patchRetryMeta } from "./orchestrate-scheduler-tool-meta-patch.js";
import { ensureRetryEvidence, prepareWorkerRuntimeArtifacts } from "./orchestrate-scheduler-tool-runtime-assembly.js";
import {
  buildOperationId,
  runTransition,
  type SchedulerToolRuntime,
} from "./orchestrate-scheduler-tool-transition.js";

export async function scheduleRetryTool(input: {
  runtime: SchedulerToolRuntime;
  adapter: SchedulerDispatchAdapter;
  tasksRoot: string;
  taskId: string;
  schedulerConfig: SchedulerConfigV1;
  mode: SchedulerExecutionMode;
  compatibilityMode: string;
  lane: string;
  selectedToolArgs?: Record<string, unknown>;
}): Promise<{ ok: boolean; operationId: string }> {
  const op = buildOperationId(input.taskId, "retry");
  const dispatchSeq = await patchRetryMeta(input.tasksRoot, input.taskId, input.schedulerConfig, input.mode, {
    retry_max_attempts:
      typeof input.selectedToolArgs?.retry_max_attempts === "number"
        ? input.selectedToolArgs.retry_max_attempts
        : undefined,
    retry_base_ms:
      typeof input.selectedToolArgs?.retry_base_ms === "number" ? input.selectedToolArgs.retry_base_ms : undefined,
  });
  await prepareWorkerRuntimeArtifacts({
    runtime: input.runtime,
    tasksRoot: input.tasksRoot,
    taskId: input.taskId,
    action: "retry",
    lane: "retry",
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
    reason: "scheduler kernel retry",
  });
  await emitSchedulerEvent(input.runtime.emitEvent, {
    schema_version: "scheduler-dispatch-event-v1",
    event_id: `evt_scheduler_retry_${input.taskId}_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "SCHEDULER_RETRY_SCHEDULED",
    task_id: input.taskId,
    operation_id: op,
      detail: buildExecutionEventDetail({
        compatibilityMode: input.compatibilityMode,
        lane: input.lane,
        reason: `retry_count=${dispatchSeq};retry_base_ms=${String(input.selectedToolArgs?.retry_base_ms ?? input.schedulerConfig.retry.base_ms)}`,
      }),
    });
  try {
    const dispatch = await input.adapter.dispatch({
      taskId: input.taskId,
      tasksRoot: input.tasksRoot,
      repoRoot: input.runtime.repoRoot,
      operationId: op,
      dispatchSeq,
    });
    return { ok: dispatch.ok, operationId: op };
  } catch {
    return { ok: false, operationId: op };
  }
}
