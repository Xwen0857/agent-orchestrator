import { createHash } from "node:crypto";

import type { SchedulerConfigV1, SchedulerInflightSummary } from "./orchestrate-scheduler-contract.js";
import { countDegradeCandidates } from "./orchestrate-scheduler-degrade-tool.js";
import { applyLifecycleTool } from "./orchestrate-scheduler-lifecycle-tool.js";
import {
  emitSchedulerEvent,
  readJson,
  stableJsonFingerprint,
  updateSchedulerOwnedMeta,
  writeJsonAtomic,
} from "./orchestrate-scheduler-repository.js";
import { normalizeScheduler, type TaskMeta } from "./orchestrate-scheduler-task-model.js";
import { runTesterReadinessResetPhase } from "./orchestrate-scheduler-repository.js";
import { runSchedulerTaskSnapshotPhase } from "./orchestrate-scheduler-snapshot-phase.js";
import { runTransition } from "./orchestrate-scheduler-tool-transition.js";

type SchedulerSignalRuntime = {
  repoRoot: string;
  mode: "local_threads" | "container" | "distributed";
  tasksRootArg: string;
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName:
      | "transition_task_state"
      | "append_task_event"
      | "agent_dispatch"
      | "kb_submit_candidate";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

type SchedulerConsumerState = {
  schema_version: "scheduler-consumer-state-v1";
  topics: Record<string, { offset: number }>;
  idempotency: { keys: Array<{ key: string; seen_at: string }> };
};

export async function runSchedulerSignalCollectionPhase(input: {
  runtime: SchedulerSignalRuntime;
  schedulerConfig: SchedulerConfigV1;
  tasksRoot: string;
}): Promise<{
  metas: TaskMeta[];
  inflightSummary: SchedulerInflightSummary;
  degradeCandidateCount: number;
  lifecycleActionCount: number;
  replanPauseCount: number;
  awaitingRevalidationCount: number;
}> {
  const metas = await runSchedulerTaskSnapshotPhase({ tasksRoot: input.tasksRoot });
  const inflightSummary = await consumeDistributedQueueEvents({
    runtime: input.runtime,
    schedulerConfig: input.schedulerConfig,
    tasksRoot: input.tasksRoot,
    metas,
  });
  const degradeCandidateCount = countDegradeCandidates({
    schedulerConfig: input.schedulerConfig,
    metas,
  });
  await runTesterReadinessResetPhase({ metas });
  let lifecycleActionCount = 0;
  for (const meta of metas) {
    const lifecycleResult = await applyLifecycleTool({
      runtime: input.runtime,
      schedulerConfig: input.schedulerConfig,
      task: meta,
      tasksRoot: input.tasksRoot,
    });
    lifecycleActionCount += lifecycleResult.action === "none" ? 0 : 1;
  }
  return {
    metas,
    inflightSummary,
    degradeCandidateCount,
    lifecycleActionCount,
    replanPauseCount: metas.filter((meta) => meta.runtimeReplanConsumeStatus === "paused").length,
    awaitingRevalidationCount: metas.filter(
      (meta) => meta.runtimeReplanConsumeStatus === "awaiting_revalidation",
    ).length,
  };
}

async function consumeDistributedQueueEvents(input: {
  runtime: SchedulerSignalRuntime;
  schedulerConfig: SchedulerConfigV1;
  tasksRoot: string;
  metas: TaskMeta[];
}): Promise<SchedulerInflightSummary> {
  const summary: SchedulerInflightSummary = {
    total: 0,
    timed_out: 0,
    acked: 0,
    failed_results: 0,
    heartbeat_expired: 0,
  };
  if (input.runtime.mode !== "distributed") {
    return summary;
  }
  const cfg = input.schedulerConfig.distributed.queue;
  const root = `${input.runtime.repoRoot}/${cfg.root}`;
  const statePath = `${root}/.consumer_state.json`;
  const state = await readConsumerState(statePath);
  const seenWindow = buildSeenWindow(state.idempotency.keys, {
    maxKeys: input.schedulerConfig.distributed.consumer.idempotency_max_keys,
    ttlMs: input.schedulerConfig.distributed.consumer.idempotency_ttl_ms,
  });
  const ackStream = await readNdjsonFromOffset(`${root}/${cfg.ack_topic}.ndjson`, state.topics[cfg.ack_topic]?.offset ?? 0);
  state.topics[cfg.ack_topic] = { offset: ackStream.nextOffset };
  const resultStream = await readNdjsonFromOffset(
    `${root}/${cfg.result_topic}.ndjson`,
    state.topics[cfg.result_topic]?.offset ?? 0,
  );
  state.topics[cfg.result_topic] = { offset: resultStream.nextOffset };
  const heartbeatStream = await readNdjsonFromOffset(
    `${root}/${cfg.heartbeat_topic}.ndjson`,
    state.topics[cfg.heartbeat_topic]?.offset ?? 0,
  );
  state.topics[cfg.heartbeat_topic] = { offset: heartbeatStream.nextOffset };
  const byTask = new Map<string, TaskMeta>(input.metas.map((meta) => [meta.taskId, meta]));

  for (const row of ackStream.rows) {
    const taskId = String(row.task_id ?? "");
    const op = String(row.operation_id ?? "");
    const seq = Number(row.dispatch_seq ?? 0);
    if (!taskId || !op || !Number.isFinite(seq) || seq <= 0) {
      continue;
    }
    const key = `${taskId}:${seq}:${op}`;
    if (seenWindow.has(key)) {
      continue;
    }
    seenWindow.add(key, row.timestamp);
    const task = byTask.get(taskId);
    if (!task) {
      continue;
    }
    summary.acked += 1;
    summary.total += 1;
    await patchInflight(task.metaPath, {
      operation_id: op,
      dispatch_seq: seq,
      ack_at: String(row.acked_at ?? new Date().toISOString()),
      last_heartbeat_at: String(row.acked_at ?? new Date().toISOString()),
    });
  }

  for (const row of heartbeatStream.rows) {
    const taskId = String(row.task_id ?? "");
    const op = String(row.operation_id ?? "");
    const seq = Number(row.dispatch_seq ?? 0);
    const ts = String(row.timestamp ?? "");
    if (!taskId || !op || !Number.isFinite(seq) || seq <= 0 || !ts) {
      continue;
    }
    const baseKey = `${taskId}:${seq}:${op}`;
    const key = `${baseKey}:${stableRowFingerprint(row)}`;
    if (seenWindow.has(key)) {
      continue;
    }
    seenWindow.add(key, ts);
    const task = byTask.get(taskId);
    if (!task) {
      continue;
    }
    await patchInflight(task.metaPath, {
      operation_id: op,
      dispatch_seq: seq,
      last_heartbeat_at: ts,
    });
  }

  for (const row of resultStream.rows) {
    const taskId = String(row.task_id ?? "");
    const op = String(row.operation_id ?? "");
    const seq = Number(row.dispatch_seq ?? 0);
    const status = String(row.status ?? "").toLowerCase();
    if (!taskId || !op || !Number.isFinite(seq) || seq <= 0 || !status) {
      continue;
    }
    const key = `${taskId}:${seq}:${op}:${status}`;
    if (seenWindow.has(key)) {
      continue;
    }
    seenWindow.add(key, row.timestamp);
    const task = byTask.get(taskId);
    if (!task) {
      continue;
    }
    summary.total += 1;
    if (status === "failed") {
      summary.failed_results += 1;
      await patchResultFailure(task.metaPath, input.schedulerConfig);
      await emitSchedulerEvent(input.runtime.emitEvent, {
        schema_version: "scheduler-dispatch-event-v1",
        event_id: `evt_scheduler_retry_distributed_failed_${task.taskId}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        action: "SCHEDULER_RETRY_SCHEDULED",
        task_id: task.taskId,
        operation_id: op,
        detail: "distributed_result_failed",
      });
      if (task.state === "IN_PROGRESS") {
        try {
          await runTransition({
            runtime: input.runtime,
            taskDir: task.taskDir,
            actor: "agent-orchestrator",
            fromState: "IN_PROGRESS",
            toState: "BLOCKED_SYSTEM_ERROR",
            operationId: `op_scheduler_dist_fail_${task.taskId}_${Date.now()}`,
            reason: "distributed result failed",
          });
        } catch {
          // keep soft-fail
        }
      }
    }
    await clearInflight(task.metaPath);
  }

  const nowMs = Date.now();
  for (const task of input.metas) {
    const inflight = task.scheduler.inflight;
    if (!inflight.operation_id || inflight.dispatch_seq <= 0 || !inflight.requested_at) {
      continue;
    }
    const requestedAtMs = Date.parse(inflight.requested_at);
    if (Number.isFinite(requestedAtMs)) {
      const timeoutAt = requestedAtMs + cfg.visibility_timeout_ms;
      if (!inflight.ack_at && timeoutAt < nowMs) {
        summary.timed_out += 1;
        await patchResultFailure(task.metaPath, input.schedulerConfig);
        await emitSchedulerEvent(input.runtime.emitEvent, {
          schema_version: "scheduler-dispatch-event-v1",
          event_id: `evt_scheduler_retry_visibility_timeout_${task.taskId}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          action: "SCHEDULER_RETRY_SCHEDULED",
          task_id: task.taskId,
          operation_id: inflight.operation_id,
          detail: "distributed_visibility_timeout",
        });
        if (task.state === "IN_PROGRESS") {
          try {
            await runTransition({
              runtime: input.runtime,
              taskDir: task.taskDir,
              actor: "agent-orchestrator",
              fromState: "IN_PROGRESS",
              toState: "BLOCKED_SYSTEM_ERROR",
              operationId: `op_scheduler_dist_timeout_${task.taskId}_${Date.now()}`,
              reason: "distributed visibility timeout",
            });
          } catch {
            // keep soft-fail
          }
        }
        await clearInflight(task.metaPath);
        continue;
      }
    }
    if (inflight.last_heartbeat_at) {
      const hbMs = Date.parse(inflight.last_heartbeat_at);
      if (Number.isFinite(hbMs) && hbMs + cfg.heartbeat_timeout_ms < nowMs) {
        summary.heartbeat_expired += 1;
        await patchHeartbeatExpired(task.metaPath);
      }
    }
  }

  state.idempotency.keys = seenWindow.snapshot();
  await writeJsonAtomic(statePath, state);
  return summary;
}

async function patchInflight(
  metaPath: string,
  patch: {
    operation_id?: string;
    dispatch_seq?: number;
    requested_at?: string;
    ack_at?: string;
    last_heartbeat_at?: string;
  },
): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.inflight = {
      operation_id: patch.operation_id ?? scheduler.inflight.operation_id,
      dispatch_seq: patch.dispatch_seq ?? scheduler.inflight.dispatch_seq,
      requested_at: patch.requested_at ?? scheduler.inflight.requested_at,
      ack_at: patch.ack_at ?? scheduler.inflight.ack_at,
      last_heartbeat_at: patch.last_heartbeat_at ?? scheduler.inflight.last_heartbeat_at,
    };
    meta.scheduler = scheduler;
  });
}

async function clearInflight(metaPath: string): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.inflight = { operation_id: "", dispatch_seq: 0, requested_at: "", ack_at: "", last_heartbeat_at: "" };
    meta.scheduler = scheduler;
  });
}

async function patchResultFailure(metaPath: string, config: SchedulerConfigV1): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.retry_count = scheduler.retry_count + 1;
    const backoff = Math.min(config.retry.max_ms, config.retry.base_ms * Math.pow(2, Math.max(0, scheduler.retry_count - 1)));
    scheduler.retry_backoff_until = new Date(Date.now() + backoff).toISOString();
    scheduler.recovery_hint = "distributed_result_failed";
    meta.scheduler = scheduler;
  });
}

async function patchHeartbeatExpired(metaPath: string): Promise<void> {
  await updateSchedulerOwnedMeta(metaPath, (meta) => {
    const scheduler = normalizeScheduler(meta.scheduler);
    scheduler.throttle_reason = "worker_heartbeat_timeout";
    meta.scheduler = scheduler;
  });
}

async function readNdjsonFromOffset(
  targetPath: string,
  offset: number,
): Promise<{ rows: Array<Record<string, unknown>>; nextOffset: number }> {
  try {
    const fs = await import("node:fs/promises");
    const data = await fs.readFile(targetPath);
    const normalizedOffset = Math.max(0, Math.min(offset, data.length));
    const slice = data.subarray(normalizedOffset).toString("utf8");
    const rows = slice
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return { rows, nextOffset: data.length };
  } catch {
    return { rows: [], nextOffset: 0 };
  }
}

async function readConsumerState(statePath: string): Promise<SchedulerConsumerState> {
  const fallback: SchedulerConsumerState = {
    schema_version: "scheduler-consumer-state-v1",
    topics: {},
    idempotency: { keys: [] },
  };
  const state = await readJson<SchedulerConsumerState>(statePath, fallback);
  if (!state || state.schema_version !== "scheduler-consumer-state-v1") {
    return fallback;
  }
  if (!state.topics || typeof state.topics !== "object" || Array.isArray(state.topics)) {
    state.topics = {};
  }
  if (!state.idempotency || !Array.isArray(state.idempotency.keys)) {
    state.idempotency = { keys: [] };
  }
  return state;
}

function buildSeenWindow(
  entries: Array<{ key: string; seen_at: string }>,
  limits: { maxKeys: number; ttlMs: number },
): {
  has: (key: string) => boolean;
  add: (key: string, seenAt: unknown) => void;
  snapshot: () => Array<{ key: string; seen_at: string }>;
} {
  const now = Date.now();
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string") {
      continue;
    }
    const seenAtMs = Date.parse(entry.seen_at);
    if (!Number.isFinite(seenAtMs) || seenAtMs + limits.ttlMs < now) {
      continue;
    }
    map.set(entry.key, seenAtMs);
  }
  return {
    has: (key) => map.has(key),
    add: (key, seenAt) => {
      const parsed = Date.parse(String(seenAt ?? ""));
      map.set(key, Number.isFinite(parsed) ? parsed : Date.now());
    },
    snapshot: () =>
      Array.from(map.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(-Math.max(1, limits.maxKeys))
        .map(([key, seenAtMs]) => ({
          key,
          seen_at: new Date(seenAtMs).toISOString(),
        })),
  };
}

function stableRowFingerprint(row: Record<string, unknown>): string {
  const input = JSON.stringify(row, Object.keys(row).sort());
  return createHash("sha1").update(input).digest("hex");
}
