import fs from "node:fs/promises";
import path from "node:path";
import type {
  SchedulerConfigV1,
  SchedulerDispatchEventV1,
  SchedulerExecutionMode,
} from "./orchestrate-scheduler-contract.js";

export type SchedulerDispatchAdapter = {
  mode: SchedulerExecutionMode;
  dispatch: (params: {
    taskId: string;
    tasksRoot: string;
    repoRoot: string;
    operationId: string;
    dispatchSeq: number;
  }) => Promise<{ ok: boolean; detail: string }>;
};

export type SchedulerAdapterDeps = {
  repoRoot: string;
  config: SchedulerConfigV1;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "agent_dispatch";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

export function buildSchedulerDispatchAdapter(
  mode: SchedulerExecutionMode,
  deps: SchedulerAdapterDeps,
): SchedulerDispatchAdapter {
  if (mode === "container") {
    return buildContainerAdapter(deps);
  }
  if (mode === "distributed") {
    return buildDistributedQueueAdapter(deps);
  }
  return buildLocalAdapter(deps);
}

function buildLocalAdapter(deps: SchedulerAdapterDeps): SchedulerDispatchAdapter {
  return {
    mode: "local_threads",
    dispatch: async ({ taskId, tasksRoot }) => {
      await deps.runWhitelistedScript({
        repoRoot: deps.repoRoot,
        scriptName: "agent_dispatch",
        args: [
          "--tasks-root",
          tasksRoot,
          "--task-id",
          taskId,
          "--mode",
          "local_threads",
          "--role",
          "scheduler-ops",
        ],
        timeoutMs: 60_000,
        maxBufferBytes: 2 * 1024 * 1024,
      });
      return { ok: true, detail: "local_dispatch_started" };
    },
  };
}

function buildContainerAdapter(deps: SchedulerAdapterDeps): SchedulerDispatchAdapter {
  return {
    mode: "container",
    dispatch: async ({ taskId, tasksRoot }) => {
      if (!deps.config.container.execute) {
        await deps.emitEvent("orchestrate.scheduler.container.dry_run", {
          task_id: taskId,
          reason: "container_execute_disabled",
        });
        return { ok: true, detail: "container_dry_run_queued" };
      }
      await deps.runWhitelistedScript({
        repoRoot: deps.repoRoot,
        scriptName: "agent_dispatch",
        args: [
          "--tasks-root",
          tasksRoot,
          "--task-id",
          taskId,
          "--mode",
          "container",
          "--role",
          "scheduler-ops",
        ],
        timeoutMs: 60_000,
        maxBufferBytes: 2 * 1024 * 1024,
      });
      return { ok: true, detail: "container_dispatch_started" };
    },
  };
}

function buildDistributedQueueAdapter(deps: SchedulerAdapterDeps): SchedulerDispatchAdapter {
  return {
    mode: "distributed",
    dispatch: async ({ taskId, operationId, dispatchSeq }) => {
      const queueCfg = deps.config.distributed.queue;
      const queueRoot = path.join(deps.repoRoot, queueCfg.root);
      await fs.mkdir(queueRoot, { recursive: true });
      const requestPath = path.join(queueRoot, `${queueCfg.request_topic}.ndjson`);
      const event: SchedulerDispatchEventV1 = {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_dispatch_${taskId}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_DISPATCH_SELECTED",
        task_id: taskId,
        operation_id: operationId,
        detail: "distributed_dispatch_queued",
      };
      const envelope = {
        schema_version: "scheduler-dispatch-request-v1",
        task_id: taskId,
        operation_id: operationId,
        dispatch_seq: dispatchSeq,
        idempotency_key: `${taskId}:${dispatchSeq}:${operationId}`,
        visibility_timeout_ms: queueCfg.visibility_timeout_ms,
        created_at: new Date().toISOString(),
        status: "queued",
        event,
      };
      await fs.appendFile(requestPath, `${JSON.stringify(envelope)}\n`, "utf8");
      await deps.emitEvent("orchestrate.scheduler.distributed.enqueued", {
        task_id: taskId,
        operation_id: operationId,
        queue_topic: queueCfg.request_topic,
      });
      return { ok: true, detail: "distributed_dispatch_enqueued" };
    },
  };
}
