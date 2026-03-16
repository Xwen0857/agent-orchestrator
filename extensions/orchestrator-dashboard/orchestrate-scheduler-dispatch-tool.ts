import type { SchedulerExecutionMode } from "./orchestrate-scheduler-contract.js";
import type { SchedulerDispatchAdapter } from "./orchestrate-scheduler-adapters.js";
import { buildExecutionEventDetail, emitSchedulerEvent } from "./orchestrate-scheduler-repository.js";
import { patchSchedulerDispatchMeta } from "./orchestrate-scheduler-tool-meta-patch.js";
import { prepareWorkerRuntimeArtifacts } from "./orchestrate-scheduler-tool-runtime-assembly.js";
import {
  buildOperationId,
  runTransition,
  type SchedulerToolRuntime,
} from "./orchestrate-scheduler-tool-transition.js";

export async function dispatchAssignedTool(input: {
  runtime: SchedulerToolRuntime;
  adapter: SchedulerDispatchAdapter;
  tasksRoot: string;
  taskId: string;
  mode: SchedulerExecutionMode;
  throttled: boolean;
  compatibilityMode: string;
  lane: string;
}): Promise<{ ok: boolean; operationId: string }> {
  // Dispatch remains a rigid execution tool in v1. Agent-selected args influence
  // upstream selection, but not dispatch-side operation shaping.
  const op = buildOperationId(input.taskId, "dispatch");
  const dispatchSeq = await patchSchedulerDispatchMeta(input.tasksRoot, input.taskId, input.mode, {
    queue_priority: 30,
    throttle_reason: input.throttled ? "parallel_limit" : "",
  });
  await prepareWorkerRuntimeArtifacts({
    runtime: input.runtime,
    tasksRoot: input.tasksRoot,
    taskId: input.taskId,
    action: "dispatch",
    lane: "assigned_ready",
    operationId: op,
    dispatchSeq,
    mode: input.mode,
  });
  await runTransition({
    runtime: input.runtime,
    taskDir: `${input.tasksRoot}/${input.taskId}`,
    actor: "scheduler-ops",
    fromState: "ASSIGNED",
    toState: "IN_PROGRESS",
    operationId: op,
    reason: "scheduler kernel dispatch",
  });
  let dispatchOk = false;
  let dispatchDetail = "dispatch_failed";
  try {
    const dispatch = await input.adapter.dispatch({
      taskId: input.taskId,
      tasksRoot: input.tasksRoot,
      repoRoot: input.runtime.repoRoot,
      operationId: op,
      dispatchSeq,
    });
    dispatchOk = dispatch.ok;
    dispatchDetail = dispatch.detail;
  } catch {
    dispatchOk = false;
  }
  if (dispatchOk) {
    await emitSchedulerEvent(input.runtime.emitEvent, {
      schema_version: "scheduler-dispatch-event-v1",
      event_id: `evt_scheduler_dispatch_${input.taskId}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "SCHEDULER_DISPATCH_SELECTED",
      task_id: input.taskId,
      operation_id: op,
      detail: buildExecutionEventDetail({
        compatibilityMode: input.compatibilityMode,
        lane: input.lane,
        reason: dispatchDetail,
      }),
    });
  }
  return { ok: dispatchOk, operationId: op };
}
